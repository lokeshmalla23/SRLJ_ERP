import { Op, fn, col } from 'sequelize';
import { Customer, Invoice, CustomerAdvance, CreditNote, Payment, Scheme, Order } from '../../models/index.js';
import { dateOnlyParts, formatDateOnly, normalizeOccasionQuery, occasionMatches, isTodayOccasion, sortOccasionRows } from '../../utils/occasionDate.js';
import { toMoneyNumber } from '../../utils/money.js';
import { parsePagination, paginatedResult } from '../../utils/reportQuery.js';
import { withNotHidden, NOT_VOID_OR_RETURNED, wantsHiddenBills } from '../../utils/invoiceVisibility.js';
import { invoiceOccurredAt } from '../../utils/invoiceRead.js';
import { parseJsonField } from '../../utils.js';

function baseCustomerWhere(query) {
  const where = {};
  if (query.q) {
    where[Op.or] = [
      { name: { [Op.like]: `%${query.q}%` } },
      { mobile: { [Op.like]: `%${query.q}%` } },
    ];
  }
  if (query.tag) where.tag = query.tag;
  return where;
}

/** Batch-computes last_purchase_at + visit_count from real Invoice data — the old
 * Reports.jsx read these directly off the Customer payload, but neither field
 * exists on the model/listCustomers response, so those columns were always blank. */
async function withPurchaseStats(customers) {
  const ids = customers.map((c) => c.id);
  if (!ids.length) return customers.map((c) => ({ ...(c.toJSON ? c.toJSON() : c), last_purchase_at: null, visit_count: 0, total_spent: 0 }));

  const rows = await Invoice.findAll({
    where: withNotHidden({ customer_id: { [Op.in]: ids }, status: NOT_VOID_OR_RETURNED }),
    attributes: [
      [col('customer_id'), 'customer_id'],
      [fn('COUNT', col('id')), 'visit_count'],
      [fn('MAX', col('created_at')), 'last_purchase_at'],
      [fn('COALESCE', fn('SUM', col('grand_total')), 0), 'total_spent'],
    ],
    group: ['customer_id'],
    raw: true,
  });
  const statsMap = new Map(rows.map((r) => [r.customer_id, r]));

  return customers.map((c) => {
    const json = c.toJSON ? c.toJSON() : c;
    const stats = statsMap.get(c.id);
    return {
      ...json,
      last_purchase_at: stats?.last_purchase_at || null,
      visit_count: Number(stats?.visit_count) || 0,
      total_spent: toMoneyNumber(stats?.total_spent),
    };
  });
}

// GET /api/reports/customers/list
export const listCustomersReport = async (req, res, next) => {
  try {
    const where = baseCustomerWhere(req.query);
    const { limit, offset } = parsePagination(req.query);
    const { count, rows } = await Customer.findAndCountAll({ where, order: [['serial_no', 'ASC']], limit, offset });
    const data = await withPurchaseStats(rows);
    return res.json(paginatedResult(count, data));
  } catch (err) {
    next(err);
  }
};

function occasionWhere(field) {
  return {
    [Op.and]: [
      { [field]: { [Op.ne]: null } },
      { [field]: { [Op.ne]: '' } },
    ],
  };
}

function occasionValue(model, field) {
  if (!model) return null;
  if (typeof model.getDataValue === 'function') {
    const raw = model.getDataValue(field);
    if (raw != null && raw !== '') return raw;
  }
  return model[field];
}

function occasionRow(source, field, dateValue) {
  return {
    id: source.id || null,
    serial_no: source.serial_no || null,
    name: source.name || source.customer_name || '',
    mobile: source.mobile || source.customer_mobile || '',
    tag: source.tag || null,
    [field]: formatDateOnly(dateValue) || dateValue,
    is_today: isTodayOccasion(dateValue),
  };
}

