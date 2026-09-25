import { Op } from 'sequelize';
import sequelize, { likeOp } from '../db.js';
import {
  Customer, Invoice, Scheme, Payment, Quotation, Order, CustomerAdvance, CreditNote,
} from '../models/index.js';
import { parseJsonField } from '../utils.js';
import { newId, nextShopSerial } from '../utils.js';
import branchConfig from '../config/branchConfig.js';
import { broadcast } from '../services/wsServer.js';
import { wantsHiddenBills, withNotHidden, isVoidOrFullyReturnedStatus } from '../utils/invoiceVisibility.js';
import { toMoneyNumber } from '../utils/money.js';
import { newestTransactionFirstOrder } from '../utils/reportQuery.js';

function includeHiddenFromReq(req) {
  return wantsHiddenBills({ ...req.query, _role: req.user?.role });
}

function customerInvoiceWhere(req, extra = {}) {
  return includeHiddenFromReq(req) ? extra : withNotHidden(extra);
}

// Invoice.toJSON() returns the Sequelize attribute name `createdAt` (the
// model is `underscored: true`, which renames the DB column, not the JS
// attribute) — several frontend screens read snake_case `created_at`, so
// mirror it across just like controllers/invoices.js's invoiceJson() does.
function withSnakeCreatedAt(row) {
  const j = row?.toJSON ? row.toJSON() : row;
  const created = j.created_at || j.createdAt || null;
  if (created && !j.created_at) j.created_at = created;
  return j;
}

// GET /api/customers
export const listCustomers = async (req, res, next) => {
  try {
    const { q, tag } = req.query;
    const where = { deleted_at: null };

    const needle = String(q || req.query.search || '').trim();
    if (needle) {
      where[Op.or] = [
        { name: { [likeOp]: `%${needle}%` } },
        { mobile: { [likeOp]: `%${needle}%` } },
        { email: { [likeOp]: `%${needle}%` } },
      ];
    }
    if (tag) where.tag = tag;

    const customers = await Customer.findAll({ where, order: [['serial_no', 'ASC']] });
    const customerIds = customers.map((c) => c.id);

    // Batch-fetch all invoices for these customers, aggregate metal weights in JS
    const allInvoices = customerIds.length > 0
      ? await Invoice.findAll({
        where: customerInvoiceWhere(req, { customer_id: { [Op.in]: customerIds } }),
        attributes: ['customer_id', 'items'],
      })
      : [];

    const weightMap = {};
    for (const inv of allInvoices) {
      const cid = inv.customer_id;
      if (!weightMap[cid]) weightMap[cid] = { gold_gross: 0, gold_net: 0, silver_gross: 0, silver_net: 0 };
      const items = parseJsonField(inv.items, []);
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const metal = (item.metal || item.metal_name || item.metal_type || '').toLowerCase();
        const qty = Number(item.quantity) || 1;
        const gw = (Number(item.gross_weight) || 0) * qty;
        const nw = (Number(item.net_weight) || 0) * qty;
        if (metal.includes('gold'))        { weightMap[cid].gold_gross += gw;   weightMap[cid].gold_net += nw; }
        else if (metal.includes('silver')) { weightMap[cid].silver_gross += gw; weightMap[cid].silver_net += nw; }
      }
    }

    return res.json(customers.map((c) => {
      const w = weightMap[c.id] || { gold_gross: 0, gold_net: 0, silver_gross: 0, silver_net: 0 };
      return {
        ...c.toJSON(),
        gold_gross:   +w.gold_gross.toFixed(3),
        gold_net:     +w.gold_net.toFixed(3),
        silver_gross: +w.silver_gross.toFixed(3),
        silver_net:   +w.silver_net.toFixed(3),
      };
    }));
  } catch (err) {
    next(err);
  }
};

