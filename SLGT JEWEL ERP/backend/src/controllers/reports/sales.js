import { Op, fn, col } from 'sequelize';
import { Invoice, InvoiceItem, Employee, ShopCounter, Customer, Quotation } from '../../models/index.js';
import { toMoneyNumber, sumMoney } from '../../utils/money.js';
import { hydrateInvoiceItems, invoiceItemsOf, invoicePaymentsOf, invoiceOccurredAt, parseOccurredAt } from '../../utils/invoiceRead.js';
import { parsePagination, parseDateRange, invoiceDateRangeWhere, paginatedResult, newestInvoiceFirstOrder } from '../../utils/reportQuery.js';
import { NOT_VOID_OR_RETURNED, wantsHiddenBills, withNotHiddenInvoiceItems } from '../../utils/invoiceVisibility.js';
import { excludePreAccountsWhere } from '../../services/financialMode.js';

const NOT_CANCELLED = NOT_VOID_OR_RETURNED;

function buildBaseWhere(query) {
  // Filter by the invoice's active business day (Transaction date), not its
  // real created_at timestamp — see invoiceDateRangeWhere. Combined via
  // Op.and (as separate clauses) rather than spread, since the date-range
  // clause and the is_hidden clause below would otherwise collide on the
  // same Op.or symbol key.
  const and = [
    invoiceDateRangeWhere(query),
    { status: query.status || NOT_CANCELLED },
    excludePreAccountsWhere(),
  ];
  if (!wantsHiddenBills(query)) {
    and.push({ [Op.or]: [{ is_hidden: false }, { is_hidden: null }] });
  }
  if (query.salesperson_id) and.push({ salesperson_id: query.salesperson_id });
  if (query.counter_id) and.push({ counter_id: query.counter_id });
  if (query.customer_id) and.push({ customer_id: query.customer_id });
  return { [Op.and]: and };
}

function lineFiltersMatch(invoice, { category_id, metal_type }) {
  if (!category_id && !metal_type) return true;
  const items = invoiceItemsOf(invoice);
  if (!Array.isArray(items)) return false;
  return items.some((it) => {
    if (category_id && it.category_id !== category_id) return false;
    if (metal_type) {
      const m = String(it.metal_name || it.metal || it.metal_type || '').toLowerCase();
      if (!m.includes(String(metal_type).toLowerCase())) return false;
    }
    return true;
  });
}

function paymentModeMatches(invoice, paymentMode) {
  if (!paymentMode) return true;
  const payments = invoicePaymentsOf(invoice);
  if (!Array.isArray(payments)) return false;
  return payments.some((p) => String(p.mode || '').toLowerCase() === String(paymentMode).toLowerCase());
}

function needsLineFilter(query) {
  return Boolean(query.category_id || query.metal_type || query.payment_mode);
}

/** Groups already-fetched (line-filtered) invoices by a top-level column, in JS —
 * used whenever category_id/metal_type/payment_mode narrows the set, since that
 * filtering itself only happens in JS (see lineFiltersMatch/paymentModeMatches). */
