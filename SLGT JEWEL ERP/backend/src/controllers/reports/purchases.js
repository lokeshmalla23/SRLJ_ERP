import { Op, fn, col } from 'sequelize';
import { Purchase, Vendor } from '../../models/index.js';
import { toMoneyNumber } from '../../utils/money.js';
import { parsePagination, parseDateRange, paginatedResult } from '../../utils/reportQuery.js';

const NOT_VOIDED = { [Op.ne]: 'voided' };

// GET /api/reports/purchases/vendor-ledger?vendor_id=...
export const vendorLedger = async (req, res, next) => {
  try {
    const { vendor_id } = req.query;
    if (!vendor_id) return res.status(400).json({ detail: 'vendor_id is required' });
    const vendor = await Vendor.findByPk(vendor_id);
    if (!vendor) return res.status(404).json({ detail: 'Vendor not found' });

    const { limit, offset } = parsePagination(req.query);
    const { count, rows } = await Purchase.findAndCountAll({
      where: { vendor_id, status: NOT_VOIDED },
      order: [['purchase_date', 'DESC']],
      limit,
      offset,
    });

    let runningBalance = 0;
    const data = rows
      .slice()
      .reverse()
      .map((p) => {
        runningBalance += Number(p.grand_total) || 0;
        runningBalance -= Number(p.paid_amount) || 0;
        return {
          id: p.id,
          po_number: p.po_number,
          purchase_date: p.purchase_date,
          purchase_type: p.purchase_type,
          grand_total: toMoneyNumber(p.grand_total),
          paid_amount: toMoneyNumber(p.paid_amount),
          balance: toMoneyNumber(p.balance),
          running_balance: toMoneyNumber(runningBalance),
          status: p.status,
        };
      })
      .reverse();

    return res.json({
      vendor: { id: vendor.id, name: vendor.name, outstanding_balance: toMoneyNumber(vendor.outstanding_balance), total_purchases: toMoneyNumber(vendor.total_purchases) },
      ...paginatedResult(count, data),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/purchases/metal-wise — grouped by purchase_type, the closest
// real material classification on the Purchase model (there is no per-item
// metal_type_id captured on purchase line items today).
export const metalWisePurchases = async (req, res, next) => {
  try {
    const dateWhere = parseDateRange(req.query, { field: 'purchase_date' });
    const rows = await Purchase.findAll({
      where: { ...dateWhere, status: NOT_VOIDED },
      attributes: [
        [col('purchase_type'), 'purchase_type'],
        [fn('COUNT', col('id')), 'purchase_count'],
        [fn('COALESCE', fn('SUM', col('grand_total')), 0), 'grand_total'],
        [fn('COALESCE', fn('SUM', col('paid_amount')), 0), 'paid_amount'],
      ],
      group: ['purchase_type'],
      order: [[fn('SUM', col('grand_total')), 'DESC']],
      raw: true,
    });
    return res.json({
      data: rows.map((r) => ({
        purchase_type: r.purchase_type,
        purchase_count: Number(r.purchase_count) || 0,
        grand_total: toMoneyNumber(r.grand_total),
        paid_amount: toMoneyNumber(r.paid_amount),
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/purchases/pending-payments
export const pendingPayments = async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);
    const { count, rows } = await Purchase.findAndCountAll({
      where: { balance: { [Op.gt]: 0 }, status: NOT_VOIDED },
      order: [['purchase_date', 'ASC']],
      limit,
      offset,
    });
    return res.json(paginatedResult(count, rows.map((p) => p.toJSON())));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/purchases/outstanding-vendors
export const outstandingVendors = async (req, res, next) => {
  try {
    const { limit, offset } = parsePagination(req.query);
    const vendors = await Vendor.findAll({ where: { outstanding_balance: { [Op.gt]: 0 } }, order: [['outstanding_balance', 'DESC']] });
    const data = vendors.map((v) => ({
      vendor_id: v.id,
      vendor_name: v.name,
      type: v.type,
      outstanding_balance: toMoneyNumber(v.outstanding_balance),
      total_purchases: toMoneyNumber(v.total_purchases),
      credit_limit: toMoneyNumber(v.credit_limit),
    }));
    return res.json(paginatedResult(data.length, data.slice(offset, offset + limit)));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/purchases/trend — daily purchase totals over a range
export const purchaseTrend = async (req, res, next) => {
  try {
    const dateWhere = parseDateRange(req.query, { field: 'purchase_date' });
    const rows = await Purchase.findAll({
      where: { ...dateWhere, status: NOT_VOIDED },
      attributes: ['purchase_date', 'grand_total'],
      order: [['purchase_date', 'ASC']],
    });
    const byDay = new Map();
    for (const r of rows) {
      const raw = r.purchase_date;
      let day = null;
      if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
        day = raw.slice(0, 10);
      } else {
        const dt = raw instanceof Date ? raw : new Date(raw);
        if (!Number.isNaN(dt.getTime())) day = dt.toISOString().slice(0, 10);
      }
      if (!day) continue;
      const bucket = byDay.get(day) || { date: day, purchase_count: 0, grand_total: 0 };
      bucket.purchase_count += 1;
      bucket.grand_total += Number(r.grand_total) || 0;
      byDay.set(day, bucket);
    }
    return res.json({ data: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, grand_total: toMoneyNumber(d.grand_total) })) });
  } catch (err) {
    next(err);
  }
};
