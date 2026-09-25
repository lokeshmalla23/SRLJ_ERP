import sequelize from '../db.js';
import { Op } from 'sequelize';
import { Scheme, Setting, Customer } from '../models/index.js';
import { newId, nowIso, normalizeJsonFields, parseJsonField, nextShopSerial } from '../utils.js';
import branchConfig from '../config/branchConfig.js';
import { computeSchemeDueInfo, computeSchemeRedeemableValue, isGoldGramScheme, schemeStatusAfterRedemption } from '../services/schemeDueService.js';
import { broadcast } from '../services/wsServer.js';
import { formatINR } from '../utils/formatMoney.js';

function customerSummary(c) {
  return { id: c.id, name: c.name, mobile: c.mobile, tag: c.tag || 'regular' };
}

/** Normalize scheme.payments across Postgres JSONB and SQLite TEXT (incl. double-encoded). */
function schemePayments(scheme) {
  let value = parseJsonField(scheme?.payments, []);
  // Double-encoded TEXT: parseJsonField returns a string that still needs parsing
  if (typeof value === 'string') value = parseJsonField(value, []);
  return Array.isArray(value) ? value : [];
}

/** Real clock time, stored on the open transaction date (not today's calendar date). */
function paidAtOnTransactionDate(businessDate) {
  const ymd = String(businessDate || '').slice(0, 10);
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return now.toISOString();
  return `${ymd}T${hh}:${mm}:${ss}`;
}

async function resolveSchemeGoldRate(explicitRate) {
  const n = Number(explicitRate);
  if (Number.isFinite(n) && n > 0) return n;
  try {
    const row = await Setting.findOne({ where: { key: 'gold_rate' } });
    const v = row?.value || {};
    return Number(v.gold_22k || v.rate || v.gold_24k) || 0;
  } catch {
    return 0;
  }
}

const schemeJson = (row, goldRate = 0) => {
  const base = normalizeJsonFields(row?.toJSON ? row.toJSON() : row, {
    payments: [],
  });
  const redeemable = computeSchemeRedeemableValue(base, { goldRate });
  return {
    ...base,
    total_paid: redeemable.total_paid,
    redeemable_amount: redeemable.amount,
    redeemable_grams: redeemable.grams,
    redeemable_label: redeemable.label,
    redeemable_credit_type: redeemable.credit_type,
    maturity_value: redeemable.maturity_value,
  };
};

// GET /api/schemes/payments-due
export const getPaymentsDue = async (req, res, next) => {
  try {
    const schemes = await Scheme.findAll({ where: { status: 'active' }, order: [['created_at', 'DESC']] });
    const today = new Date();
    const due = schemes
      .map((s) => computeSchemeDueInfo(s))
      .filter((s) => s._next_due_date_obj != null && s._next_due_date_obj <= today)
      .map(({ _next_due_date_obj, ...rest }) => rest);
    return res.json(due);
  } catch (err) {
    next(err);
  }
};

// GET /api/schemes
export const listSchemes = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.customer_id) where.customer_id = req.query.customer_id;
    if (req.query.status) {
      const statuses = String(req.query.status).split(',').map((s) => s.trim()).filter(Boolean);
      where.status = statuses.length === 1 ? statuses[0] : { [Op.in]: statuses };
    }
    const goldRate = await resolveSchemeGoldRate(req.query.gold_rate);
    const schemes = await Scheme.findAll({ where, order: [['serial_no', 'DESC'], ['created_at', 'DESC']] });

    const customerIds = [...new Set(schemes.map((s) => s.customer_id).filter(Boolean))];
    const customers = customerIds.length
      ? await Customer.findAll({ where: { id: { [Op.in]: customerIds } }, attributes: ['id', 'serial_no'] })
      : [];
    const serialByCustomerId = new Map(customers.map((c) => [c.id, c.serial_no]));

    return res.json(schemes.map((s) => ({
      ...schemeJson(s, goldRate),
      customer_serial_no: serialByCustomerId.get(s.customer_id) ?? null,
    })));
  } catch (err) {
    next(err);
  }
};