function groupInMemory(invoices, field) {
  const buckets = new Map();
  for (const inv of invoices) {
    const key = inv[field];
    if (!key) continue;
    const bucket = buckets.get(key) || { id: key, invoice_count: 0, grand_total: 0, gst_amount: 0 };
    bucket.invoice_count += 1;
    bucket.grand_total += Number(inv.grand_total) || 0;
    bucket.gst_amount += Number(inv.gst_amount) || 0;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map((b) => ({ ...b, grand_total: toMoneyNumber(b.grand_total), gst_amount: toMoneyNumber(b.gst_amount) }))
    .sort((a, b) => b.grand_total - a.grand_total);
}

function sumTotals(invoices) {
  return {
    count: invoices.length,
    subtotal: toMoneyNumber(sumMoney(invoices.map((i) => i.subtotal))),
    discount: toMoneyNumber(sumMoney(invoices.map((i) => i.discount))),
    gst_amount: toMoneyNumber(sumMoney(invoices.map((i) => i.gst_amount))),
    grand_total: toMoneyNumber(sumMoney(invoices.map((i) => i.grand_total))),
  };
}

// GET /api/reports/sales/list — paginated, filterable invoice list (Sales tab main table)
export const listSalesInvoices = async (req, res, next) => {
  try {
    const where = buildBaseWhere({ ...req.query, _role: req.user?.role });
    const { category_id, metal_type, payment_mode } = req.query;
    const { limit, offset } = parsePagination(req.query);
    const needsLineFilter = Boolean(category_id || metal_type || payment_mode);

    if (!needsLineFilter) {
      const [{ count, rows }, aggregate] = await Promise.all([
        Invoice.findAndCountAll({ where, order: newestInvoiceFirstOrder(), limit, offset }),
        Invoice.findOne({
          where,
          attributes: [
            [fn('COUNT', col('id')), 'count'],
            [fn('COALESCE', fn('SUM', col('subtotal')), 0), 'subtotal'],
            [fn('COALESCE', fn('SUM', col('discount')), 0), 'discount'],
            [fn('COALESCE', fn('SUM', col('gst_amount')), 0), 'gst_amount'],
            [fn('COALESCE', fn('SUM', col('grand_total')), 0), 'grand_total'],
          ],
          raw: true,
        }),
      ]);
      return res.json({
        ...paginatedResult(count, rows.map((r) => {
          const json = r.toJSON();
          json.items = invoiceItemsOf(r);
          json.payments = invoicePaymentsOf(r);
          // Always the transaction-date-pinned value (never the raw insert
          // timestamp) so this list agrees with every other report/screen
          // for the same invoice — see invoiceOccurredAt()'s doc comment.
          json.created_at = (invoiceOccurredAt(r) || parseOccurredAt(json.created_at || json.createdAt))?.toISOString?.() || json.created_at;
          return json;
        })),
        totals: {
          count: Number(aggregate?.count) || 0,
          subtotal: toMoneyNumber(aggregate?.subtotal),
          discount: toMoneyNumber(aggregate?.discount),
          gst_amount: toMoneyNumber(aggregate?.gst_amount),
          grand_total: toMoneyNumber(aggregate?.grand_total),
        },
      });
    }

    // Category/metal/payment-mode filters live inside the items/payments JSONB —
    // bounded by the SQL date/salesperson/counter/customer filters above, then
    // filtered + paginated in memory (consistent with how getGstReport already
    // walks invoice.items rather than relying on dialect-specific JSONB queries).
    const invoices = await Invoice.findAll({ where, order: newestInvoiceFirstOrder() });
    await hydrateInvoiceItems(invoices);
    const filtered = invoices.filter((inv) =>
      lineFiltersMatch(inv, { category_id, metal_type }) && paymentModeMatches(inv, payment_mode));
    const page = filtered.slice(offset, offset + limit).map((i) => {
      const json = i.toJSON();
      json.items = invoiceItemsOf(i);
      json.payments = invoicePaymentsOf(i);
      // Always the transaction-date-pinned value — see invoiceOccurredAt()'s doc comment.
      json.created_at = (invoiceOccurredAt(i) || parseOccurredAt(json.created_at || json.createdAt))?.toISOString?.() || json.created_at;
      return json;
    });
    return res.json({ ...paginatedResult(filtered.length, page), totals: sumTotals(filtered) });
  } catch (err) {
    next(err);
  }
};

async function groupInvoicesBy(field, req, res, next) {
  try {
    const where = buildBaseWhere({ ...req.query, _role: req.user?.role });
    const { category_id, metal_type, payment_mode } = req.query;

    if (needsLineFilter(req.query)) {
      const invoices = await Invoice.findAll({ where: { ...where, [field]: { [Op.ne]: null } } });
      await hydrateInvoiceItems(invoices);
      const filtered = invoices.filter((inv) =>
        lineFiltersMatch(inv, { category_id, metal_type }) && paymentModeMatches(inv, payment_mode));
      return groupInMemory(filtered, field);
    }

    const rows = await Invoice.findAll({
      where: { ...where, [field]: { [Op.ne]: null } },
      attributes: [
        [col(field), 'key'],
        [fn('COUNT', col('id')), 'invoice_count'],
        [fn('COALESCE', fn('SUM', col('grand_total')), 0), 'grand_total'],
        [fn('COALESCE', fn('SUM', col('gst_amount')), 0), 'gst_amount'],
      ],
      group: [field],
      order: [[fn('SUM', col('grand_total')), 'DESC']],
      raw: true,
    });
    return rows.map((r) => ({
      id: r.key,
      invoice_count: Number(r.invoice_count) || 0,
      grand_total: toMoneyNumber(r.grand_total),
      gst_amount: toMoneyNumber(r.gst_amount),
    }));
  } catch (err) {
    next(err);
    return null;
  }
}

// GET /api/reports/sales/by-employee
export const salesByEmployee = async (req, res, next) => {
  const rows = await groupInvoicesBy('salesperson_id', req, res, next);
  if (!rows) return;
  const employees = await Employee.findAll({ where: { id: { [Op.in]: rows.map((r) => r.id) } } });
  const names = new Map(employees.map((e) => [e.id, e.name]));
  return res.json({ data: rows.map((r) => ({ ...r, salesperson_id: r.id, salesperson_name: names.get(r.id) || 'Unassigned' })) });
};

// GET /api/reports/sales/by-counter
export const salesByCounter = async (req, res, next) => {
  const rows = await groupInvoicesBy('counter_id', req, res, next);
  if (!rows) return;
  const counters = await ShopCounter.findAll({ where: { id: { [Op.in]: rows.map((r) => r.id) } } });
  const names = new Map(counters.map((c) => [c.id, c.name]));
  return res.json({ data: rows.map((r) => ({ ...r, counter_id: r.id, counter_name: names.get(r.id) || 'Unassigned' })) });
};

// GET /api/reports/sales/top-customers
export const topCustomers = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const where = { ...buildBaseWhere({ ...req.query, _role: req.user?.role }), customer_id: { [Op.ne]: null } };
    const { category_id, metal_type, payment_mode } = req.query;

    let grouped;
    if (needsLineFilter(req.query)) {
      const invoices = await Invoice.findAll({ where });
      await hydrateInvoiceItems(invoices);
      const filtered = invoices.filter((inv) =>
        lineFiltersMatch(inv, { category_id, metal_type }) && paymentModeMatches(inv, payment_mode));
      grouped = groupInMemory(filtered, 'customer_id')
        .map((r) => ({ customer_id: r.id, invoice_count: r.invoice_count, grand_total: r.grand_total }))
        .slice(0, limit);
    } else {
      const rows = await Invoice.findAll({
        where,
        attributes: [
          [col('customer_id'), 'customer_id'],
          [fn('COUNT', col('id')), 'invoice_count'],
          [fn('COALESCE', fn('SUM', col('grand_total')), 0), 'grand_total'],
        ],
        group: ['customer_id'],
        order: [[fn('SUM', col('grand_total')), 'DESC']],
        limit,
        raw: true,
      });
      grouped = rows.map((r) => ({ customer_id: r.customer_id, invoice_count: Number(r.invoice_count) || 0, grand_total: toMoneyNumber(r.grand_total) }));
    }

    const customers = await Customer.findAll({ where: { id: { [Op.in]: grouped.map((r) => r.customer_id) } } });
    const byId = new Map(customers.map((c) => [c.id, c]));
    return res.json({
      data: grouped.map((r) => ({
        customer_id: r.customer_id,
        serial_no: byId.get(r.customer_id)?.serial_no || null,
        customer_name: byId.get(r.customer_id)?.name || 'Unknown',
        mobile: byId.get(r.customer_id)?.mobile || null,
        invoice_count: r.invoice_count,
        grand_total: r.grand_total,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/sales/top-products — from the normalized invoice_items ledger
export const topSellingProducts = async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const dateWhere = parseDateRange(req.query);
    const where = await withNotHiddenInvoiceItems(
      { ...req.query, _role: req.user?.role },
      Object.keys(dateWhere).length ? dateWhere : {},
      { shopId: req.user?.shop_id },
    );

    const rows = await InvoiceItem.findAll({
      where,
      attributes: [
        [fn('COALESCE', col('product_id'), col('barcode')), 'key'],
        [fn('MAX', col('description')), 'product_name'],
        [fn('MAX', col('barcode')), 'barcode'],
        [fn('COALESCE', fn('SUM', col('quantity')), 0), 'quantity_sold'],
        [fn('COALESCE', fn('SUM', col('amount')), 0), 'revenue'],
      ],
      group: [[fn('COALESCE', col('product_id'), col('barcode'))]],
      order: [[fn('SUM', col('amount')), 'DESC']],
      limit,
      raw: true,
    });

    return res.json({
      data: rows.map((r, i) => {
        const qty = Number(r.quantity_sold) || 0;
        const revenue = toMoneyNumber(r.revenue);
        return {
          rank: i + 1,
          product_id: r.key,
          product_name: r.product_name || 'Unknown item',
          barcode: r.barcode,
          quantity_sold: qty,
          revenue,
          avg_selling_price: qty > 0 ? toMoneyNumber(revenue / qty) : 0,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/sales/estimations-to-sale — every Estimation that converted
// into an actual invoice: which estimation, which bill, for whom, and when.
// Quotation has no dedicated "converted at" timestamp (booked_at/business_date
// are stamped at booking, not at conversion) — the resulting Invoice's own
// invoiceOccurredAt() is the reliable anchor for "when this sale happened",
// same as every other report in this file.
export const estimationsToSale = async (req, res, next) => {
  try {
    const { from, to, q } = req.query;
    const { limit, offset } = parsePagination(req.query);

    const quotations = await Quotation.findAll({
      where: { status: 'converted', converted_invoice_id: { [Op.ne]: null }, deleted_at: null },
    });
    const invoiceIds = [...new Set(quotations.map((qn) => qn.converted_invoice_id).filter(Boolean))];
    const invoices = invoiceIds.length
      ? await Invoice.findAll({ where: { id: { [Op.in]: invoiceIds } } })
      : [];
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));

    let rows = quotations
      .map((quote) => {
        const inv = invoiceById.get(quote.converted_invoice_id);
        if (!inv) return null; // invoice deleted/hidden since — nothing reliable to show
        const convertedAt = invoiceOccurredAt(inv);
        return {
          quotation_id: quote.id,
          quote_no: quote.quote_no,
          invoice_id: inv.id,
          invoice_no: inv.invoice_no,
          // Snapshot on the transactional row, not the live Customer record —
          // same convention as every other "at the time" report (e.g. Old Gold
          // Exchange) — so a later name/number change doesn't rewrite history.
          customer_name: quote.customer_name || inv.customer_name || null,
          customer_mobile: quote.customer_mobile || inv.customer_mobile || null,
          grand_total: toMoneyNumber(inv.grand_total ?? quote.grand_total ?? 0),
          converted_at: convertedAt ? convertedAt.toISOString() : null,
        };
      })
      .filter(Boolean);

    const fromDt = from ? new Date(`${from}T00:00:00`) : null;
    const toDt = to ? new Date(`${to}T23:59:59.999`) : null;
    if (fromDt || toDt) {
      rows = rows.filter((r) => {
        if (!r.converted_at) return false;
        const d = new Date(r.converted_at);
        if (fromDt && d < fromDt) return false;
        if (toDt && d > toDt) return false;
        return true;
      });
    }

    if (q) {
      const needle = String(q).trim().toLowerCase();
      if (needle) {
        rows = rows.filter((r) => [r.quote_no, r.invoice_no, r.customer_name, r.customer_mobile]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle)));
      }
    }

    rows.sort((a, b) => new Date(b.converted_at || 0) - new Date(a.converted_at || 0));

    const total = rows.length;
    const page = rows.slice(offset, offset + limit);
    return res.json(paginatedResult(total, page));
  } catch (err) {
    next(err);
  }
};

// GET /api/reports/sales/trend — daily totals over the requested range
export const salesTrend = async (req, res, next) => {
  try {
    const where = buildBaseWhere({ ...req.query, _role: req.user?.role });
    const invoices = await Invoice.findAll({
      where,
      attributes: ['created_at', 'business_date', 'grand_total', 'gst_amount'],
      order: [['created_at', 'ASC']],
    });

    const byDay = new Map();
    for (const inv of invoices) {
      const dt = invoiceOccurredAt(inv);
      if (!dt) continue;
      const day = dt.toISOString().slice(0, 10);
      const bucket = byDay.get(day) || { date: day, invoice_count: 0, grand_total: 0, gst_amount: 0 };
      bucket.invoice_count += 1;
      bucket.grand_total += Number(inv.grand_total) || 0;
      bucket.gst_amount += Number(inv.gst_amount) || 0;
      byDay.set(day, bucket);
    }

    return res.json({
      data: [...byDay.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({ ...d, grand_total: toMoneyNumber(d.grand_total), gst_amount: toMoneyNumber(d.gst_amount) })),
    });
  } catch (err) {
    next(err);
  }
};

