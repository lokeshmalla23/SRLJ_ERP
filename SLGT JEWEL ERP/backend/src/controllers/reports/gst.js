import { Op, fn, col } from 'sequelize';
import { Invoice, CreditNote, Purchase } from '../../models/index.js';
import { toMoneyNumber, sumMoney } from '../../utils/money.js';
import { parsePagination, parseDateRange, invoiceDateRangeWhere, paginatedResult } from '../../utils/reportQuery.js';
import { NOT_VOID_OR_RETURNED, wantsHiddenBills } from '../../utils/invoiceVisibility.js';
import { excludePreAccountsWhere } from '../../services/financialMode.js';
import { hydrateInvoiceItems, invoiceItemsOf, invoiceOccurredAt } from '../../utils/invoiceRead.js';

const NOT_CANCELLED = NOT_VOID_OR_RETURNED;

function baseWhere(query) {
  const where = {
    ...invoiceDateRangeWhere(query),
    status: NOT_CANCELLED,
    ...excludePreAccountsWhere(),
  };
  if (!wantsHiddenBills(query)) {
    where[Op.or] = [{ is_hidden: false }, { is_hidden: null }];
  }
  return where;
}

/** HSN-wise taxable/GST buckets, netted against credit notes for the same range. */
async function computeHsnBuckets(dateWhere, includeHidden = false) {
  const invoiceWhere = { ...dateWhere, status: NOT_CANCELLED, ...excludePreAccountsWhere() };
  if (!includeHidden) {
    invoiceWhere[Op.or] = [{ is_hidden: false }, { is_hidden: null }];
  }
  const invoices = await Invoice.findAll({
    where: invoiceWhere,
  });
  await hydrateInvoiceItems(invoices);
  const byHsn = {};
  const bump = (hsn, taxable, gst, sign = 1) => {
    if (!byHsn[hsn]) byHsn[hsn] = { hsn_code: hsn, taxable: 0, gst: 0, cgst: 0, sgst: 0, lines: 0 };
    byHsn[hsn].taxable += sign * taxable;
    byHsn[hsn].gst += sign * gst;
    byHsn[hsn].cgst += sign * (gst / 2);
    byHsn[hsn].sgst += sign * (gst / 2);
    byHsn[hsn].lines += 1;
  };

  for (const inv of invoices) {
    const items = invoiceItemsOf(inv);
    const invGstPct = inv.gst_pct != null ? Number(inv.gst_pct) : null;
    for (const it of items) {
      const hsn = it.hsn_code || '7113';
      const lineGst = it.gst_amount != null ? Number(it.gst_amount) : null;
      const lineTotal = Number(it.line_total) || 0;
      const gstPct = it.gst_pct != null ? Number(it.gst_pct) : invGstPct;
      let taxable;
      let gst;
      if (lineGst != null && Number.isFinite(lineGst)) {
        gst = lineGst;
        taxable = lineTotal - gst;
      } else if (gstPct != null && Number.isFinite(gstPct) && gstPct > 0) {
        taxable = lineTotal / (1 + gstPct / 100);
        gst = lineTotal - taxable;
      } else {
        taxable = lineTotal;
        gst = items.indexOf(it) === 0 ? (Number(inv.gst_amount) || 0) : 0;
      }
      bump(hsn, taxable, gst, 1);
    }
  }

  let creditNotes = [];
  try {
    creditNotes = await CreditNote.findAll({ where: dateWhere });
  } catch {
    creditNotes = [];
  }
  for (const cn of creditNotes) {
    const hsn = cn.hsn_code || '7113';
    const gst = Number(cn.gst_amount) || 0;
    const taxBase = cn.subtotal != null ? Number(cn.subtotal) : ((Number(cn.grand_total) || 0) - gst);
    bump(hsn, taxBase, gst, -1);
  }

  return Object.values(byHsn).map((r) => ({
    ...r,
    taxable: toMoneyNumber(r.taxable),
    gst: toMoneyNumber(r.gst),
    cgst: toMoneyNumber(r.cgst),
    sgst: toMoneyNumber(r.sgst),
  }));
}

