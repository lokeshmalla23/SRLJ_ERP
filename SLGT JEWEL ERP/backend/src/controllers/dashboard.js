import { Op, fn, col } from 'sequelize';
import { Invoice, Product, Customer, Setting, Category } from '../models/index.js';
import { toMoneyNumber } from '../utils/money.js';
import { parseJsonField } from '../utils.js';
import { logger } from '../utils/logger.js';
import { NOT_HIDDEN_INVOICE, wantsHiddenBills } from '../utils/invoiceVisibility.js';
import { excludePreAccountsWhere } from '../services/financialMode.js';
import {
  classifyMetal,
  resolvePurityLabel,
  soldLineWeights,
  buildProductLookup,
} from '../services/metalClassify.js';
import { getActiveBillingDate } from '../services/dailyClosingService.js';
import {
  hydrateInvoiceItems,
  invoiceItemsOf,
  invoiceOccurredAt,
  invoicePaymentsOf,
  shopScope,
} from '../utils/invoiceRead.js';

function activeInvoiceWhere(includeHidden = false) {
  const clauses = [
    {
      [Op.or]: [
        { status: { [Op.notIn]: ['cancelled', 'canceled', 'void', 'voided', 'returned', 'refunded'] } },
        { status: null },
      ],
    },
    { cancelled_at: null },
  ];
  if (!includeHidden) clauses.push(NOT_HIDDEN_INVOICE);
  clauses.push(excludePreAccountsWhere());
  return { [Op.and]: clauses };
}

function localYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lineTotal(item) {
  return toMoneyNumber(
    item.line_total ?? item.amount ?? item.subtotal ?? item.line_grand ?? 0
  );
}

function metalWeights(invoices, productLookup = new Map()) {
  let goldGross = 0, goldNet = 0, goldPieces = 0;
  let silverGross = 0, silverNet = 0, silverPieces = 0;
  for (const inv of invoices) {
    const items = invoiceItemsOf(inv);
    if (!items.length) continue;
    for (const item of items) {
      const meta = item.product_id ? productLookup.get(item.product_id) : null;
      const sold = soldLineWeights(item, meta);
      if (!sold.classified) continue;
      if (!(sold.gw > 0 || sold.nw > 0)) continue;
      if (sold.classified === 'silver' || sold.family === 'silver') {
        silverGross += sold.gw; silverNet += sold.nw; silverPieces += sold.qty;
      } else {
        goldGross += sold.gw; goldNet += sold.nw; goldPieces += sold.qty;
      }
    }
  }
  return { goldGross, goldNet, goldPieces, silverGross, silverNet, silverPieces };
}

function paymentModeLabel(inv) {
  if (inv.payment_mode) return String(inv.payment_mode).toLowerCase();
  const payments = invoicePaymentsOf(inv);
  if (Array.isArray(payments) && payments.length > 0) {
    const modes = [...new Set(payments.map((p) => (p.mode || 'cash').toLowerCase()))];
    if (modes.length === 1) return modes[0];
    if (modes.length > 1) return 'mixed';
  }
  return null;
}