// GET /api/customers/:id
export const getCustomer = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer || customer.deleted_at) return res.status(404).json({ detail: 'Customer not found' });

    const [invoices, schemes] = await Promise.all([
      Invoice.findAll({
        where: customerInvoiceWhere(req, { customer_id: req.params.id }),
        order: newestTransactionFirstOrder(),
      }),
      Scheme.findAll({ where: { customer_id: req.params.id }, order: [['created_at', 'DESC']] }),
    ]);

    const customerJson = customer.toJSON();
    customerJson.total_purchases = toMoneyNumber(invoices
      .filter((i) => !isVoidOrFullyReturnedStatus(i.status))
      .reduce((s, i) => s + (Number(i.grand_total) || 0), 0));

    return res.json({
      customer: customerJson,
      invoices: invoices.map(withSnakeCreatedAt),
      schemes: schemes.map((s) => s.toJSON()),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/customers/:id/360 — aggregated customer view
export const getCustomer360 = async (req, res, next) => {
  try {
    const customer = await Customer.findByPk(req.params.id);
    if (!customer || customer.deleted_at) return res.status(404).json({ detail: 'Customer not found' });
    const id = req.params.id;
    const includeHidden = includeHiddenFromReq(req);
    const invWhere = customerInvoiceWhere(req, { customer_id: id });
    const [
      invoices,
      schemes,
      advancesBal,
      payments,
      quotations,
      oldGold,
      creditNotes,
      bookings,
      hiddenCustomerInvoices,
    ] = await Promise.all([
      Invoice.findAll({
        where: invWhere,
        order: newestTransactionFirstOrder(),
      }),
      Scheme.findAll({ where: { customer_id: id }, order: [['created_at', 'DESC']] }),
      import('../services/advanceService.js').then((m) => m.getCustomerAdvanceBalance(id)).catch(() => ({ balance: 0, advances: [] })),
      import('../models/index.js').then(({ Payment }) =>
        Payment.findAll({ where: { customer_id: id }, order: [['paid_at', 'DESC']], limit: 50 })).catch(() => []),
      import('../models/index.js').then(({ Quotation }) =>
        Quotation.findAll({ where: { customer_id: id }, order: newestTransactionFirstOrder(), limit: 20 })).catch(() => []),
      import('../models/index.js').then(({ OldGoldReceipt }) =>
        OldGoldReceipt.findAll({ where: { customer_id: id }, order: [['created_at', 'DESC']], limit: 20 })).catch(() => []),
      import('../models/index.js').then(({ CreditNote }) =>
        CreditNote.findAll({ where: { customer_id: id }, order: [['created_at', 'DESC']], limit: 20 })).catch(() => []),
      import('../services/quotationBookingService.js')
        .then((m) => m.buildCustomerBookingLedger(id))
        .catch(() => []),
      includeHidden
        ? Promise.resolve([])
        : Invoice.findAll({ where: { customer_id: id, is_hidden: true }, attributes: ['id'] }),
    ]);

    const hiddenIds = new Set((hiddenCustomerInvoices || []).map((i) => i.id));
    const hideLinked = (row) => row?.invoice_id && hiddenIds.has(row.invoice_id);

    let advanceBalance = Number(advancesBal.balance) || 0;
    if (hiddenIds.size) {
      const { CustomerAdvanceApplication } = await import('../models/index.js');
      const hiddenApps = await CustomerAdvanceApplication.findAll({
        where: { invoice_id: { [Op.in]: [...hiddenIds] } },
        attributes: ['amount'],
      }).catch(() => []);
      advanceBalance += (hiddenApps || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    }

    const customerJson = customer.toJSON();
    customerJson.total_purchases = toMoneyNumber(invoices
      .filter((i) => !isVoidOrFullyReturnedStatus(i.status))
      .reduce((s, i) => s + (Number(i.grand_total) || 0), 0));

    return res.json({
      customer: customerJson,
      invoices: invoices.slice(0, 50).map(withSnakeCreatedAt),
      schemes: schemes.map((s) => s.toJSON()),
      advance_balance: toMoneyNumber(advanceBalance),
      advances: (advancesBal.advances || []).map((a) => (a.toJSON ? a.toJSON() : a)),
      payments: payments.filter((r) => !hideLinked(r)).map((r) => (r.toJSON ? r.toJSON() : r)),
      quotations: quotations.map((r) => (r.toJSON ? r.toJSON() : r)),
      bookings,
      old_gold_receipts: oldGold.filter((r) => !hideLinked(r)).map((r) => (r.toJSON ? r.toJSON() : r)),
      credit_notes: creditNotes.filter((r) => !hideLinked(r)).map((r) => (r.toJSON ? r.toJSON() : r)),
    });
  } catch (err) {
    next(err);
  }
};

function customerSummary(c) {
  return {
    id: c.id,
    name: c.name,
    mobile: c.mobile,
    pan_number: c.pan_number || null,
    aadhaar_number: c.aadhaar_number || null,
    tag: c.tag || 'regular',
  };
}

// POST /api/customers
export const createCustomer = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const {
      name, mobile, email, address, gst_number, pan_number, pan_image,
      aadhaar_number, dob, anniversary, tag, notes, allow_duplicate_mobile,
    } = req.body;
    if (!name || !mobile) {
      await t.rollback();
      return res.status(400).json({ detail: 'name and mobile are required' });
    }

    const shopId = req.user?.shop_id || branchConfig.shop_id || null;
    const normalizedMobile = String(mobile).trim();
    const normalizedAadhaar = aadhaar_number ? String(aadhaar_number).replace(/\D/g, '') : '';
    const normalizedPan = pan_number ? String(pan_number).trim().toUpperCase() : '';
    const shopScope = shopId ? { shop_id: shopId } : {};

    // Mobile is a contact/search field, not a unique identifier — multiple
    // customers may share one. Surface the matches so the caller can pick an
    // existing customer instead, but let them proceed and create a new,
    // distinct customer record when they explicitly confirm that's intended.
    if (!allow_duplicate_mobile) {
      const mobileMatches = await Customer.findAll({
        where: { ...shopScope, mobile: normalizedMobile, deleted_at: null },
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

    if (normalizedAadhaar) {
      const dupAadhaar = await Customer.findOne({
        where: { ...shopScope, aadhaar_number: normalizedAadhaar, deleted_at: null },
        transaction: t,
      });
      if (dupAadhaar) {
        await t.rollback();
        return res.status(409).json({
          detail: 'This Aadhaar number is already registered to another customer',
          code: 'DUPLICATE_AADHAAR',
          existing_id: dupAadhaar.id,
          existing: customerSummary(dupAadhaar),
        });
      }
    }

    if (normalizedPan) {
      const dupPan = await Customer.findOne({
        where: { ...shopScope, pan_number: normalizedPan, deleted_at: null },
        transaction: t,
      });
      if (dupPan) {
        await t.rollback();
        return res.status(409).json({
          detail: 'This PAN number is already registered to another customer',
          code: 'DUPLICATE_PAN',
          existing_id: dupPan.id,
          existing: customerSummary(dupPan),
        });
      }
    }

    const customer = await Customer.create({
      id: newId(),
      serial_no: await nextShopSerial(Customer, shopId, t),
      shop_id: shopId,
      name,
      mobile: normalizedMobile,
      email,
      address,
      gst_number,
      pan_number: normalizedPan || null,
      pan_image: pan_image || null,
      aadhaar_number: normalizedAadhaar || null,
      dob: dob || null,
      anniversary: anniversary || null,
      tag: tag || 'regular',
      notes,
    }, { transaction: t });

    await t.commit();
    broadcast({ type: 'customer:changed', op: 'create', id: customer.id });
    return res.status(201).json(customer.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// PATCH /api/customers/:id
export const updateCustomer = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const customer = await Customer.findByPk(req.params.id, { transaction: t });
    if (!customer || customer.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Customer not found' });
    }

    const shopId = customer.shop_id || req.user?.shop_id || branchConfig.shop_id || null;
    const shopScope = shopId ? { shop_id: shopId } : {};

    if (req.body.mobile != null && String(req.body.mobile).trim() !== String(customer.mobile || '')) {
      const normalizedMobile = String(req.body.mobile).trim();
      if (!req.body.allow_duplicate_mobile) {
        const mobileMatches = await Customer.findAll({
          where: { ...shopScope, mobile: normalizedMobile, deleted_at: null, id: { [Op.ne]: customer.id } },
          transaction: t,
        });
        if (mobileMatches.length > 0) {
          await t.rollback();
          return res.status(409).json({
            detail: `Customer with mobile ${normalizedMobile} already exists`,
            code: 'DUPLICATE_MOBILE',
            existing_id: mobileMatches[0].id,
            existing: customerSummary(mobileMatches[0]),
            matches: mobileMatches.map(customerSummary),
          });
        }
      }
      req.body.mobile = normalizedMobile;
    }

    if (req.body.aadhaar_number != null) {
      const normalizedAadhaar = String(req.body.aadhaar_number).replace(/\D/g, '');
      if (normalizedAadhaar && normalizedAadhaar !== String(customer.aadhaar_number || '')) {
        const dupAadhaar = await Customer.findOne({
          where: { ...shopScope, aadhaar_number: normalizedAadhaar, deleted_at: null, id: { [Op.ne]: customer.id } },
          transaction: t,
        });
        if (dupAadhaar) {
          await t.rollback();
          return res.status(409).json({
            detail: 'This Aadhaar number is already registered to another customer',
            code: 'DUPLICATE_AADHAAR',
            existing_id: dupAadhaar.id,
            existing: customerSummary(dupAadhaar),
          });
        }
      }
      req.body.aadhaar_number = normalizedAadhaar || null;
    }

    if (req.body.pan_number != null) {
      const normalizedPan = String(req.body.pan_number).trim().toUpperCase();
      if (normalizedPan && normalizedPan !== String(customer.pan_number || '')) {
        const dupPan = await Customer.findOne({
          where: { ...shopScope, pan_number: normalizedPan, deleted_at: null, id: { [Op.ne]: customer.id } },
          transaction: t,
        });
        if (dupPan) {
          await t.rollback();
          return res.status(409).json({
            detail: 'This PAN number is already registered to another customer',
            code: 'DUPLICATE_PAN',
            existing_id: dupPan.id,
            existing: customerSummary(dupPan),
          });
        }
      }
      req.body.pan_number = normalizedPan || null;
    }

    delete req.body.allow_duplicate_mobile;
    await customer.update(req.body, { transaction: t });

    await t.commit();
    broadcast({ type: 'customer:changed', op: 'update', id: customer.id });
    return res.json(customer.toJSON());
  } catch (err) {
    await t.rollback();
    next(err);
  }
};

// DELETE /api/customers/:id — permission-gated (customers.delete); only
// shop_owner/super_admin have this by default, see defaultPermissionsForRole.
export const deleteCustomer = async (req, res, next) => {
  const t = await sequelize.transaction();
  try {
    const customer = await Customer.findByPk(req.params.id, { transaction: t });
    if (!customer || customer.deleted_at) {
      await t.rollback();
      return res.status(404).json({ detail: 'Customer not found' });
    }

    // Refuse to delete a customer with any transaction history — invoices,
    // schemes, payments, etc. are legal/financial records that must stay
    // attached to a real customer_id (GST filings, audits). Mirrors the
    // same "has financial history" guard products.js uses.
    const id = customer.id;
    const [invoices, schemes, payments, quotations, orders, advances, creditNotes] = await Promise.all([
      Invoice.count({ where: { customer_id: id }, transaction: t }),
      Scheme.count({ where: { customer_id: id }, transaction: t }),
      Payment.count({ where: { customer_id: id }, transaction: t }),
      Quotation.count({ where: { customer_id: id }, transaction: t }),
      Order.count({ where: { customer_id: id }, transaction: t }),
      CustomerAdvance.count({ where: { customer_id: id }, transaction: t }),
      CreditNote.count({ where: { customer_id: id }, transaction: t }),
    ]);
    const historyCount = invoices + schemes + payments + quotations + orders + advances + creditNotes;
    if (historyCount > 0) {
      await t.rollback();
      return res.status(409).json({
        detail: 'This customer has invoices, payments, or other transaction history and cannot be deleted.',
        code: 'CUSTOMER_HAS_HISTORY',
        history_count: historyCount,
      });
    }

    await customer.update({ deleted_at: new Date() }, { transaction: t });

    await t.commit();
    broadcast({ type: 'customer:changed', op: 'delete', id: customer.id });
    return res.json({ message: 'Customer deleted', id: customer.id });
  } catch (err) {
    await t.rollback();
    next(err);
  }
};