// GET /api/reports/gst/list — paginated invoice-wise GST detail
export const listGstInvoices = async (req, res, next) => {
  try {
    const where = baseWhere({ ...req.query, _role: req.user?.role });
    const { limit, offset } = parsePagination(req.query);
    const { count, rows } = await Invoice.findAndCountAll({
      where,
      order: [['created_at', 'DESC']],
      limit,
      offset,
      // 'createdAt', not the raw 'created_at' column name — see monthlyGstSummary.
      attributes: ['id', 'invoice_no', 'customer_name', 'createdAt', 'business_date', 'subtotal', 'gst_pct', 'gst_amount', 'cgst_amount', 'sgst_amount', 'grand_total'],
    });
    return res.json(paginatedResult(count, rows.map((r) => {
      const json = r.toJSON();
      // Business-date-anchored, same as every other report — see invoiceOccurredAt().
      json.created_at = (invoiceOccurredAt(r) || json.createdAt)?.toISOString?.() || json.createdAt;
      return json;
    })));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/gst/hsn-summary
export const hsnSummary = async (req, res, next) => {
  try {
    const rows = await computeHsnBuckets(invoiceDateRangeWhere(req.query), wantsHiddenBills({ ...req.query, _role: req.user?.role }));
    return res.json({
      data: rows,
      totals: {
        taxable: toMoneyNumber(sumMoney(rows.map((r) => r.taxable))),
        gst: toMoneyNumber(sumMoney(rows.map((r) => r.gst))),
      },
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/gst/tax-rate-summary — grouped by the invoice-level gst_pct slab
export const taxRateSummary = async (req, res, next) => {
  try {
    const where = { ...baseWhere({ ...req.query, _role: req.user?.role }), gst_pct: { [Op.ne]: null } };
    const rows = await Invoice.findAll({
      where,
      attributes: [
        [col('gst_pct'), 'gst_pct'],
        [fn('COUNT', col('id')), 'invoice_count'],
        [fn('COALESCE', fn('SUM', col('subtotal')), 0), 'taxable'],
        [fn('COALESCE', fn('SUM', col('gst_amount')), 0), 'gst'],
      ],
      group: ['gst_pct'],
      order: [['gst_pct', 'ASC']],
      raw: true,
    });
    return res.json({
      data: rows.map((r) => ({
        gst_pct: Number(r.gst_pct),
        invoice_count: Number(r.invoice_count) || 0,
        taxable: toMoneyNumber(r.taxable),
        gst: toMoneyNumber(r.gst),
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/gst/monthly-summary
export const monthlyGstSummary = async (req, res, next) => {
  try {
    const where = baseWhere({ ...req.query, _role: req.user?.role });
    // 'created_at' (the raw DB column name) isn't a real attribute on this
    // underscored model — only 'createdAt' is, so requesting the raw name
    // left inv.created_at silently undefined, turning every month into
    // "NaN-NaN". business_date is included so invoiceOccurredAt() anchors to
    // the transaction date rather than the real timestamp, same as everywhere else.
    const invoices = await Invoice.findAll({
      where,
      attributes: ['createdAt', 'business_date', 'subtotal', 'gst_amount', 'cgst_amount', 'sgst_amount'],
    });
    const byMonth = new Map();
    for (const inv of invoices) {
      const d = invoiceOccurredAt(inv);
      if (!d) continue;
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const bucket = byMonth.get(month) || { month, invoice_count: 0, taxable: 0, cgst: 0, sgst: 0, gst: 0 };
      bucket.invoice_count += 1;
      bucket.taxable += Number(inv.subtotal) || 0;
      bucket.cgst += Number(inv.cgst_amount) || 0;
      bucket.sgst += Number(inv.sgst_amount) || 0;
      bucket.gst += Number(inv.gst_amount) || 0;
      byMonth.set(month, bucket);
    }
    return res.json({
      data: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
        ...m,
        taxable: toMoneyNumber(m.taxable),
        cgst: toMoneyNumber(m.cgst),
        sgst: toMoneyNumber(m.sgst),
        gst: toMoneyNumber(m.gst),
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/gst/collection-trend — daily GST collected
export const gstCollectionTrend = async (req, res, next) => {
  try {
    const where = baseWhere({ ...req.query, _role: req.user?.role });
    // See monthlyGstSummary above — 'createdAt' (not the raw 'created_at'
    // column name) is the real attribute on this underscored model.
    const invoices = await Invoice.findAll({
      where,
      attributes: ['createdAt', 'business_date', 'gst_amount'],
      order: [['created_at', 'ASC']],
    });
    const byDay = new Map();
    for (const inv of invoices) {
      const dt = invoiceOccurredAt(inv);
      if (!dt) continue;
      const day = dt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) || { date: day, gst_amount: 0 };
      bucket.gst_amount += Number(inv.gst_amount) || 0;
      byDay.set(day, bucket);
    }
    return res.json({ data: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, gst_amount: toMoneyNumber(d.gst_amount) })) });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/gst/liability — output GST (sales) minus input GST (purchases) for the period
export const gstLiability = async (req, res, next) => {
  try {
    const salesWhere = baseWhere({ ...req.query, _role: req.user?.role });
    const purchaseDateWhere = parseDateRange(req.query, { field: 'purchase_date' });

    const [salesAgg, purchaseAgg] = await Promise.all([
      Invoice.findOne({
        where: salesWhere,
        attributes: [[fn('COALESCE', fn('SUM', col('gst_amount')), 0), 'output_gst']],
        raw: true,
      }),
      Purchase.findOne({
        where: { ...purchaseDateWhere, status: { [Op.ne]: 'voided' } },
        attributes: [[fn('COALESCE', fn('SUM', col('gst_amount')), 0), 'input_gst']],
        raw: true,
      }),
    ]);

    const outputGst = toMoneyNumber(salesAgg?.output_gst);
    const inputGst = toMoneyNumber(purchaseAgg?.input_gst);
    return res.json({
      output_gst: outputGst,
      input_gst: inputGst,
      net_liability: toMoneyNumber(outputGst - inputGst),
    });
  } catch (err) {
    next(err);
  }
};