async function occasionReport(field, query) {
  const filters = normalizeOccasionQuery(query);
  const orderField = field === 'dob' ? 'customer_dob' : 'customer_anniversary';
  const [customers, orders] = await Promise.all([
    Customer.findAll({ where: occasionWhere(field) }),
    Order.findAll({
      where: occasionWhere(orderField),
      attributes: ['id', 'customer_id', 'customer_name', 'customer_mobile', orderField],
    }).catch(() => []),
  ]);

  const byKey = new Map();
  for (const c of customers) {
    const json = c.toJSON ? c.toJSON() : c;
    const date = occasionValue(c, field) || json[field];
    if (!dateOnlyParts(date)) continue;
    const key = json.id || `mobile:${json.mobile || ''}`;
    byKey.set(key, occasionRow(json, field, date));
  }
  for (const o of orders) {
    const json = o.toJSON ? o.toJSON() : o;
    const date = occasionValue(o, orderField) || json[orderField];
    if (!dateOnlyParts(date)) continue;
    const key = json.customer_id || (json.customer_mobile ? `mobile:${json.customer_mobile}` : `order:${json.id}`);
    if (byKey.has(key)) continue;
    byKey.set(key, occasionRow({
      id: json.customer_id || json.id,
      name: json.customer_name,
      mobile: json.customer_mobile,
    }, field, date));
  }

  const matching = sortOccasionRows(
    [...byKey.values()].filter((row) => occasionMatches(row[field], filters)),
    field,
  );
  return matching;
}