// GET /api/dashboard/summary
export const getDashboardSummary = async (req, res, next) => {
  const t0 = Date.now();
  try {
    logger.debug('dashboard', 'summary start');

    // "Today" follows the shop's active Transaction date, not the real
    // wall-clock date — invoices are stamped on that business date (see
    // stampOnTransactionDate), so a dashboard scoped to real-today would
    // miss sales billed before Daily Closing caught up.
    const { date: businessDateStr } = await getActiveBillingDate({ shopId: req.user?.shop_id });
    const businessDay = new Date(`${businessDateStr}T00:00:00.000`);
    const todayStart = new Date(`${businessDateStr}T00:00:00.000`);
    const todayEnd   = new Date(`${businessDateStr}T23:59:59.999`);
    const monthStart = new Date(`${businessDateStr.slice(0, 7)}-01T00:00:00.000`);
    const trendStart = new Date(businessDay); trendStart.setDate(trendStart.getDate() - 6);

    const shopWhere = shopScope(req.user?.shop_id);
    const includeHidden = wantsHiddenBills({ ...req.query, _role: req.user?.role });
    const activeInvoice = activeInvoiceWhere(includeHidden);

    const [
      todayInvoices, monthInvoices, totalCustomers, totalProducts,
      goldRateSetting, allProducts, recentInvoicesRaw, categoryPerf, trendInvoices,
    ] = await Promise.all([
      Invoice.findAll({ where: { ...shopWhere, ...activeInvoice, created_at: { [Op.between]: [todayStart, todayEnd] } } }),
      Invoice.findAll({ where: { ...shopWhere, ...activeInvoice, created_at: { [Op.gte]: monthStart } } }),
      Customer.count(req.user?.shop_id ? { where: { shop_id: req.user.shop_id } } : undefined),
      Product.count(req.user?.shop_id ? { where: { shop_id: req.user.shop_id } } : undefined),
      Setting.findOne({ where: { key: 'gold_rate' } }),
      Product.findAll(req.user?.shop_id ? { where: { shop_id: req.user.shop_id } } : undefined),
      Invoice.findAll({
        where: { ...shopWhere, ...activeInvoice },
        order: [['created_at', 'DESC']],
        limit: 5,
      }),
      Product.findAll({
        attributes: ['category_id', [fn('COUNT', col('id')), 'product_count'], [fn('SUM', col('stock_qty')), 'total_stock']],
        where: shopWhere,
        group: ['category_id'],
        raw: true,
      }),
      Invoice.findAll({
        where: { ...shopWhere, ...activeInvoice, created_at: { [Op.between]: [trendStart, todayEnd] } },
      }),
    ]);

    logger.debug('dashboard', 'queries complete', {
      ms: Date.now() - t0, today_invoices: todayInvoices.length, month_invoices: monthInvoices.length,
    });

    await hydrateInvoiceItems([
      ...todayInvoices,
      ...monthInvoices,
      ...trendInvoices,
      ...recentInvoicesRaw,
    ]);

    // Resolve metal/category from products for older invoices missing snapshot fields
    const productLookup = await buildProductLookup([
      ...todayInvoices,
      ...monthInvoices,
      ...trendInvoices,
      ...recentInvoicesRaw,
    ]);

    // ─── Metal weights ─────────────────────────────────────────────────────
    const todayMetal = metalWeights(todayInvoices, productLookup);
    const monthMetal = metalWeights(monthInvoices, productLookup);

    // ─── 7-day metal + sales trend ─────────────────────────────────────────
    // Bucket by local calendar day. Sequelize underscored models expose
    // createdAt in JS (column is created_at) — comparing inv.created_at
    // left every bar at 0g even when today's metal cards had data.
    const metalTrend = [];
    const salesTrend = [];
    const dayBuckets = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(businessDay);
      day.setDate(day.getDate() - i);
      dayBuckets.push({
        key: localYmd(day),
        date: day.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
        invoices: [],
      });
    }
    const bucketByKey = new Map(dayBuckets.map((b) => [b.key, b]));
    for (const inv of trendInvoices) {
      const c = invoiceOccurredAt(inv);
      if (!c) continue;
      const bucket = bucketByKey.get(localYmd(c));
      if (bucket) bucket.invoices.push(inv);
    }
    for (const bucket of dayBuckets) {
      const w = metalWeights(bucket.invoices, productLookup);
      const daySales = toMoneyNumber(bucket.invoices.reduce((s, inv) => s + toMoneyNumber(inv.grand_total), 0));
      metalTrend.push({
        date:         bucket.date,
        gold_gross:   +w.goldGross.toFixed(3),
        gold_net:     +w.goldNet.toFixed(3),
        silver_gross: +w.silverGross.toFixed(3),
        silver_net:   +w.silverNet.toFixed(3),
        gross:        +(w.goldGross + w.silverGross).toFixed(3),
        net:          +(w.goldNet + w.silverNet).toFixed(3),
      });
      salesTrend.push({ date: bucket.date, sales: daySales, count: bucket.invoices.length });
    }

    // ─── Purity breakdown (this month) ────────────────────────────────────
    const purityMap = {};
    for (const inv of monthInvoices) {
      const items = invoiceItemsOf(inv);
      if (!items.length) continue;
      for (const item of items) {
        const meta = item.product_id ? productLookup.get(item.product_id) : null;
        const sold = soldLineWeights(item, meta);
        if (!sold.classified) continue;
        if (!(sold.gw > 0 || sold.nw > 0)) continue;
        const purity = resolvePurityLabel(sold.merged, sold.classified, meta);
        if (!purityMap[purity]) purityMap[purity] = { purity, gross_weight: 0, net_weight: 0, pieces: 0 };
        purityMap[purity].gross_weight += sold.gw;
        purityMap[purity].net_weight   += sold.nw;
        purityMap[purity].pieces       += sold.qty;
      }
    }
    const purity_breakdown = Object.values(purityMap)
      .map((p) => ({ ...p, gross_weight: +p.gross_weight.toFixed(3), net_weight: +p.net_weight.toFixed(3) }))
      .sort((a, b) => b.gross_weight - a.gross_weight);

    // ─── Revenue & cash ────────────────────────────────────────────────────
    const todaySales = toMoneyNumber(todayInvoices.reduce((s, i) => s + toMoneyNumber(i.grand_total), 0));
    const monthSales = toMoneyNumber(monthInvoices.reduce((s, i) => s + toMoneyNumber(i.grand_total), 0));
    const todayCash  = toMoneyNumber(todayInvoices.reduce((s, inv) => {
      const payments = invoicePaymentsOf(inv);
      if (Array.isArray(payments) && payments.length) {
        return s + payments
          .filter((p) => (p.mode || '').toLowerCase() === 'cash')
          .reduce((a, p) => a + toMoneyNumber(p.amount), 0);
      }
      return inv.payment_mode === 'cash' ? s + toMoneyNumber(inv.grand_total) : s;
    }, 0));

    // ─── Payment mode totals ───────────────────────────────────────────────
    const modeTotals = {};
    for (const inv of monthInvoices) {
      const payments = invoicePaymentsOf(inv);
      if (Array.isArray(payments) && payments.length > 0) {
        for (const p of payments) {
          const m = (p.mode || 'cash').toLowerCase();
          modeTotals[m] = (modeTotals[m] || 0) + toMoneyNumber(p.amount);
        }
      } else {
        const m = (inv.payment_mode || 'cash').toLowerCase();
        modeTotals[m] = (modeTotals[m] || 0) + toMoneyNumber(inv.grand_total);
      }
    }

    // ─── Top categories ────────────────────────────────────────────────────
    const catSales = {};
    for (const inv of monthInvoices) {
      const items = invoiceItemsOf(inv);
      if (!items.length) continue;
      for (const item of items) {
        const meta = item.product_id ? productLookup.get(item.product_id) : null;
        const cat = item.category_name || item.category || meta?.category_name || 'Others';
        catSales[cat] = (catSales[cat] || 0) + lineTotal(item);
      }
    }
    const top_categories = Object.entries(catSales)
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, total]) => ({ name, total }));

    const gold_rate = parseJsonField(goldRateSetting?.value, {
      gold_22k: 0, gold_18k: 0, gold_24k: 0, silver: 0, pure_silver: 0,
    });
    if (gold_rate.pure_silver == null && gold_rate.silver != null) {
      gold_rate.pure_silver = gold_rate.silver;
    }

    // Low stock by sub-category: sum of product stock_qty vs category.low_stock_threshold
    const subcats = await Category.findAll({
      where: { deleted_at: null, parent_id: { [Op.ne]: null } },
    });
    const parents = await Category.findAll({
      where: { deleted_at: null, parent_id: null },
    });
    const parentName = Object.fromEntries(parents.map((c) => [c.id, c.name]));
    const stockBySub = {};
    for (const p of allProducts) {
      const sid = p.subcategory_id;
      if (!sid) continue;
      stockBySub[sid] = (stockBySub[sid] || 0) + (parseFloat(p.stock_qty) || 0);
    }
    const low_stock = subcats
      .map((sc) => {
        const threshold = sc.low_stock_threshold != null ? parseFloat(sc.low_stock_threshold) : NaN;
        if (!(threshold > 0)) return null;
        const stock_qty = stockBySub[sc.id] || 0;
        if (stock_qty > threshold) return null;
        return {
          id: sc.id,
          name: `${parentName[sc.parent_id] || 'Category'} / ${sc.name}`,
          code: sc.name,
          category_name: parentName[sc.parent_id] || null,
          subcategory_name: sc.name,
          stock_qty,
          low_stock_threshold: threshold,
        };
      })
      .filter(Boolean);
    const daysElapsed = Math.max(1, businessDay.getDate());

    const recent_invoices = recentInvoicesRaw.map((i) => {
      const json = i.toJSON();
      return {
        ...json,
        payment_mode: paymentModeLabel(json),
      };
    });

    return res.json({
      kpis: {
        today_invoices:      todayInvoices.length,
        month_invoices:      monthInvoices.length,
        today_sales:         todaySales,
        month_sales:         monthSales,
        today_cash:          todayCash,
        avg_daily_sales:     toMoneyNumber(monthSales / daysElapsed),
        total_customers:     totalCustomers,
        total_products:      totalProducts,
        low_stock_count:     low_stock.length,
        today_gold_gross:    +todayMetal.goldGross.toFixed(3),
        today_gold_net:      +todayMetal.goldNet.toFixed(3),
        today_gold_pieces:   todayMetal.goldPieces,
        today_silver_gross:  +todayMetal.silverGross.toFixed(3),
        today_silver_net:    +todayMetal.silverNet.toFixed(3),
        today_silver_pieces: todayMetal.silverPieces,
        month_gold_gross:    +monthMetal.goldGross.toFixed(3),
        month_gold_net:      +monthMetal.goldNet.toFixed(3),
        month_gold_pieces:   monthMetal.goldPieces,
        month_silver_gross:  +monthMetal.silverGross.toFixed(3),
        month_silver_net:    +monthMetal.silverNet.toFixed(3),
        month_silver_pieces: monthMetal.silverPieces,
      },
      metal_trend: metalTrend,
      purity_breakdown,
      payment_mode_totals: modeTotals,
      top_categories,
      gold_rate,
      low_stock,
      recent_invoices,
      trend: salesTrend,
      category_performance: categoryPerf,
    });
  } catch (err) {
    logger.error('dashboard', 'summary failed', { ms: Date.now() - t0, error: err?.message, stack: err?.stack });
    next(err);
  }
};