// GET /api/schemes/:id
export const getScheme = async (req, res, next) => {
  try {
    const scheme = await Scheme.findByPk(req.params.id);
    if (!scheme) return res.status(404).json({ detail: 'Scheme not found' });
    const goldRate = await resolveSchemeGoldRate(req.query.gold_rate);
    return res.json(schemeJson(scheme, goldRate));
  } catch (err) {
    next(err);
  }
};

// POST /api/schemes
export const createScheme = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      customer_id, customer_name, customer_mobile,
      plan_name, plan_type, monthly_amount, duration_months, bonus_months,
      start_date, notes, scheme_type, salesperson_id, allow_duplicate_mobile,
    } = req.body;

    if (!customer_name || !plan_name || !monthly_amount || !duration_months || !start_date) {
      await t.rollback();
      return res.status(400).json({
        detail: 'customer_name, plan_name, monthly_amount, duration_months, start_date are required',
      });
    }

    const shopId = req.user?.shop_id || branchConfig.shop_id;
    const salespersonId = salesperson_id ? String(salesperson_id).trim() : null;

    // Walk-in / new: create a Customer so they appear in the customers list.
    // Mobile is a contact/search field, not a unique key — never silently
    // reuse or rename an existing customer just because the number matches.
    // If other customers already share this mobile, surface them so the
    // cashier can pick the right one instead, unless they've confirmed this
    // is really a different person.
    let resolvedCustomerId = customer_id || null;
    let createdCustomer = null;
    if (!resolvedCustomerId) {
      const mobile = String(customer_mobile || '').trim();
      const name = String(customer_name || '').trim();
      if (!mobile) {
        await t.rollback();
        return res.status(400).json({ detail: 'customer_mobile is required for walk-in schemes' });
      }

      if (!allow_duplicate_mobile) {
        const mobileMatches = await Customer.findAll({
          where: {
            mobile,
            deleted_at: null,
            ...(shopId ? { shop_id: shopId } : {}),
          },
          transaction: t,
        });
        if (mobileMatches.length > 0) {
          await t.rollback();
          return res.status(409).json({
            detail: 'This mobile number is already used by another customer',
            code: 'DUPLICATE_MOBILE',
            existing_id: mobileMatches[0].id,
            existing: customerSummary(mobileMatches[0]),
            matches: mobileMatches.map(customerSummary),
          });
        }
      }

      createdCustomer = await Customer.create({
        id: newId(),
        serial_no: await nextShopSerial(Customer, shopId || null, t),
        shop_id: shopId || null,
        name,
        mobile,
        tag: 'regular',
      }, { transaction: t });
      resolvedCustomerId = createdCustomer.id;
    }

    const lastSerial = await Scheme.max('serial_no', { where: { shop_id: shopId }, transaction: t });
    const nextSerial = (Number(lastSerial) || 0) + 1;

    const scheme = await Scheme.create({
      id: newId(),
      serial_no: nextSerial,
      shop_id: shopId,
      customer_id: resolvedCustomerId,
      customer_name,
      customer_mobile,
      plan_name,
      plan_type: plan_type || 'amount',
      monthly_amount,
      duration_months,
      bonus_months: bonus_months != null
        ? Number(bonus_months)
        : ((scheme_type === 'swarnakala' || plan_type === 'weight') ? 0 : 1),
      start_date,
      status: 'active',
      payments: [],
      notes,
      scheme_type: scheme_type || ((plan_type === 'weight') ? 'swarnakala' : 'fixed_amount'),
      salesperson_id: salespersonId,
    }, { transaction: t });

    await t.commit();
    if (createdCustomer) {
      broadcast({ type: 'customer:changed', op: 'create', id: createdCustomer.id });
    }
    return res.status(201).json(scheme.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// POST /api/schemes/:id/payments
export const addSchemePayment = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const scheme = await Scheme.findByPk(req.params.id, { transaction: t });
    if (!scheme) {
      await t.rollback();
      return res.status(404).json({ detail: 'Scheme not found' });
    }

    if (scheme.status === 'completed' || scheme.status === 'breaked') {
      await t.rollback();
      return res.status(400).json({
        detail: scheme.status === 'breaked'
          ? 'Scheme was breaked on a bill — no further payments accepted'
          : 'Scheme is already collected on a bill — no further payments accepted',
      });
    }
    if (scheme.status !== 'active') {
      await t.rollback();
      return res.status(400).json({
        detail: `Cannot add payment to a scheme with status "${scheme.status}"`,
      });
    }

    const { amount, mode, reference, gold_rate_at_payment, grams_credited } = req.body;
    if (!amount || !mode) {
      await t.rollback();
      return res.status(400).json({ detail: 'amount and mode are required' });
    }

    const goldMode = isGoldGramScheme(scheme);

    let dayRate = Number(gold_rate_at_payment) || 0;
    let grams = 0;

    if (goldMode) {
      if (!(dayRate > 0)) {
        await t.rollback();
        return res.status(400).json({
          detail: "Today's gold rate is required so this payment can be stored as gold grams",
        });
      }
      grams = Number(grams_credited);
      if (!(grams > 0)) {
        grams = Number((Number(amount) / dayRate).toFixed(4));
      }
    } else {
      // Cash saving (11+1 etc.) — store rupees only; no gold conversion
      dayRate = 0;
      grams = 0;
    }

    const targetAmount = Number(scheme.monthly_amount) * Number(scheme.duration_months);
    const priorPayments = schemePayments(scheme);
    const existingTotal = priorPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = targetAmount - existingTotal;

    // Cap payment to remaining balance; record overpayment separately in note
    const acceptedAmount = Math.min(Number(amount), Math.max(0, remaining));
    const overpaid = Number(amount) - acceptedAmount;

    if (acceptedAmount <= 0 && scheme.status === 'active') {
      // Scheme already fully paid — reject new payment
      await t.rollback();
      return res.status(409).json({
        detail: 'Scheme is already fully paid. No further payments accepted.',
        target_amount: targetAmount,
        total_paid: existingTotal,
      });
    }

    // Recompute grams on accepted amount if payment was capped (gold schemes only)
    if (goldMode && acceptedAmount !== Number(amount) && dayRate > 0) {
      grams = Number((acceptedAmount / dayRate).toFixed(4));
    }

    const { getDefaultShopId } = await import('../services/defaultShop.js');
    const { getActiveBillingDate } = await import('../services/dailyClosingService.js');
    const shopId = scheme.shop_id || await getDefaultShopId({ transaction: t });
    const { date: businessDate } = await getActiveBillingDate({ shopId, transaction: t });

    const payment = {
      id: newId(),
      amount: acceptedAmount,
      mode,
      reference: reference || null,
      paid_at: paidAtOnTransactionDate(businessDate),
      recorded_at: new Date().toISOString(),
      business_date: businessDate,
      ...(goldMode
        ? { gold_rate_at_payment: dayRate, grams_credited: grams }
        : { gold_rate_at_payment: null, grams_credited: null }),
      ...(overpaid > 0 && { overpayment_note: `Customer paid ${formatINR(amount)} — ${formatINR(overpaid)} excess returned/adjusted` }),
    };

    const updatedPayments = [...priorPayments, payment];

    const totalPaid = updatedPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const status =
      scheme.status === 'active' && totalPaid >= targetAmount ? 'matured' : scheme.status;

    await scheme.update({ payments: updatedPayments, status }, { transaction: t });

    const { postSchemePaymentJournal } = await import('../services/ledgerService.js');
    await postSchemePaymentJournal({
      shopId,
      schemeId: scheme.id,
      paymentId: payment.id,
      amount: acceptedAmount,
      mode,
      entryDate: businessDate,
      requestId: `scheme-pay:${payment.id}`,
      userId: req.user?.id || null,
      transaction: t,
    });

    await t.commit();
    return res.json(scheme.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// POST /api/schemes/:id/redeem
export const redeemScheme = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const scheme = await Scheme.findByPk(req.params.id, { transaction: t });
    if (!scheme) {
      await t.rollback();
      return res.status(404).json({ detail: 'Scheme not found' });
    }

    if (!['active', 'matured'].includes(scheme.status)) {
      await t.rollback();
      return res.status(400).json({ detail: 'Only active or matured schemes can be redeemed' });
    }

    await scheme.update({
      status: schemeStatusAfterRedemption(scheme),
      redeemed_at: nowIso(),
    }, { transaction: t });

    await t.commit();
    return res.json(scheme.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