// GET /api/reports/customers/birthday?month=8  (defaults to real calendar month)
export const birthdayReport = async (req, res, next) => {
  try {
    const filters = normalizeOccasionQuery(req.query);
    const data = await occasionReport('dob', req.query);
    const today = data.filter((row) => row.is_today);
    return res.json({ data, today, today_count: today.length, month: filters.month });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/customers/anniversary?month=8
export const anniversaryReport = async (req, res, next) => {
  try {
    const filters = normalizeOccasionQuery(req.query);
    const data = await occasionReport('anniversary', req.query);
    const today = data.filter((row) => row.is_today);
    return res.json({ data, today, today_count: today.length, month: filters.month });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/customers/pending-balance — unspent advance/credit balance
// (this system has no "amount due FROM customer" concept: invoices must be
// paid in full at creation — see billingCalc.validatePayments — so the only
// real "pending balance" is money a customer has already paid in advance that
// hasn't been applied to an invoice yet).
export const pendingBalance = async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);
    const advances = await CustomerAdvance.findAll({ where: { status: 'open' } });
    const byCustomer = new Map();
    for (const a of advances) {
      const key = a.customer_id;
      byCustomer.set(key, (byCustomer.get(key) || 0) + (Number(a.remaining_amount) || 0));
    }
    const entries = [...byCustomer.entries()].filter(([, bal]) => bal > 0);
    const customerIds = entries.map(([id]) => id);
    const customers = customerIds.length ? await Customer.findAll({ where: { id: { [Op.in]: customerIds } } }) : [];
    const nameMap = new Map(customers.map((c) => [c.id, c]));

    const data = entries
      .map(([customerId, balance]) => ({
        customer_id: customerId,
        serial_no: nameMap.get(customerId)?.serial_no || null,
        customer_name: nameMap.get(customerId)?.name || 'Unknown',
        mobile: nameMap.get(customerId)?.mobile || null,
        pending_balance: toMoneyNumber(balance),
      }))
      .sort((a, b) => b.pending_balance - a.pending_balance);

    return res.json(paginatedResult(data.length, data.slice(offset, offset + limit)));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/customers/:id/ledger
export const customerLedger = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ detail: 'Customer not found' });

    const customerId = req.params.id;
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const invWhere = includeHidden
      ? { customer_id: customerId }
      : withNotHidden({ customer_id: customerId });
    const [invoices, creditNotes, payments, schemes] = await Promise.all([
      Invoice.findAll({
        where: invWhere,
        order: [['created_at', 'ASC']],
      }),
      CreditNote.findAll({ where: { customer_id: customerId }, order: [['created_at', 'ASC']] }).catch(() => []),
      Payment.findAll({ where: { customer_id: customerId, status: { [Op.ne]: 'void' } }, order: [['created_at', 'ASC']] }).catch(() => []),
      Scheme.findAll({ where: { customer_id: customerId } }).catch(() => []),
    ]);

    // Sales invoices themselves are intentionally NOT shown as their own row here —
    // only what actually moved money (the payments below, each labelled with the
    // invoice it belongs to). Still needed as a lookup so every invoice-linked
    // payment can name which invoice it was for.
    const invoiceNoById = new Map(invoices.map((i) => [i.id, i.invoice_no]));

    const raw = [];
    // Advance amounts themselves are read from the Payment rows receiveAdvance()/
    // refundAdvance() already write (meta.kind: customer_advance / customer_advance_refund)
    // — adding a second row straight from CustomerAdvance for the same event would double it.
    for (const cn of creditNotes) {
      if (!includeHidden && cn.invoice_id && !invoiceNoById.has(cn.invoice_id)) continue;
      raw.push({
        type: 'credit_note',
        reference: cn.credit_note_no,
        date: invoiceOccurredAt(cn),
        debit: 0,
        credit: toMoneyNumber(cn.grand_total),
        particulars: cn.reason || 'Sales return',
        id: cn.id,
        invoice_id: cn.invoice_id,
      });
    }
    // billingService.createInvoice() writes a Payment row with mode:'advance' purely as
    // bookkeeping for the invoice's own payment-method breakdown — the real cash-in was
    // already recorded as its own "Advance received" row when the advance was first taken,
    // so this mirror row would double-count the exact same money if shown here too.
    for (const p of payments) {
      if (String(p.mode || '').toLowerCase() === 'advance') continue;
      if (!includeHidden && p.invoice_id && !invoiceNoById.has(p.invoice_id)) continue;
      const amt = toMoneyNumber(p.amount);
      const isRefund = amt < 0;
      const kind = p.meta && typeof p.meta === 'object' ? p.meta.kind : null;
      const isAdvance = kind === 'customer_advance';
      const isAdvanceRefund = kind === 'customer_advance_refund';
      // Reference (e.g. "Booking QT-2026-010 #1") is returned as its own `reference`
      // field below — the frontend appends it to the description itself, so it must
      // NOT also be baked into `particulars` here, or it shows up twice.
      let particulars;
      if (isRefund) {
        particulars = isAdvanceRefund
          ? `Advance refund (${p.mode})`
          : `Refund (${p.mode}) — ${kind === 'invoice_return_refund' ? 'return' : 'cancelled'} invoice`;
      } else {
        particulars = isAdvance ? `Advance received (${p.mode})` : `Payment (${p.mode})`;
      }
      // Name the invoice this payment actually belongs to (e.g. "Balance due" /
      // "Old Gold Exchange" / a UPI reference, plus which bill it settled) —
      // never fall back to the raw Payment row id, which isn't meaningful to a
      // shop owner reading this statement.
      const invoiceNo = p.invoice_id ? invoiceNoById.get(p.invoice_id) : null;
      const referenceParts = [p.reference, invoiceNo ? `Invoice ${invoiceNo}` : null].filter(Boolean);
      raw.push({
        type: isRefund ? (isAdvanceRefund ? 'advance_refund' : 'refund') : (isAdvance ? 'advance' : 'payment'),
        reference: referenceParts.join(' · ') || null,
        date: invoiceOccurredAt(p),
        debit: isRefund ? Math.abs(amt) : 0,
        credit: isRefund ? 0 : amt,
        particulars,
        id: p.id,
        invoice_id: p.invoice_id,
      });
    }
    // Scheme installments live only on Scheme.payments (JSONB) — unlike advances
    // they're never mirrored into the Payment table, so without this loop every
    // Gold Saving Scheme collection was invisible here.
    for (const s of schemes) {
      const schemePayments = parseJsonField(s.payments, []);
      for (const p of schemePayments) {
        const amt = toMoneyNumber(p.amount);
        if (!(amt > 0)) continue;
        raw.push({
          type: 'scheme',
          reference: s.plan_name || null,
          date: invoiceOccurredAt(p),
          debit: 0,
          credit: amt,
          particulars: `Scheme installment (${p.mode || 'cash'})`,
          id: p.id || `${s.id}-${p.paid_at}`,
          invoice_id: null,
        });
      }
    }

    // Every money movement always shows here, full stop — payment splits,
    // advances, and refunds — even ones that are fully settled and net to zero.
    // This is a complete per-customer activity log, not just an "unresolved
    // balance" view; Total Purchases / Advance Balance at the top of the
    // customer page are what show the net current position.
    raw.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Optional ?from=&to= (YYYY-MM-DD) window — everything before `from` is
    // folded into an opening_balance (like the shop-wide ERP Statement does),
    // so the running balance shown alongside a filtered window still reflects
    // the customer's true position, not just what happened inside the window.
    const { from, to } = req.query;
    const fromDt = from ? new Date(`${from}T00:00:00`) : null;
    const toDt = to ? new Date(`${to}T23:59:59.999`) : null;

    // Balance reads like a customer wallet, not a textbook ledger: credit (money the
    // shop is holding for/owes the customer — an advance) is POSITIVE, debit (money
    // that flowed back out, or that the customer owes) is NEGATIVE.
    let openingBalance = 0;
    const inRange = [];
    for (const e of raw) {
      const d = new Date(e.date);
      if (fromDt && d < fromDt) {
        openingBalance = toMoneyNumber(openingBalance + e.credit - e.debit);
        continue;
      }
      if (toDt && d > toDt) continue;
      inRange.push(e);
    }

    let balance = openingBalance;
    let totalDebit = 0;
    let totalCredit = 0;
    const data = inRange.map((e) => {
      balance = toMoneyNumber(balance + e.credit - e.debit);
      totalDebit = toMoneyNumber(totalDebit + e.debit);
      totalCredit = toMoneyNumber(totalCredit + e.credit);
      return { ...e, balance };
    });
    // Balance is computed oldest -> newest above (each entry depends on every
    // prior one), but the ledger reads newest-first — only display order flips.
    data.reverse();

    return res.json({
      customer: customer.toJSON(),
      from: from || null,
      to: to || null,
      opening_balance: openingBalance,
      data,
      total_debit: totalDebit,
      total_credit: totalCredit,
      closing_balance: balance,
    });
  } catch (err) {
    next(err);
  }
};

function round3(n) {
  return Math.max(0, Math.round((Number(n) || 0) * 1000) / 1000);
}

// GET /api/reports/customers/:id/metal-summary — net weight bought per metal/purity,
// used by the customer 360 page's "Metals purchased" cards.
export const customerMetalSummary = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer) return res.status(404).json({ detail: 'Customer not found' });

    const customerId = req.params.id;
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const invWhere = includeHidden
      ? { customer_id: customerId, status: NOT_VOID_OR_RETURNED }
      : withNotHidden({ customer_id: customerId, status: NOT_VOID_OR_RETURNED });
    const [invoices, creditNotes] = await Promise.all([
      Invoice.findAll({ where: invWhere }),
      CreditNote.findAll({ where: { customer_id: customerId } }),
    ]);

    const invoiceItemsById = new Map(invoices.map((inv) => [inv.id, parseJsonField(inv.items, [])]));

    // key: "metal||purity" -> { metal, purity, gross, net }
    const buckets = new Map();
    const bucketFor = (metal, purity) => {
      const key = `${metal}||${purity}`;
      if (!buckets.has(key)) buckets.set(key, { metal, purity, gross: 0, net: 0 });
      return buckets.get(key);
    };

    for (const items of invoiceItemsById.values()) {
      for (const it of items) {
        const qty = Number(it.quantity) || 1;
        const metal = it.metal_name || it.metal || 'Other';
        const purity = it.purity || it.purity_code || '—';
        const b = bucketFor(metal, purity);
        b.gross += (Number(it.gross_weight) || 0) * qty;
        b.net += (Number(it.net_weight) || 0) * qty;
      }
    }

    // Net out returned quantities against the original line's per-unit weight.
    // A credit note against an invoice that's excluded above (fully cancelled/
    // returned) has nothing to net — that invoice's weight was never counted.
    for (const cn of creditNotes) {
      const invItems = invoiceItemsById.get(cn.invoice_id);
      if (!invItems) continue;
      const cnItems = parseJsonField(cn.items, []);
      for (const line of cnItems) {
        // Bullion/pure-metal lines have no product_id — can't be matched back
        // to a specific line, so they're left un-netted (rare in practice).
        if (!line.product_id) continue;
        const invLine = invItems.find((i) => i.product_id === line.product_id);
        if (!invLine) continue;
        const qty = Number(line.quantity) || 0;
        const metal = invLine.metal_name || invLine.metal || 'Other';
        const purity = invLine.purity || invLine.purity_code || '—';
        const b = bucketFor(metal, purity);
        b.gross -= (Number(invLine.gross_weight) || 0) * qty;
        b.net -= (Number(invLine.net_weight) || 0) * qty;
      }
    }

    const byMetal = new Map();
    for (const b of buckets.values()) {
      const gross = round3(b.gross);
      const net = round3(b.net);
      if (gross <= 0 && net <= 0) continue;
      if (!byMetal.has(b.metal)) byMetal.set(b.metal, []);
      byMetal.get(b.metal).push({ purity: b.purity, gross_weight: gross, net_weight: net });
    }

    const metals = [...byMetal.entries()]
      .map(([metal, rows]) => {
        rows.sort((a, c) => a.purity.localeCompare(c.purity));
        return {
          metal,
          rows,
          total_gross_weight: round3(rows.reduce((s, r) => s + r.gross_weight, 0)),
          total_net_weight: round3(rows.reduce((s, r) => s + r.net_weight, 0)),
        };
      })
      .filter((m) => m.total_gross_weight > 0 || m.total_net_weight > 0)
      .sort((a, b) => a.metal.localeCompare(b.metal));

    return res.json({ metals });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/customers/purchase-frequency
export const purchaseFrequency = async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);
    const rows = await Invoice.findAll({
      where: withNotHidden({ status: NOT_VOID_OR_RETURNED, customer_id: { [Op.ne]: null } }),
      attributes: [
        [col('customer_id'), 'customer_id'],
        [fn('COUNT', col('id')), 'invoice_count'],
        [fn('COALESCE', fn('SUM', col('grand_total')), 0), 'total_spent'],
        [fn('MIN', col('created_at')), 'first_purchase'],
        [fn('MAX', col('created_at')), 'last_purchase'],
      ],
      group: ['customer_id'],
      order: [[fn('COUNT', col('id')), 'DESC']],
      raw: true,
    });
    const customers = await Customer.findAll({ where: { id: { [Op.in]: rows.map((r) => r.customer_id) } } });
    const nameMap = new Map(customers.map((c) => [c.id, c]));

    const data = rows.map((r) => ({
      customer_id: r.customer_id,
      serial_no: nameMap.get(r.customer_id)?.serial_no || null,
      customer_name: nameMap.get(r.customer_id)?.name || 'Unknown',
      invoice_count: Number(r.invoice_count) || 0,
      total_spent: toMoneyNumber(r.total_spent),
      first_purchase: r.first_purchase,
      last_purchase: r.last_purchase,
    }));

    return res.json(paginatedResult(data.length, data.slice(offset, offset + limit)));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/customers/loyal — highest repeat-purchase frequency
export const loyalCustomers = async (req, res, next) => {
  req.query.limit = req.query.limit || 25;
  return purchaseFrequency(req, res, next);
};

// GET /api/reports/customers/inactive?min_days=90
export const inactiveCustomers = async (req, res, next) => {
  try {
    const minDays = Math.max(parseInt(req.query.min_days, 10) || 90, 0);
    const { limit, offset } = parsePagination(req.query);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - minDays);

    const allInvoiceStats = await Invoice.findAll({
      where: withNotHidden({ status: NOT_VOID_OR_RETURNED, customer_id: { [Op.ne]: null } }),
      attributes: [[col('customer_id'), 'customer_id'], [fn('MAX', col('created_at')), 'last_purchase']],
      group: ['customer_id'],
      raw: true,
    });
    const lastPurchaseMap = new Map(allInvoiceStats.map((r) => [r.customer_id, r.last_purchase]));

    const customers = await Customer.findAll();
    const inactive = customers
      .map((c) => ({ ...c.toJSON(), last_purchase_at: lastPurchaseMap.get(c.id) || null }))
      .filter((c) => !c.last_purchase_at || new Date(c.last_purchase_at) < cutoff);
    inactive.sort((a, b) => new Date(a.last_purchase_at || 0) - new Date(b.last_purchase_at || 0));

    return res.json(paginatedResult(inactive.length, inactive.slice(offset, offset + limit)));
  } catch (err) {
    next(err);
  }
};
