/**
 * Accounts module operational APIs — dashboard, registers, books, ageing, schemes, GST, metal, audit.
 * Reuses invoices/purchases/expenses/journals/schemes; does not invent balances.
 */
import { Op } from 'sequelize';
import {
  Invoice,
  Purchase,
  Expense,
  Income,
  Payment,
  Customer,
  Scheme,
  JournalEntry,
  JournalLine,
  ChartOfAccount,
  AuditEvent,
  Product,
  OldGoldReceipt,
  OldGoldSale,
  CustomerAdvance,
  CatalogItem,
  CreditNote,
  CashbookEntry,
  Order,
  Setting,
  DailyClosing,
} from '../models/index.js';
import { getDefaultShopId } from './defaultShop.js';
import { accountNetBalance, ensureDefaultAccounts } from './ledgerService.js';
import { generalLedger } from './accountingControlsService.js';
import { toMoneyNumber } from '../utils/money.js';
import { salesRegisterPaymentSplit, sumSalesRegisterTotals } from '../utils/salesRegisterPayments.js';
import { normalizeReceiptMetal } from '../utils/oldMetal.js';
import { parseJsonField } from '../utils.js';
import {
  excludePreAccountsWhere,
  excludePreAccountsJournalWhere,
  isPreAccountsRecord,
} from './financialMode.js';
import {
  hydrateInvoiceItems,
  invoiceItemsOf,
  invoiceOccurredAt,
  invoicePaymentsOf,
  parseOccurredAt,
  shopScope,
  sqliteOnOrBefore,
} from '../utils/invoiceRead.js';
import {
  withNotHidden,
  wantsHiddenBills,
  isHiddenBill,
  isVoidOrFullyReturnedStatus,
  loadHiddenInvoiceIds,
  expandHiddenLinkedSourceIds,
  HIDDEN_INVOICE,
} from '../utils/invoiceVisibility.js';
import { invoiceDateRangeWhere, newestInvoiceFirstOrder, sortRowsByInvoiceNoDesc, compareInvoiceNoDesc, compareErpStatementAsc, calendarDayFromValue, decorateErpStatementRecency } from '../utils/reportQuery.js';
import { getActiveBillingDate } from './dailyClosingService.js';
import { getHiddenLiquidPockets } from './paymentTransferService.js';
import { buildHiddenOldGoldSummary } from './hiddenOldGoldSummary.js';
import { stockCostValue } from './productCost.js';

function ymd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function liveFinancial(where = {}) {
  return { ...where, ...excludePreAccountsWhere() };
}

function liveJournal(where = {}) {
  return { ...where, ...excludePreAccountsJournalWhere() };
}

async function hiddenSourceExclude(shopId, includeHidden) {
  if (includeHidden) return null;
  const hidden = await loadHiddenInvoiceIds(shopId);
  if (!hidden.size) return null;
  const expanded = await expandHiddenLinkedSourceIds(shopId, [...hidden]);
  return expanded.length ? expanded : null;
}

function parseRange(query = {}) {
  const to = query.to || ymd();
  let from = query.from;
  const preset = String(query.preset || '').toLowerCase();
  const today = new Date();
  if (!from && preset) {
    const d = new Date(today);
    if (preset === 'today') from = ymd(d);
    else if (preset === 'yesterday') {
      d.setDate(d.getDate() - 1);
      from = ymd(d);
      return { from, to: from };
    } else if (preset === 'this_week') {
      const day = d.getDay() || 7;
      d.setDate(d.getDate() - day + 1);
      from = ymd(d);
    } else if (preset === 'this_month') {
      from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    } else if (preset === 'last_month') {
      const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const last = new Date(d.getFullYear(), d.getMonth(), 0);
      return { from: ymd(first), to: ymd(last) };
    } else if (preset === 'this_year') {
      from = `${d.getFullYear()}-01-01`;
    } else from = to;
  }
  if (!from) from = to;
  return { from, to };
}

function daysBetween(a, b) {
  const ms = new Date(b) - new Date(a);
  return Math.max(0, Math.floor(ms / 86400000));
}

function ageingBucket(days) {
  if (days <= 0) return 'current';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return '90_plus';
}

export async function getAccountsDashboard(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  // The shop's active transaction date, not the real calendar day — "today's
  // sales" must mean today-per-the-shop, same anchor as everything else.
  const { date: today } = await getActiveBillingDate({ shopId });
  const includeHidden = wantsHiddenBills(query);

  await ensureDefaultAccounts(shopId);

  const invWhereBase = liveFinancial({
    ...shopScope(shopId),
    cancelled_at: null,
    // Business day (Transaction date), not the real created_at timestamp —
    // see invoiceDateRangeWhere. Otherwise a sale entered under a backdated/
    // held-open transaction date wouldn't show up when that date is selected.
    ...invoiceDateRangeWhere({ from, to }),
  });
  const invWhere = includeHidden ? invWhereBase : withNotHidden(invWhereBase);
  const invoices = await Invoice.findAll({
    where: invWhere,
    attributes: [
      'id', 'grand_total', 'gst_amount', 'balance_due', 'status', 'payments',
      'old_gold_value', 'created_at', 'business_date', 'subtotal', 'discount',
    ],
  });

  let sales = 0;
  let gstOut = 0;
  let collections = 0;
  let exchange = 0;
  const byMode = { cash: 0, upi: 0, card: 0, bank_transfer: 0, cheque: 0, other: 0 };
  for (const inv of invoices) {
    sales += Number(inv.grand_total) || 0;
    gstOut += Number(inv.gst_amount) || 0;
    exchange += Number(inv.old_gold_value) || 0;
    for (const p of invoicePaymentsOf(inv)) {
      const amt = Number(p.amount) || 0;
      collections += amt;
      const m = String(p.mode || 'cash').toLowerCase();
      if (m === 'cash') byMode.cash += amt;
      else if (m === 'upi') byMode.upi += amt;
      else if (m === 'card') byMode.card += amt;
      else if (m === 'bank' || m === 'bank_transfer') byMode.bank_transfer += amt;
      else if (m === 'cheque') byMode.cheque += amt;
      else byMode.other += amt;
    }
  }

  const purchases = await Purchase.findAll({
    where: liveFinancial({
      shop_id: shopId,
      status: { [Op.notIn]: ['draft', 'voided'] },
      purchase_date: { [Op.between]: [from, to] },
    }),
    attributes: ['grand_total', 'gst_amount', 'balance', 'paid_amount'],
  });
  let purchaseTotal = 0;
  let gstIn = 0;
  for (const p of purchases) {
    purchaseTotal += Number(p.grand_total) || 0;
    gstIn += Number(p.gst_amount) || 0;
  }

  const expenses = await Expense.findAll({
    where: liveFinancial({
      shop_id: shopId,
      date: { [Op.between]: [from, to] },
    }),
    attributes: ['amount'],
  });
  const expenseTotal = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  const incomes = await Income.findAll({
    where: liveFinancial({
      shop_id: shopId,
      date: { [Op.between]: [from, to] },
    }),
    attributes: ['amount'],
  });
  const incomeTotal = incomes.reduce((s, i) => s + (Number(i.amount) || 0), 0);

  // Locked mode: strip hidden-bill journal postings out of every GL balance below,
  // so Cash in Hand / Bank / GST Payable / Profit read as if hidden bills never happened.
  // Also drop old-gold receipt/sale journals so converting hidden gold to cash/UPI
  // does not leak into liquid GL while locked.
  let hiddenGlExclude = null;
  if (!includeHidden) {
    const hiddenInvoiceIds = await loadHiddenInvoiceIds(shopId);
    if (hiddenInvoiceIds.size) {
      const expanded = await expandHiddenLinkedSourceIds(shopId, [...hiddenInvoiceIds]);
      if (expanded.length) hiddenGlExclude = expanded;
    }
  }

  const cash = await accountNetBalance(shopId, '1000', { to, excludeInvoiceIds: hiddenGlExclude });
  const bank = await accountNetBalance(shopId, '1010', { to, excludeInvoiceIds: hiddenGlExclude });
  const upi = await accountNetBalance(shopId, '1020', { to, excludeInvoiceIds: hiddenGlExclude });
  const card = await accountNetBalance(shopId, '1030', { to, excludeInvoiceIds: hiddenGlExclude });
  const ar = await accountNetBalance(shopId, '1100', { to, excludeInvoiceIds: hiddenGlExclude });
  const ap = await accountNetBalance(shopId, '2200', { to });
  const gstPay = await accountNetBalance(shopId, '2100', { to, excludeInvoiceIds: hiddenGlExclude });
  const salesGl = await accountNetBalance(shopId, '4000', { to, excludeInvoiceIds: hiddenGlExclude });
  const cogsGl = await accountNetBalance(shopId, '5000', { to, excludeInvoiceIds: hiddenGlExclude });
  const expGl = await accountNetBalance(shopId, '5100', { to, excludeInvoiceIds: hiddenGlExclude });
  const otherIncomeGl = await accountNetBalance(shopId, '4200', { to, excludeInvoiceIds: hiddenGlExclude });
  // income accounts are credit-nature — accountNetBalance already flips
  const grossProfit = toMoneyNumber(salesGl - cogsGl);
  const netProfit = toMoneyNumber(salesGl + otherIncomeGl - cogsGl - expGl);

  const pendingArWhereBase = liveFinancial({
    ...shopScope(shopId),
    balance_due: { [Op.gt]: 0 },
    cancelled_at: null,
  });
  const pendingArWhere = includeHidden ? pendingArWhereBase : withNotHidden(pendingArWhereBase);
  const pendingAr = await Invoice.findAll({
    where: pendingArWhere,
    include: [{ model: Customer, as: 'Customer', required: false, attributes: ['id', 'name', 'mobile'] }],
    order: [['created_at', 'DESC']],
    limit: 15,
  }).catch(async () => {
    // association may not exist — plain query
    return Invoice.findAll({
      where: pendingArWhere,
      order: [['created_at', 'DESC']],
      limit: 15,
    });
  });

  const pendingAp = await Purchase.findAll({
    where: liveFinancial({
      ...shopScope(shopId),
      balance: { [Op.gt]: 0 },
      status: { [Op.notIn]: ['draft', 'voided'] },
    }),
    order: [['purchase_date', 'DESC']],
    limit: 15,
  });

  const todayWhereBase = liveFinancial({
    ...shopScope(shopId),
    cancelled_at: null,
    // Business day, not the real created_at timestamp — see invoiceDateRangeWhere.
    ...invoiceDateRangeWhere({ from: today, to: today }),
  });
  const todayInv = await Invoice.findAll({
    where: includeHidden ? todayWhereBase : withNotHidden(todayWhereBase),
    attributes: ['grand_total', 'payments'],
  });
  let todaySales = 0;
  let todayCollections = 0;
  for (const inv of todayInv) {
    todaySales += Number(inv.grand_total) || 0;
    for (const p of invoicePaymentsOf(inv)) todayCollections += Number(p.amount) || 0;
  }
  const todayPurchases = await Purchase.sum('grand_total', {
    where: liveFinancial({
      shop_id: shopId,
      purchase_date: today,
      status: { [Op.notIn]: ['draft', 'voided'] },
    }),
  }) || 0;
  const todayExpenses = await Expense.sum('amount', {
    where: liveFinancial({ shop_id: shopId, date: today }),
  }) || 0;
  const todayIncome = await Income.sum('amount', {
    where: liveFinancial({ shop_id: shopId, date: today }),
  }) || 0;
  const todayPayRows = await Payment.findAll({
    where: liveFinancial({
      shop_id: shopId,
      paid_at: {
        [Op.gte]: new Date(`${today}T00:00:00`),
        [Op.lte]: new Date(`${today}T23:59:59`),
      },
    }),
    attributes: ['amount'],
    limit: 500,
  });
  // "Today's payments" for dashboard = vendor-ish cash out approximated by expenses + we show collections separately
  const todayPaymentsOut = todayExpenses;

  const recentJournalRows = await JournalEntry.findAll({
    where: liveJournal({ shop_id: shopId }),
    order: [['created_at', 'DESC']],
    limit: hiddenGlExclude ? 80 : 20,
  });
  const excludeRecent = hiddenGlExclude ? new Set(hiddenGlExclude) : null;
  const recentJournals = (excludeRecent
    ? recentJournalRows.filter((j) => !excludeRecent.has(j.source_id))
    : recentJournalRows
  ).slice(0, 20);

  return {
    from,
    to,
    kpis: {
      total_sales: toMoneyNumber(sales),
      total_purchases: toMoneyNumber(purchaseTotal),
      cash_in_hand: toMoneyNumber(cash),
      bank_balance: toMoneyNumber(bank + upi + card),
      bank_split: { bank: toMoneyNumber(bank), upi: toMoneyNumber(upi), card: toMoneyNumber(card) },
      customer_receivables: toMoneyNumber(ar),
      vendor_payables: toMoneyNumber(ap),
      gst_payable: toMoneyNumber(gstPay),
      gold_purchase_value: toMoneyNumber(purchaseTotal),
      exchange_value: toMoneyNumber(exchange),
      gross_profit: grossProfit,
      total_expenses: toMoneyNumber(Math.max(expenseTotal, expGl)),
      total_income: toMoneyNumber(Math.max(incomeTotal, otherIncomeGl)),
      net_profit: netProfit,
      output_gst_period: toMoneyNumber(gstOut),
      input_gst_period: toMoneyNumber(gstIn),
    },
    today: {
      sales: toMoneyNumber(todaySales),
      collections: toMoneyNumber(todayCollections),
      purchases: toMoneyNumber(todayPurchases),
      expenses: toMoneyNumber(todayExpenses),
      income: toMoneyNumber(todayIncome),
      payments: toMoneyNumber(todayPaymentsOut),
    },
    payment_method_summary: Object.fromEntries(
      Object.entries(byMode).map(([k, v]) => [k, toMoneyNumber(v)]),
    ),
    pending_customer_payments: pendingAr.map((i) => ({
      id: i.id,
      invoice_no: i.invoice_no,
      customer_id: i.customer_id,
      customer_name: i.Customer?.name || null,
      balance_due: toMoneyNumber(i.balance_due),
      grand_total: toMoneyNumber(i.grand_total),
      date: invoiceOccurredAt(i),
    })),
    pending_vendor_payments: pendingAp.map((p) => ({
      id: p.id,
      po_number: p.po_number,
      vendor_id: p.vendor_id,
      vendor_name: p.vendor_name,
      balance: toMoneyNumber(p.balance),
      grand_total: toMoneyNumber(p.grand_total),
      date: p.purchase_date,
    })),
    recent_transactions: recentJournals.map((j) => ({
      id: j.id,
      date: j.entry_date,
      memo: j.memo,
      source_type: j.source_type,
      source_id: j.source_id,
      voucher_no: j.voucher_no,
      created_at: j.created_at,
    })),
  };
}

function hiddenTenderSplit(payments = []) {
  const out = { cash: 0, upi: 0, card: 0, bank: 0, old_gold: 0, old_silver: 0, other: 0 };
  for (const p of payments || []) {
    const mode = String(p?.mode || '').toLowerCase().replace(/\s+/g, '_');
    const amt = Number(p?.amount) || 0;
    if (!(amt > 0)) continue;
    if (mode === 'cash') out.cash += amt;
    else if (mode === 'upi') out.upi += amt;
    else if (mode === 'card') out.card += amt;
    else if (mode === 'bank' || mode === 'bank_transfer' || mode === 'cheque' || mode === 'neft' || mode === 'rtgs') {
      out.bank += amt;
    } else if (mode === 'old_gold_exchange' || mode === 'old_gold' || mode === 'exchange') {
      out.old_gold += amt;
    } else if (mode === 'old_silver_exchange' || mode === 'old_silver') {
      out.old_silver += amt;
    } else out.other += amt;
  }
  return {
    cash: toMoneyNumber(out.cash),
    upi: toMoneyNumber(out.upi),
    card: toMoneyNumber(out.card),
    bank: toMoneyNumber(out.bank),
    old_gold: toMoneyNumber(out.old_gold),
    old_silver: toMoneyNumber(out.old_silver),
    other: toMoneyNumber(out.other),
  };
}

/**
 * Owner-only hidden billing picture: current hidden cash/bank/UPI/card sitting
 * in GL, plus hidden invoices and tenders for the selected period.
 * Callers must already have passed wantsHiddenBills.
 */
export async function getHiddenAccountsData(query = {}) {
  if (!wantsHiddenBills(query)) {
    throw Object.assign(new Error('Not found'), { status: 404 });
  }
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const pocketPack = await getHiddenLiquidPockets({ shopId, date: to });

  const where = liveFinancial({
    [Op.and]: [
      shopScope(shopId),
      HIDDEN_INVOICE,
      { cancelled_at: null },
      { status: { [Op.notIn]: ['cancelled', 'canceled', 'void', 'voided', 'returned'] } },
      invoiceDateRangeWhere({ from, to }),
    ],
  });

  const invoices = await Invoice.findAll({
    where,
    order: [['created_at', 'DESC']],
    limit: 500,
    attributes: [
      'id', 'invoice_no', 'customer_name', 'grand_total', 'payments',
      'balance_due', 'business_date', 'created_at', 'is_hidden', 'status',
      'gst_amount', 'old_gold_value', 'old_silver_value',
    ],
  });

  const receipts = { cash: 0, upi: 0, card: 0, bank: 0, old_gold: 0, old_silver: 0, other: 0 };
  let sales = 0;
  let outstanding = 0;
  const rows = invoices.map((inv) => {
    const pays = invoicePaymentsOf(inv);
    const split = hiddenTenderSplit(pays);
    if (!split.old_gold && Number(inv.old_gold_value) > 0) {
      split.old_gold = toMoneyNumber(inv.old_gold_value);
    }
    if (!split.old_silver && Number(inv.old_silver_value) > 0) {
      split.old_silver = toMoneyNumber(inv.old_silver_value);
    }
    const collected = toMoneyNumber(
      split.cash + split.upi + split.card + split.bank + split.other,
    );
    sales += Number(inv.grand_total) || 0;
    outstanding += Number(inv.balance_due) || 0;
    receipts.cash += split.cash;
    receipts.upi += split.upi;
    receipts.card += split.card;
    receipts.bank += split.bank;
    receipts.old_gold += split.old_gold;
    receipts.old_silver += split.old_silver || 0;
    receipts.other += split.other;
    return {
      id: inv.id,
      invoice_no: inv.invoice_no,
      date: invoiceOccurredAt(inv),
      customer_name: inv.customer_name || 'Walk-in',
      grand_total: toMoneyNumber(inv.grand_total),
      gst_amount: toMoneyNumber(inv.gst_amount),
      balance_due: toMoneyNumber(inv.balance_due),
      cash: split.cash,
      upi: split.upi,
      card: split.card,
      bank: split.bank,
      old_gold: split.old_gold,
      old_silver: split.old_silver || 0,
      other: split.other,
      collected,
      status: inv.status,
      is_hidden: true,
    };
  });

  const moneyReceipts = toMoneyNumber(
    receipts.cash + receipts.upi + receipts.card + receipts.bank + receipts.other,
  );
  const oldGold = await buildHiddenOldGoldSummary(invoices, { metal: 'gold' });
  const oldSilver = await buildHiddenOldGoldSummary(invoices, { metal: 'silver' });
  if (!(Number(receipts.old_gold) > 0) && Number(oldGold.value) > 0) {
    receipts.old_gold = oldGold.value;
  }
  if (!(Number(receipts.old_silver) > 0) && Number(oldSilver.value) > 0) {
    receipts.old_silver = oldSilver.value;
  }

  return {
    from,
    to,
    pockets: pocketPack.hidden,
    visible_pockets: pocketPack.visible,
    receipts: {
      cash: toMoneyNumber(receipts.cash),
      upi: toMoneyNumber(receipts.upi),
      card: toMoneyNumber(receipts.card),
      bank: toMoneyNumber(receipts.bank),
      old_gold: toMoneyNumber(receipts.old_gold),
      old_silver: toMoneyNumber(receipts.old_silver),
      other: toMoneyNumber(receipts.other),
      money: moneyReceipts,
    },
    old_gold: oldGold,
    old_silver: oldSilver,
    totals: {
      invoices: rows.length,
      sales: toMoneyNumber(sales),
      collections: moneyReceipts,
      outstanding: toMoneyNumber(outstanding),
    },
    rows,
  };
}

export async function listSalesAccounts(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const where = liveFinancial({
    ...shopScope(shopId),
    cancelled_at: null,
    status: { [Op.notIn]: ['cancelled', 'canceled', 'void', 'voided', 'returned'] },
    created_at: {
      [Op.gte]: new Date(`${from}T00:00:00`),
      [Op.lte]: new Date(`${to}T23:59:59`),
    },
  });
  if (query.customer_id) where.customer_id = query.customer_id;
  if (query.status) where.status = query.status;
  if (query.salesperson_id) where.salesperson_id = query.salesperson_id;
  if (query.counter_id) where.counter_id = query.counter_id;

  const includeHidden = wantsHiddenBills(query);
  const rows = await Invoice.findAll({
    where: includeHidden ? where : withNotHidden(where),
    order: newestInvoiceFirstOrder(),
    limit: Math.min(Number(query.limit) || 200, 500),
  });

  const mapped = rows.map((inv) => {
    const invPayments = invoicePaymentsOf(inv);
    const paySplit = salesRegisterPaymentSplit({
      payments: invPayments,
      old_gold_value: inv.old_gold_value,
      old_silver_value: inv.old_silver_value,
    });
    // Old Gold Exchange is now recorded as a payment row — only add old_gold_value
    // separately for legacy invoices where it was a grand-total deduction instead
    // (no payment row), to avoid double-counting it here.
    const hasOgPayment = invPayments.some((p) => {
      const m = String(p?.mode || '').toLowerCase();
      return m === 'old_gold_exchange' || m === 'old_gold' || m === 'exchange';
    });
    const paid = invPayments.reduce((s, p) => s + (Number(p.amount) || 0), 0)
      + (hasOgPayment ? 0 : (Number(inv.old_gold_value) || 0))
      + (Number(inv.scheme_credit) || 0);
    const balance = Number(inv.balance_due) || 0;
    let payment_status = 'paid';
    if (inv.status === 'cancelled') payment_status = 'cancelled';
    else if (balance > 0.5 && paid > 0) payment_status = 'partial';
    else if (balance > 0.5) payment_status = 'unpaid';
    else if (String(inv.status).includes('return')) payment_status = 'refunded';
    const modes = [...new Set(invPayments.map((p) => p.mode).filter(Boolean))];
    return {
      id: inv.id,
      invoice_no: inv.invoice_no,
      date: invoiceOccurredAt(inv),
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      counter_id: inv.counter_id,
      salesperson_id: inv.salesperson_id,
      taxable: toMoneyNumber((Number(inv.subtotal) || 0) - (Number(inv.discount) || 0)),
      discount: toMoneyNumber(inv.discount),
      cash: paySplit.cash,
      upi: paySplit.upi,
      bank: paySplit.bank,
      old_metal: paySplit.old_metal,
      old_silver: paySplit.old_silver,
      advance: paySplit.advance,
      other: paySplit.other,
      cgst: toMoneyNumber(inv.cgst_amount),
      sgst: toMoneyNumber(inv.sgst_amount),
      igst: toMoneyNumber(inv.igst_amount),
      tax_type: inv.tax_type || 'intra',
      grand_total: toMoneyNumber(inv.grand_total),
      paid_amount: toMoneyNumber(paid),
      balance_due: toMoneyNumber(balance),
      payment_methods: modes,
      payment_status,
      status: inv.status,
      is_hidden: Boolean(inv.is_hidden),
    };
  });

  return {
    from,
    to,
    rows: sortRowsByInvoiceNoDesc(mapped),
    totals: sumSalesRegisterTotals(mapped),
  };
}

export async function listPurchaseAccounts(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const where = liveFinancial({
    shop_id: shopId,
    status: { [Op.notIn]: ['draft', 'voided'] },
    purchase_date: { [Op.between]: [from, to] },
  });
  if (query.vendor_id) where.vendor_id = query.vendor_id;
  if (query.payment_status === 'paid') where.status = 'paid';
  if (query.payment_status === 'partial') where.status = 'partially_paid';
  if (query.payment_status === 'unpaid') {
    where.balance = { [Op.gt]: 0 };
    where.status = { [Op.notIn]: ['draft', 'voided', 'paid'] };
  }

  const rows = await Purchase.findAll({
    where,
    order: [['purchase_date', 'DESC']],
    limit: Math.min(Number(query.limit) || 200, 500),
  });

  return {
    from,
    to,
    rows: rows.map((p) => {
      const items = Array.isArray(p.items) ? p.items : [];
      let gross = 0;
      let net = 0;
      let stone = 0;
      for (const it of items) {
        gross += Number(it.gross_weight) || 0;
        net += Number(it.net_weight) || Number(it.weight) || 0;
        stone += Number(it.stone_weight) || 0;
      }
      const bal = Number(p.balance) || 0;
      const paid = Number(p.paid_amount) || 0;
      let payment_status = 'paid';
      if (bal > 0.5 && paid > 0) payment_status = 'partial';
      else if (bal > 0.5) payment_status = 'unpaid';
      return {
        id: p.id,
        po_number: p.po_number,
        date: p.purchase_date,
        vendor_id: p.vendor_id,
        vendor_name: p.vendor_name,
        gross_weight: toMoneyNumber(gross),
        net_weight: toMoneyNumber(net),
        stone_weight: toMoneyNumber(stone),
        taxable: toMoneyNumber(p.subtotal),
        gst_amount: toMoneyNumber(p.gst_amount),
        cgst: toMoneyNumber(p.cgst_amount),
        sgst: toMoneyNumber(p.sgst_amount),
        igst: toMoneyNumber(p.igst_amount),
        tax_type: p.tax_type || 'intra',
        grand_total: toMoneyNumber(p.grand_total),
        paid_amount: toMoneyNumber(paid),
        outstanding: toMoneyNumber(bal),
        payment_status,
        status: p.status,
      };
    }),
  };
}

export async function listReceivables(query = {}) {
  const shopId = await resolveShopId(query);
  const asOf = query.to || ymd();
  const includeHidden = wantsHiddenBills(query);
  const receivablesWhereBase = liveFinancial({
    ...shopScope(shopId),
    balance_due: { [Op.gt]: 0 },
    cancelled_at: null,
  });
  const rows = await Invoice.findAll({
    where: includeHidden ? receivablesWhereBase : withNotHidden(receivablesWhereBase),
    order: [['created_at', 'ASC']],
  });

  const orderRows = await Order.findAll({
    where: liveFinancial({
      ...shopScope(shopId),
      balance_due: { [Op.gt]: 0 },
      status: { [Op.notIn]: ['cancelled', 'canceled', 'delivered'] },
    }),
    order: [['created_at', 'ASC']],
  });

  const buckets = { current: 0, due_soon: 0, overdue: 0, d30: 0, d60: 0, d90: 0 };

  function ageOutstanding(bal, occurred) {
    const days = daysBetween(occurred ? ymd(occurred) : asOf, asOf);
    const bucket = ageingBucket(days);
    if (days <= 7) buckets.current += bal;
    else if (days <= 15) buckets.due_soon += bal;
    else buckets.overdue += bal;
    if (days > 30) buckets.d30 += bal;
    if (days > 60) buckets.d60 += bal;
    if (days > 90) buckets.d90 += bal;
    let status = 'Current';
    if (days > 15) status = 'Overdue';
    else if (days > 7) status = 'Due Soon';
    return { days, bucket, status };
  }

  const out = rows.map((inv) => {
    const occurred = invoiceOccurredAt(inv);
    const bal = toMoneyNumber(inv.balance_due);
    const { days, bucket, status } = ageOutstanding(bal, occurred);
    return {
      source: 'Invoice',
      customer_id: inv.customer_id,
      customer_name: inv.customer_name,
      invoice_id: inv.id,
      invoice_no: inv.invoice_no,
      invoice_date: occurred,
      total_amount: toMoneyNumber(inv.grand_total),
      paid_amount: toMoneyNumber((Number(inv.grand_total) || 0) - (Number(inv.balance_due) || 0)),
      outstanding: bal,
      days_outstanding: days,
      ageing_bucket: bucket,
      status,
      is_hidden: Boolean(inv.is_hidden),
    };
  });

  for (const ord of orderRows) {
    const occurred = ord.created_at;
    const bal = toMoneyNumber(ord.balance_due);
    const { days, bucket, status } = ageOutstanding(bal, occurred);
    out.push({
      source: 'Order',
      customer_id: ord.customer_id,
      customer_name: ord.customer_name,
      invoice_id: ord.id,
      invoice_no: ord.order_no,
      invoice_date: occurred,
      total_amount: toMoneyNumber(ord.estimated_price),
      paid_amount: toMoneyNumber(ord.advance_paid),
      outstanding: bal,
      days_outstanding: days,
      ageing_bucket: bucket,
      status,
      is_hidden: false,
    });
  }

  out.sort((a, b) => {
    const da = new Date(a.invoice_date || 0).getTime();
    const db = new Date(b.invoice_date || 0).getTime();
    return da - db;
  });

  return {
    as_of: asOf,
    summary: {
      total_receivables: toMoneyNumber(out.reduce((s, r) => s + r.outstanding, 0)),
      due_today: toMoneyNumber(buckets.current),
      overdue: toMoneyNumber(buckets.overdue),
      overdue_30: toMoneyNumber(buckets.d30),
      overdue_60: toMoneyNumber(buckets.d60),
      overdue_90: toMoneyNumber(buckets.d90),
    },
    rows: out,
  };
}

export async function listPayables(query = {}) {
  const shopId = await resolveShopId(query);
  const asOf = query.to || ymd();
  const rows = await Purchase.findAll({
    where: liveFinancial({
      ...shopScope(shopId),
      balance: { [Op.gt]: 0 },
      status: { [Op.notIn]: ['draft', 'voided'] },
    }),
    order: [['purchase_date', 'ASC']],
  });

  const buckets = { current: 0, overdue: 0, d30: 0, d60: 0, d90: 0 };
  const out = rows.map((p) => {
    const days = daysBetween(p.purchase_date, asOf);
    const bal = toMoneyNumber(p.balance);
    if (days <= 15) buckets.current += bal;
    else buckets.overdue += bal;
    if (days > 30) buckets.d30 += bal;
    if (days > 60) buckets.d60 += bal;
    if (days > 90) buckets.d90 += bal;
    let status = 'Current';
    if (days > 15) status = 'Overdue';
    else if (days > 7) status = 'Due Soon';
    return {
      source: 'Purchase',
      vendor_id: p.vendor_id,
      vendor_name: p.vendor_name,
      purchase_id: p.id,
      po_number: p.po_number,
      purchase_date: p.purchase_date,
      total_amount: toMoneyNumber(p.grand_total),
      paid_amount: toMoneyNumber(p.paid_amount),
      outstanding: bal,
      days_outstanding: days,
      ageing_bucket: ageingBucket(days),
      status,
    };
  });

  return {
    as_of: asOf,
    summary: {
      total_payables: toMoneyNumber(out.reduce((s, r) => s + r.outstanding, 0)),
      due_today: toMoneyNumber(buckets.current),
      overdue: toMoneyNumber(buckets.overdue),
      overdue_30: toMoneyNumber(buckets.d30),
      overdue_60: toMoneyNumber(buckets.d60),
      overdue_90: toMoneyNumber(buckets.d90),
    },
    rows: out,
  };
}

/** Cash book from GL account 1000 (authoritative) + optional cashbook_entries overlay note. */
export async function getCashBookGl(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const excludeSourceIds = await hiddenSourceExclude(shopId, wantsHiddenBills(query));
  const gl = await generalLedger({ shopId, accountCode: '1000', from, to, limit: 1000, excludeSourceIds });
  let opening = 0;
  // Approximate opening: balance before from
  if (from) {
    const prior = await accountNetBalance(shopId, '1000', { to: (() => {
      const d = new Date(from);
      d.setDate(d.getDate() - 1);
      return ymd(d);
    })(), excludeInvoiceIds: excludeSourceIds });
    opening = prior;
  }
  let running = opening;
  let cashIn = 0;
  let cashOut = 0;
  const rows = (gl.lines || []).map((l) => {
    const din = Number(l.debit) || 0;
    const dout = Number(l.credit) || 0;
    cashIn += din;
    cashOut += dout;
    running = toMoneyNumber(running + din - dout);
    return {
      date: l.entry_date,
      voucher: l.source_id,
      type: l.source_type,
      description: l.memo,
      reference: l.source_id,
      cash_in: din,
      cash_out: dout,
      running_balance: running,
    };
  });
  // Running total is oldest → newest; display newest transaction first.
  rows.reverse();
  return {
    from,
    to,
    opening_balance: toMoneyNumber(opening),
    total_in: toMoneyNumber(cashIn),
    total_out: toMoneyNumber(cashOut),
    closing_balance: toMoneyNumber(opening + cashIn - cashOut),
    rows,
    note: 'Derived from GL Cash (1000).',
  };
}

export async function getBankBookGl(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const code = query.account || '1010';
  const allowed = new Set(['1010', '1020', '1030']);
  const acct = allowed.has(code) ? code : '1010';
  const excludeSourceIds = await hiddenSourceExclude(shopId, wantsHiddenBills(query));
  const gl = await generalLedger({ shopId, accountCode: acct, from, to, limit: 1000, excludeSourceIds });
  let opening = 0;
  if (from) {
    const d = new Date(from);
    d.setDate(d.getDate() - 1);
    opening = await accountNetBalance(shopId, acct, { to: ymd(d), excludeInvoiceIds: excludeSourceIds });
  }
  let running = opening;
  const rows = (gl.lines || []).map((l) => {
    const debit = Number(l.debit) || 0;
    const credit = Number(l.credit) || 0;
    running = toMoneyNumber(running + debit - credit);
    return {
      date: l.entry_date,
      transaction: l.memo || l.source_type,
      reference: l.source_id,
      debit,
      credit,
      balance: running,
      source_type: l.source_type,
    };
  });
  rows.reverse();
  return {
    from,
    to,
    account_code: acct,
    account: gl.account,
    opening_balance: toMoneyNumber(opening),
    closing_balance: running,
    accounts: [
      { code: '1010', name: 'Bank' },
      { code: '1020', name: 'UPI' },
      { code: '1030', name: 'Card' },
    ],
    rows,
  };
}

export async function getDayBook(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const hiddenExclude = await hiddenSourceExclude(shopId, wantsHiddenBills(query));
  const skipIds = hiddenExclude ? new Set(hiddenExclude) : null;
  const allEntries = await JournalEntry.findAll({
    where: liveJournal({
      shop_id: shopId,
      entry_date: { [Op.between]: [from, to] },
    }),
    order: [['entry_date', 'ASC'], ['created_at', 'ASC']],
    limit: Math.min(Number(query.limit) || 500, 1000),
  });
  const entries = skipIds
    ? allEntries.filter((e) => !skipIds.has(e.source_id))
    : allEntries;
  const ids = entries.map((e) => e.id);
  const lines = ids.length
    ? await JournalLine.findAll({ where: { journal_entry_id: { [Op.in]: ids } } })
    : [];
  const accounts = await ChartOfAccount.findAll({ where: { shop_id: shopId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const linesByEntry = new Map();
  for (const l of lines) {
    const arr = linesByEntry.get(l.journal_entry_id) || [];
    arr.push(l);
    linesByEntry.set(l.journal_entry_id, arr);
  }

  const rows = [];
  for (const e of entries) {
    if (query.type && e.source_type !== query.type) continue;
    const els = linesByEntry.get(e.id) || [];
    let debit = 0;
    let credit = 0;
    for (const l of els) {
      debit += (Number(l.debit_paise) || 0) / 100;
      credit += (Number(l.credit_paise) || 0) / 100;
    }
    rows.push({
      id: e.id,
      date: e.entry_date,
      time: e.created_at,
      voucher_no: e.voucher_no || e.id.slice(0, 8),
      type: e.source_type,
      reference: e.source_id,
      description: e.memo,
      debit: toMoneyNumber(debit),
      credit: toMoneyNumber(credit),
      user_id: e.created_by,
      lines: els.map((l) => ({
        account: byId.get(l.account_id)?.code,
        account_name: byId.get(l.account_id)?.name,
        debit: (Number(l.debit_paise) || 0) / 100,
        credit: (Number(l.credit_paise) || 0) / 100,
        memo: l.memo,
      })),
    });
  }
  return { from, to, rows };
}

export async function listReceipts(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const includeHidden = wantsHiddenBills(query);
  const hiddenIds = includeHidden ? new Set() : await loadHiddenInvoiceIds(shopId);
  const payments = await Payment.findAll({
    where: liveFinancial({
      ...shopScope(shopId),
      paid_at: {
        [Op.gte]: new Date(`${from}T00:00:00`),
        [Op.lte]: new Date(`${to}T23:59:59`),
      },
    }),
    order: [['paid_at', 'DESC']],
    limit: 300,
  });
  const advances = await CustomerAdvance.findAll({
    where: liveFinancial({
      shop_id: shopId,
      created_at: {
        [Op.gte]: new Date(`${from}T00:00:00`),
        [Op.lte]: new Date(`${to}T23:59:59`),
      },
    }),
    order: [['created_at', 'DESC']],
    limit: 100,
  }).catch(() => []);

  const invoiceIds = [...new Set(payments.map((p) => p.invoice_id).filter(Boolean))];
  const invoices = invoiceIds.length
    ? await Invoice.findAll({
      where: { id: invoiceIds },
      attributes: ['id', 'invoice_no'],
    })
    : [];
  const invoiceNoById = new Map(invoices.map((inv) => [inv.id, inv.invoice_no]));

  const rows = [
    ...payments.filter((p) => !p.invoice_id || !hiddenIds.has(p.invoice_id)).map((p) => ({
      id: p.id,
      invoice_no: invoiceNoById.get(p.invoice_id) || '',
      receipt_no: p.id.slice(0, 8).toUpperCase(),
      date: invoiceOccurredAt(p),
      type: 'customer_payment',
      customer_id: p.customer_id,
      reference: p.reference || '',
      mode: p.mode,
      amount: toMoneyNumber(p.amount),
      created_by: p.received_by,
    })),
    ...advances.map((a) => ({
      id: a.id,
      invoice_no: '',
      receipt_no: `ADV-${a.id.slice(0, 6).toUpperCase()}`,
      date: invoiceOccurredAt(a),
      type: 'advance',
      customer_id: a.customer_id,
      reference: a.reference || a.id,
      mode: a.mode,
      amount: toMoneyNumber(a.amount),
      created_by: a.created_by,
    })),
  ].sort((a, b) => {
    const byInv = compareInvoiceNoDesc(a.invoice_no, b.invoice_no);
    if (byInv) return byInv;
    return new Date(b.date || 0) - new Date(a.date || 0);
  });

  return { from, to, rows };
}

export async function listPaymentsRegister(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const purchases = await Purchase.findAll({
    where: liveFinancial({
      shop_id: shopId,
      status: { [Op.notIn]: ['draft', 'voided'] },
    }),
    limit: 200,
  });
  const rows = [];
  for (const p of purchases) {
    for (const pay of p.payments || []) {
      const d = pay.date || p.purchase_date;
      if (d < from || d > to) continue;
      rows.push({
        id: pay.id || `${p.id}-${d}-${pay.amount}`,
        payment_no: (pay.id || p.id).toString().slice(0, 8).toUpperCase(),
        date: d,
        type: 'vendor_payment',
        payee: p.vendor_name,
        reference: p.po_number || p.id,
        mode: pay.mode,
        amount: toMoneyNumber(pay.amount),
      });
    }
  }
  const expenses = await Expense.findAll({
    where: liveFinancial({ shop_id: shopId, date: { [Op.between]: [from, to] } }),
    order: [['date', 'DESC']],
    limit: 200,
  });
  for (const e of expenses) {
    rows.push({
      id: e.id,
      payment_no: `EXP-${e.id.slice(0, 6).toUpperCase()}`,
      date: e.date,
      type: 'expense',
      payee: e.category_name || e.description,
      reference: e.reference,
      mode: e.payment_mode,
      amount: toMoneyNumber(e.amount),
    });
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { from, to, rows };
}

export async function getSchemeAccounts(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const schemes = await Scheme.findAll({
    where: liveFinancial({ shop_id: shopId }),
    order: [['created_at', 'DESC']],
    limit: 500,
  });

  let active = 0;
  let matured = 0;
  let redeemed = 0;
  let collected = 0;
  let pending = 0;
  let liability = 0;
  const rows = schemes.map((s) => {
    const payments = Array.isArray(s.payments) ? s.payments : [];
    const paidCount = payments.length;
    const totalCollected = payments.reduce((sum, p) => sum + (Number(p.amount) || Number(s.monthly_amount) || 0), 0);
    const pendingInst = Math.max(0, (Number(s.duration_months) || 0) - paidCount);
    const pendingAmt = pendingInst * (Number(s.monthly_amount) || 0);
    if (s.status === 'active') active += 1;
    if (s.status === 'matured') matured += 1;
    if (s.status === 'completed' || s.status === 'breaked' || s.redeemed_at) redeemed += 1;
    collected += totalCollected;
    pending += pendingAmt;
    if (s.status === 'active' || s.status === 'matured') liability += totalCollected;

    // Period collections
    let periodColl = 0;
    for (const p of payments) {
      // Scheme payment entries carry `business_date` (the transaction date), not
      // a field literally named `date` — this always fell through to the real
      // paid_at clock time, silently miscounting which period a payment landed in.
      const d = String(p.business_date || p.paid_at || '').slice(0, 10);
      if (d >= from && d <= to) periodColl += Number(p.amount) || Number(s.monthly_amount) || 0;
    }

    return {
      id: s.id,
      member: s.customer_name,
      customer_id: s.customer_id,
      scheme_no: s.id.slice(0, 8).toUpperCase(),
      plan_name: s.plan_name,
      monthly_amount: toMoneyNumber(s.monthly_amount),
      paid_installments: paidCount,
      pending_installments: pendingInst,
      total_collected: toMoneyNumber(totalCollected),
      period_collected: toMoneyNumber(periodColl),
      status: s.status,
      start_date: s.start_date,
      redeemed_at: s.redeemed_at,
    };
  });

  const periodTotal = rows.reduce((s, r) => s + r.period_collected, 0);
  const glLiability = await accountNetBalance(shopId, '2300');

  return {
    from,
    to,
    summary: {
      active_schemes: active,
      total_members: schemes.length,
      this_period_collections: toMoneyNumber(periodTotal),
      pending_collections: toMoneyNumber(pending),
      matured_schemes: matured,
      redeemed_schemes: redeemed,
      outstanding_scheme_liability: toMoneyNumber(Math.max(liability, glLiability)),
      gl_scheme_liability: toMoneyNumber(glLiability),
    },
    rows,
  };
}

export async function getGstAccounts(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const invoices = await Invoice.findAll({
    where: liveFinancial({
      ...shopScope(shopId),
      cancelled_at: null,
      created_at: {
        [Op.gte]: new Date(`${from}T00:00:00`),
        [Op.lte]: new Date(`${to}T23:59:59`),
      },
    }),
    attributes: ['subtotal', 'discount', 'gst_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'grand_total'],
  });
  const purchases = await Purchase.findAll({
    where: liveFinancial({
      shop_id: shopId,
      status: { [Op.notIn]: ['draft', 'voided'] },
      purchase_date: { [Op.between]: [from, to] },
    }),
    attributes: ['subtotal', 'gst_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'grand_total'],
  });

  let salesTaxable = 0;
  let outCgst = 0;
  let outSgst = 0;
  let outIgst = 0;
  let outGst = 0;
  for (const i of invoices) {
    salesTaxable += (Number(i.subtotal) || 0) - (Number(i.discount) || 0);
    outGst += Number(i.gst_amount) || 0;
    outCgst += Number(i.cgst_amount) || 0;
    outSgst += Number(i.sgst_amount) || 0;
    outIgst += Number(i.igst_amount) || 0;
  }
  if (outIgst === 0 && outCgst === 0 && outGst > 0) {
    outCgst = outGst / 2;
    outSgst = outGst - outCgst;
  }

  let purchaseTaxable = 0;
  let inGst = 0;
  let inCgst = 0;
  let inSgst = 0;
  let inIgst = 0;
  for (const p of purchases) {
    purchaseTaxable += Number(p.subtotal) || 0;
    inGst += Number(p.gst_amount) || 0;
    inCgst += Number(p.cgst_amount) || 0;
    inSgst += Number(p.sgst_amount) || 0;
    inIgst += Number(p.igst_amount) || 0;
  }
  if (inIgst === 0 && inCgst === 0 && inGst > 0) {
    inCgst = inGst / 2;
    inSgst = inGst - inCgst;
  }

  const glOut = await accountNetBalance(shopId, '2100');
  const glIn = await accountNetBalance(shopId, '1400');

  return {
    from,
    to,
    sales_taxable: toMoneyNumber(salesTaxable),
    output_cgst: toMoneyNumber(outCgst),
    output_sgst: toMoneyNumber(outSgst),
    output_igst: toMoneyNumber(outIgst),
    output_gst: toMoneyNumber(outGst),
    purchase_taxable: toMoneyNumber(purchaseTaxable),
    input_cgst: toMoneyNumber(inCgst),
    input_sgst: toMoneyNumber(inSgst),
    input_igst: toMoneyNumber(inIgst),
    input_gst: toMoneyNumber(inGst),
    net_gst_payable: toMoneyNumber(outGst - inGst),
    gl_output_gst: toMoneyNumber(glOut),
    gl_input_gst: toMoneyNumber(glIn),
    note: 'Period figures from invoice/purchase snapshots (CGST/SGST/IGST); GL balances are cumulative control accounts.',
  };
}

export async function getMetalAccounts(query = {}) {
  const shopId = await resolveShopId(query);
  const includeHidden = wantsHiddenBills(query);
  const hiddenIds = includeHidden ? new Set() : await loadHiddenInvoiceIds(shopId);
  const hiddenGlExclude = includeHidden || !hiddenIds.size
    ? null
    : await expandHiddenLinkedSourceIds(shopId, [...hiddenIds]);
  const products = await Product.findAll({
    where: { shop_id: shopId },
    attributes: [
      'id',
      'name',
      'metal_type_id',
      'purity_id',
      'net_weight',
      'gross_weight',
      'stock_qty',
      'status',
      'purchase_price',
      'inventory_mode',
      'tray_total_weight',
      'purchase_cost_per_gram',
    ],
    limit: 5000,
  });

  const metalIds = [...new Set(products.map((p) => p.metal_type_id).filter(Boolean))];
  const metalRows = metalIds.length
    ? await CatalogItem.findAll({
      where: { id: { [Op.in]: metalIds } },
      attributes: ['id', 'name', 'code'],
    })
    : [];
  const metalNameById = new Map(metalRows.map((m) => [m.id, m.name || m.code || m.id]));

  const purityIds = [...new Set(products.map((p) => p.purity_id).filter(Boolean))];
  const purityRows = purityIds.length
    ? await CatalogItem.findAll({
      where: { id: { [Op.in]: purityIds } },
      attributes: ['id', 'name', 'code'],
    })
    : [];
  const purityNameById = new Map(purityRows.map((p) => [p.id, p.name || p.code || p.id]));

  const byMetal = {};
  const byMetalPurity = {};
  for (const p of products) {
    if (p.status === 'sold' || p.status === 'discontinued' || p.status === 'deleted' || p.status === 'deleted_p') continue;
    const qty = Number(p.stock_qty) || 0;
    if (qty <= 0) continue;
    const metal = String(metalNameById.get(p.metal_type_id) || 'Unspecified').trim() || 'Unspecified';
    if (!byMetal[metal]) {
      byMetal[metal] = {
        metal,
        pieces: 0,
        net_weight: 0,
        gross_weight: 0,
        value: 0,
      };
    }
    // Tray unit: net/gross weight already hold the tray's own pooled weight
    // (not a per-piece figure) — use as-is instead of multiplying by pieces.
    const isTray = Number(p.tray_total_weight) > 0;
    const netW = isTray ? (Number(p.tray_total_weight) || 0) : (Number(p.net_weight) || 0) * qty;
    const grossW = isTray ? (Number(p.tray_total_weight) || 0) : (Number(p.gross_weight) || 0) * qty;
    byMetal[metal].pieces += qty;
    byMetal[metal].net_weight += netW;
    byMetal[metal].gross_weight += grossW;
    byMetal[metal].value += stockCostValue(p, qty);

    const purity = String(purityNameById.get(p.purity_id) || 'Unspecified').trim() || 'Unspecified';
    const mpKey = `${metal}|${purity}`;
    if (!byMetalPurity[mpKey]) {
      byMetalPurity[mpKey] = { metal, purity, pieces: 0, net_weight: 0, gross_weight: 0 };
    }
    byMetalPurity[mpKey].pieces += qty;
    byMetalPurity[mpKey].net_weight += netW;
    byMetalPurity[mpKey].gross_weight += grossW;
  }

  const og = await OldGoldReceipt.findAll({
    where: {
      shop_id: shopId,
      status: { [Op.in]: ['in_stock', 'posted', 'available'] },
    },
    attributes: ['weight_g', 'value', 'purity', 'invoice_id', 'metal'],
    limit: 2000,
  });
  let ogWeight = 0;
  let ogValue = 0;
  let osWeight = 0;
  let osValue = 0;
  for (const r of og) {
    if (r.invoice_id && hiddenIds.has(r.invoice_id)) continue;
    if (String(r.metal || '').toLowerCase() === 'silver') {
      osWeight += Number(r.weight_g) || 0;
      osValue += Number(r.value) || 0;
    } else {
      ogWeight += Number(r.weight_g) || 0;
      ogValue += Number(r.value) || 0;
    }
  }

  const glInv = await accountNetBalance(shopId, '1200');
  const glOg = await accountNetBalance(shopId, '1300', {
    excludeInvoiceIds: hiddenGlExclude?.length ? hiddenGlExclude : null,
  });
  const glOs = await accountNetBalance(shopId, '1310', {
    excludeInvoiceIds: hiddenGlExclude?.length ? hiddenGlExclude : null,
  });

  return {
    metals: Object.values(byMetal)
      .map((m) => ({
        ...m,
        net_weight: toMoneyNumber(m.net_weight),
        gross_weight: toMoneyNumber(m.gross_weight),
        value: toMoneyNumber(m.value),
      }))
      .sort((a, b) => String(a.metal).localeCompare(String(b.metal))),
    by_purity: Object.values(byMetalPurity)
      .map((r) => ({
        ...r,
        net_weight: toMoneyNumber(r.net_weight),
        gross_weight: toMoneyNumber(r.gross_weight),
      }))
      .sort((a, b) => String(a.metal).localeCompare(String(b.metal)) || String(a.purity).localeCompare(String(b.purity))),
    old_gold: {
      weight_g: toMoneyNumber(ogWeight),
      value: toMoneyNumber(ogValue),
      gl_balance: toMoneyNumber(glOg),
    },
    old_silver: {
      weight_g: toMoneyNumber(osWeight),
      value: toMoneyNumber(osValue),
      gl_balance: toMoneyNumber(glOs),
    },
    inventory_gl: toMoneyNumber(glInv),
    note: 'Physical quantities from product stock; values use purchase_price. Movement detail remains in inventory module.',
  };
}

export async function listAuditTrail(query = {}) {
  const shopId = await resolveShopId(query);
  const { from, to } = parseRange(query);
  const where = { shop_id: shopId };
  if (from || to) {
    where.created_at = {};
    if (from) where.created_at[Op.gte] = new Date(`${from}T00:00:00`);
    if (to) where.created_at[Op.lte] = new Date(`${to}T23:59:59`);
  }
  if (query.action) where.action = query.action;
  if (query.entity_type) where.entity_type = query.entity_type;

  const rows = await AuditEvent.findAll({
    where,
    order: [['seq', 'DESC']],
    limit: Math.min(Number(query.limit) || 100, 500),
  });

  return {
    from,
    to,
    rows: rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      date: r.created_at,
      user_id: r.user_id,
      action: r.action,
      event_type: r.event_type,
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      reason: r.reason,
      old_value: r.old_value,
      new_value: r.new_value,
    })),
  };
}

const ERP_STMT_CAP = 8000;
const NON_MONEY_MODES = new Set([
  'old_gold', 'old_gold_exchange', 'exchange',
  'old_silver', 'old_silver_exchange',
  'scheme', 'scheme_credit', 'advance', 'customer_advance',
]);

function joinDesc(parts) {
  return parts.map((p) => (p == null ? '' : String(p).trim())).filter(Boolean).join(' · ');
}

function fmtModeLabel(mode) {
  const m = String(mode || '').toLowerCase().replace(/\s+/g, '_');
  if (m === 'upi') return 'UPI';
  if (m === 'bank' || m === 'bank_transfer') return 'Bank';
  if (!m) return '';
  return m.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function isMoneyMode(mode) {
  const m = String(mode || 'cash').toLowerCase().replace(/\s+/g, '_');
  return !NON_MONEY_MODES.has(m);
}

/** Which "Total: Cash/UPI/Bank/Cheque/Old Gold Exchange" print-summary bucket
 * a payment mode belongs to. Returns null for anything not in that fixed set
 * (advances, scheme, purchases, expenses, etc. simply don't contribute). */
function modeBucket(mode) {
  const m = String(mode || '').toLowerCase().replace(/\s+/g, '_');
  if (m === 'cash') return 'cash';
  if (m === 'upi') return 'upi';
  if (m === 'cheque' || m === 'check') return 'cheque';
  if (m === 'bank' || m === 'bank_transfer' || m === 'neft' || m === 'rtgs') return 'bank';
  if (m === 'old_gold_exchange' || m === 'old_gold' || m === 'exchange') return 'old_gold_exchange';
  if (m === 'old_silver_exchange' || m === 'old_silver') return 'old_silver_exchange';
  return null;
}

function asDate(value) {
  return parseOccurredAt(value);
}

/**
 * When the cashier last saved this row in the ERP. created_at / paid_at are
 * pinned onto the Transaction date (so SSJ-1/0010 billed this morning on
 * 19 Sep sorts as 1:30am that day, under 0007 from yesterday evening).
 * updated_at is the real save clock and is what "latest transaction" means.
 */
function modelActivityAt(row) {
  if (!row) return null;
  return row.updatedAt || row.updated_at || row.recorded_at || null;
}

/**
 * A sub-row (a tender/payment line embedded in an invoice/purchase's own
 * `payments` JSON) usually has no `business_date` of its own — only the
 * parent record does. Anchoring every sub-row to the SAME parent business
 * date (with its own real time-of-day spliced in) keeps every row of one
 * transaction on one consistent date, instead of the sale row showing the
 * business date while its tender/refund rows show whatever raw real date
 * the payment happened to be entered on.
 *
 * Individual JSON payment entries (e.g. `{mode:'cash', amount:...}`) usually
 * carry no timestamp of their own at all — falling straight to midnight in
 * that case would show a DIFFERENT time for the Cash/UPI tender rows than
 * the invoice's other rows (like its old-gold-exchange row, which comes from
 * a real OldGoldReceipt with its own real createdAt). `fallbackRealTime`
 * (the parent invoice/purchase's own real createdAt) keeps every row of the
 * same transaction on the exact same time-of-day when the tender itself has
 * no more specific timestamp to offer.
 */
function subRowOccurredAt(parentBusinessDate, realTimeSource, fallbackRealTime) {
  return invoiceOccurredAt({
    business_date: parentBusinessDate,
    paid_at: realTimeSource,
    createdAt: fallbackRealTime,
  });
}

/** Combine a DATEONLY `date` with a user-entered "HH:MM" `time` (Expenses/
 * Income) into one timestamp — falls back to date-only (midnight) when no
 * time was recorded, and to invoiceOccurredAt for anything else. */
function dateTimeOf(record) {
  const date = record?.date;
  const time = record?.time;
  if (date && time && /^\d{2}:\d{2}$/.test(time)) {
    const combined = asDate(`${String(date).slice(0, 10)}T${time}:00`);
    if (combined) return combined;
  }
  return invoiceOccurredAt(record) || asDate(date);
}

function jsonArr(value) {
  const v = parseJsonField(value, []);
  return Array.isArray(v) ? v : [];
}

async function resolveShopId(query = {}) {
  // Local/single-shop desktop deployments: always use the one configured shop.
  // A synced/seeded req.user.shop_id can drift from the shop invoices actually
  // posted under (same class of drift billingService.js heals for Customer.shop_id),
  // which otherwise makes real invoices invisible to every Accounts report.
  const { isLocalMode } = await import('../db.js');
  if (isLocalMode()) return getDefaultShopId();
  return query._shop_id || query.shop_id || await getDefaultShopId();
}

function itemNames(items) {
  const names = items
    .map((i) => i?.name || i?.product_name || i?.description)
    .filter(Boolean);
  if (!names.length) return '';
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

function saleKind(items) {
  if (!items.length) return 'Jewellery sale';
  const pure = items.filter((i) => i?.is_pure_metal || i?.line_type === 'pure_metal');
  if (pure.length && pure.length === items.length) {
    const metals = new Set(pure.map((i) => String(i.metal || '').toLowerCase()));
    if (metals.size === 1 && [...metals][0].includes('silver')) return 'Pure silver sale';
    if ([...metals].some((m) => m.includes('silver')) && [...metals].some((m) => m.includes('gold'))) {
      return 'Pure metal sale';
    }
    return 'Pure gold sale';
  }
  return 'Jewellery sale';
}

function purchaseKind(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'gold_bullion') return 'New gold purchase';
  if (t === 'finished_goods') return 'Jewellery purchase';
  if (t === 'stones') return 'Stone purchase';
  if (t === 'karigar_work') return 'Karigar work purchase';
  return 'Purchase';
}

function fmtWeightPurity(weight, purity) {
  const w = Number(weight);
  const wt = w ? `${w.toFixed(3)} g` : '';
  return joinDesc([wt, purity]);
}

function invoiceVoid(inv) {
  if (!inv) return true;
  if (inv.cancelled_at || inv.cancelledAt) return true;
  return isVoidOrFullyReturnedStatus(inv.status);
}

/** Payment.meta.kind values written by cancelInvoice / returnService for a real cash refund. */
export const INVOICE_REFUND_META_KINDS = Object.freeze([
  'invoice_cancel_refund',
  'invoice_return_refund',
]);

/**
 * True only for an actual refund Payment row — not reconstructed from invoice totals.
 * Historical cancelled bills often still show collected = grand_total - balance_due
 * with no refund row; those must have zero ERP Statement impact.
 */
export function isRealInvoiceRefundPayment(payment) {
  if (!payment) return false;
  const meta = payment.meta && typeof payment.meta === 'object' ? payment.meta : {};
  if (!INVOICE_REFUND_META_KINDS.includes(meta.kind)) return false;
  return Math.abs(toMoneyNumber(payment.amount)) > 0;
}

function invoiceExcludedFromStatement(inv, { includeHidden = false } = {}) {
  if (invoiceVoid(inv)) return true;
  return isHiddenBill(inv) && !includeHidden;
}

const LIQUID_ACCOUNT_CODES = ['1000', '1010', '1020', '1030'];
const LIQUID_CODE_TO_MODE = { 1000: 'cash', 1010: 'bank', 1020: 'upi', 1030: 'card' };
const TILL_OPENING_KEY = 'till_opening_cash';

/**
 * Read Cash + Bank + UPI + Card once and derive both opening and closing.
 * The previous implementation called accountBalances once per account code,
 * causing eight full journal scans for one ERP Statement request.
 */
async function loadLiquidGlBalances(shopId, from, to, { excludeInvoiceIds = null } = {}) {
  const accounts = await ChartOfAccount.findAll({
    where: { shop_id: shopId, code: { [Op.in]: LIQUID_ACCOUNT_CODES } },
    attributes: ['id'],
  });
  if (!accounts.length) return { opening: 0, closing: 0 };

  const entries = await JournalEntry.findAll({
    where: liveJournal({
      shop_id: shopId,
      entry_date: { [Op.lte]: to },
    }),
    attributes: ['id', 'entry_date', 'source_id', 'financial_mode', 'is_opening', 'source_type'],
  });
  const excluded = excludeInvoiceIds?.length ? new Set(excludeInvoiceIds) : null;
  const includedEntries = excluded
    ? entries.filter((entry) => !excluded.has(entry.source_id))
    : entries;
  if (!includedEntries.length) return { opening: 0, closing: 0 };

  const entryDate = new Map(
    includedEntries.map((entry) => [entry.id, String(entry.entry_date || '').slice(0, 10)]),
  );
  const lines = await JournalLine.findAll({
    where: {
      journal_entry_id: { [Op.in]: includedEntries.map((entry) => entry.id) },
      account_id: { [Op.in]: accounts.map((account) => account.id) },
    },
    attributes: ['journal_entry_id', 'debit_paise', 'credit_paise'],
  });

  let openingPaise = 0;
  let closingPaise = 0;
  for (const line of lines) {
    const netPaise = (Number(line.debit_paise) || 0) - (Number(line.credit_paise) || 0);
    closingPaise += netPaise;
    if ((entryDate.get(line.journal_entry_id) || '') < from) openingPaise += netPaise;
  }
  return {
    opening: toMoneyNumber(openingPaise / 100),
    closing: toMoneyNumber(closingPaise / 100),
  };
}

async function loadTillOpeningFloat(shopId) {
  const row = await Setting.findOne({
    where: { key: TILL_OPENING_KEY },
  });
  if (!row?.value) return 0;
  let v = row.value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = { amount: v };
    }
  }
  const amt = typeof v === 'object' && v != null ? v.amount : v;
  return toMoneyNumber(amt);
}

async function hasAccountingCutover(shopId) {
  const row = await JournalEntry.findOne({
    where: { shop_id: shopId, source_type: 'opening_balance' },
    attributes: ['id'],
  });
  return Boolean(row);
}

async function hasPriorClosedDay(shopId) {
  const row = await DailyClosing.findOne({
    where: { shop_id: shopId, status: 'closed' },
    attributes: ['id'],
  });
  return Boolean(row);
}

async function resolveErpOpeningBalance(shopId, { glOpening, opsOpening }) {
  const tillFloat = await loadTillOpeningFloat(shopId);
  const cutover = await hasAccountingCutover(shopId);
  const goLive = tillFloat > 0 && !cutover && !(await hasPriorClosedDay(shopId));

  if (goLive) {
    return {
      opening: toMoneyNumber(glOpening + tillFloat),
      source: 'till_float',
      note: 'Opening balance (drawer float + Cash/Bank/UPI/Card from ledger)',
    };
  }

  if (glOpening !== 0 || opsOpening !== 0 || cutover) {
    return {
      opening: glOpening,
      source: 'gl_liquid',
      note: cutover && glOpening === 0 && opsOpening === 0
        ? 'Opening balance (before go-live cutover in this period)'
        : 'Opening balance (Cash + Bank + UPI + Card from ledger)',
    };
  }

  return {
    opening: 0,
    source: 'gl_liquid',
    note: 'Opening balance',
  };
}

/** Opening-balance cutover vouchers in period — shown as passbook rows (Tally-style). */
async function loadSetupJournalEvents(shopId, from, to) {
  const accounts = await ChartOfAccount.findAll({
    where: { shop_id: shopId, code: { [Op.in]: LIQUID_ACCOUNT_CODES } },
  });
  if (!accounts.length) return [];

  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const entries = await JournalEntry.findAll({
    where: {
      shop_id: shopId,
      source_type: 'opening_balance',
      entry_date: { [Op.between]: [from, to] },
    },
  });
  if (!entries.length) return [];

  const lines = await JournalLine.findAll({
    where: {
      journal_entry_id: { [Op.in]: entries.map((e) => e.id) },
      account_id: { [Op.in]: accounts.map((a) => a.id) },
    },
  });
  const entryMap = new Map(entries.map((e) => [e.id, e]));
  const out = [];
  for (const l of lines) {
    const e = entryMap.get(l.journal_entry_id);
    const acct = acctById.get(l.account_id);
    const debit = (Number(l.debit_paise) || 0) / 100;
    const credit = (Number(l.credit_paise) || 0) / 100;
    const netIn = toMoneyNumber(debit - credit);
    if (netIn === 0) continue;
    // entry_date is DATEONLY — splice in the voucher's real posting time,
    // same rule as every other transaction in the ERP (invoiceOccurredAt).
    // NOTE: JournalEntry's auto timestamp is exposed as `createdAt` (JS-side
    // attribute name), not `created_at` (the physical column) — Sequelize
    // only auto-maps explicitly-named snake_case fields like `paid_at`.
    const when = invoiceOccurredAt({ business_date: e?.entry_date, paid_at: e?.createdAt }) || asDate(e?.entry_date);
    if (!when) continue;
    out.push({
      id: `setup-${e.id}-${l.id}`,
      at: when,
      recordedAt: e?.updatedAt || e?.updated_at || when,
      description: joinDesc([
        'Opening balance (setup)',
        acct?.name,
        l.memo || e?.memo,
      ]),
      debit: netIn < 0 ? Math.abs(netIn) : 0,
      credit: netIn > 0 ? netIn : 0,
      source_type: 'opening_balance',
      source_id: e?.source_id,
      // Opening cash/bank/UPI/card counts (from Accounts Opening / cutover)
      // are real liquid movement too — tag by account so they land in the
      // "Total: Cash/UPI/Bank/Cheque" mode breakdown, not just the passbook.
      mode: LIQUID_CODE_TO_MODE[acct?.code] || null,
    });
  }
  return out;
}

/**
 * Operational passbook of POS billing, expenses, purchases, schemes, advances.
 * Opening/closing align with GL liquid accounts (1000–1030) like Cash Book / dashboard.
 * Hidden bills stay off this passbook until the owner unlocks them
 * (`include_hidden` + owner role). Unlocked, they list like a normal POS
 * sale (invoice no + cash/UPI/card). Locked, their journals are also
 * stripped from the liquid GL close so they do not appear as a plug.
 * Credit = value in, Debit = value out, Balance = running (opening + credit − debit).
 */
export async function getErpStatement(query = {}) {
  const shopId = await resolveShopId(query);
  await ensureDefaultAccounts(shopId);
  const { from, to } = parseRange(query);
  const fromStart = new Date(`${from}T00:00:00`);
  const toEnd = new Date(`${to}T23:59:59.999`);
  const shopWhere = shopScope(shopId);
  // This is a SQL-level pre-filter on the row's REAL created_at, purely to
  // avoid scanning the shop's entire history — the actual inclusion decision
  // happens later in JS against business-date-based occurred_at timestamps
  // (see invoiceOccurredAt / the e._ts loop below). Only a LOWER bound is
  // safe here: business_date is always <= the row's real created_at (a
  // transaction can't be tagged with a future business day), so
  // `business_date >= from` guarantees `created_at >= from` too — but the
  // reverse isn't true for an UPPER bound. When the active business day is
  // stale (transactions still posting to yesterday's date while the real
  // clock has moved into today), a row's business_date can fall well inside
  // [from, to] while its real created_at is AFTER `to` — an upper bound here
  // would silently drop it before the JS loop ever sees it. That's exactly
  // why a narrow range like "Yesterday" could go missing rows that a wider
  // range (which still happened to cover today's real timestamps) did not.
  const createdRange = {
    created_at: {
      [Op.gte]: from,
    },
  };

  const wantsHidden = wantsHiddenBills(query);
  const shopHiddenIds = wantsHidden ? new Set() : await loadHiddenInvoiceIds(shopId);
  let hiddenGlExclude = null;
  if (!wantsHidden && shopHiddenIds.size) {
    const expanded = await expandHiddenLinkedSourceIds(shopId, [...shopHiddenIds]);
    if (expanded.length) hiddenGlExclude = expanded;
  }

  const [
    allInvoices,
    purchases,
    expenses,
    incomes,
    receipts,
    oldGoldSales,
    schemes,
    advances,
    creditNotes,
    cashbook,
    orders,
    payments,
    customers,
    liquidBalances,
  ] = await Promise.all([
    Invoice.findAll({
      where: liveFinancial({
        ...shopWhere,
        ...createdRange,
      }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }),
    Purchase.findAll({
      where: liveFinancial({ ...shopWhere, status: { [Op.notIn]: ['draft', 'voided'] }, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }),
    Expense.findAll({
      where: liveFinancial({ ...shopWhere, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }),
    Income.findAll({
      where: liveFinancial({ ...shopWhere, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }),
    OldGoldReceipt.findAll({
      where: liveFinancial({ ...shopWhere, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }),
    OldGoldSale.findAll({
      where: liveFinancial({ ...shopWhere, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }).catch(() => []),
    Scheme.findAll({
      where: liveFinancial(shopWhere),
      limit: ERP_STMT_CAP,
    }),
    CustomerAdvance.findAll({
      where: liveFinancial({ ...shopWhere, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }),
    CreditNote.findAll({
      where: liveFinancial({ ...shopWhere, status: { [Op.notIn]: ['void', 'voided', 'cancelled'] }, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }).catch(() => []),
    CashbookEntry.findAll({
      where: liveFinancial({ ...shopWhere, ...createdRange }),
      order: [['created_at', 'DESC']],
      limit: ERP_STMT_CAP,
    }).catch(() => []),
    Order.findAll({
      where: liveFinancial({ ...shopWhere, status: { [Op.notIn]: ['cancelled', 'canceled'] }, ...createdRange }),
      limit: ERP_STMT_CAP,
    }).catch(() => []),
    Payment.findAll({
      where: liveFinancial({
        ...shopWhere,
        invoice_id: null,
        status: { [Op.notIn]: ['void', 'voided', 'cancelled'] },
        ...createdRange,
      }),
      limit: ERP_STMT_CAP,
    }).catch(() => []),
    Customer.findAll({
      where: shopWhere,
      attributes: ['id', 'name', 'mobile', 'serial_no'],
      limit: 5000,
    }),
    loadLiquidGlBalances(shopId, from, to, { excludeInvoiceIds: hiddenGlExclude }),
  ]);

  // Once the owner has unlocked hidden bills for this request, they must
  // behave like any other bill here too — only genuinely void/cancelled
  // invoices stay excluded, nothing gets re-hidden behind isHiddenBill.
  const hiddenInvoices = wantsHidden ? [] : (allInvoices || []).filter((i) => isHiddenBill(i));
  const invoices = (allInvoices || []).filter((i) => (wantsHidden || !isHiddenBill(i)) && !invoiceVoid(i));
  const allById = new Map((allInvoices || []).map((i) => [i.id, i]));
  const hiddenIds = shopHiddenIds;
  const hiddenNos = new Set(hiddenInvoices.map((i) => i.invoice_no).filter(Boolean));
  const linkedToHidden = (invoiceId, invoiceNo) => {
    if (invoiceNo && hiddenNos.has(String(invoiceNo))) return true;
    if (!invoiceId) return false;
    if (hiddenIds.has(invoiceId)) return true;
    if (!allById.has(invoiceId)) return false;
    const inv = allById.get(invoiceId);
    return invoiceExcludedFromStatement(inv, { includeHidden: wantsHidden });
  };

  const customerName = new Map((customers || []).map((c) => [c.id, c.name]));
  const customerSerial = new Map((customers || []).map((c) => [c.id, c.serial_no]));
  const invoiceById = new Map((invoices || []).map((i) => [i.id, i]));
  await hydrateInvoiceItems(invoices || []);

  const paymentsByInvoice = new Map();
  if ((invoices || []).length) {
    const payRows = await Payment.findAll({
      where: {
        invoice_id: { [Op.in]: invoices.map((i) => i.id) },
        status: { [Op.notIn]: ['void', 'voided', 'cancelled'] },
      },
    }).catch(() => []);
    for (const p of payRows || []) {
      const arr = paymentsByInvoice.get(p.invoice_id) || [];
      arr.push(p);
      paymentsByInvoice.set(p.invoice_id, arr);
    }
  }

  const events = [];

  const modeTotals = { cash: 0, upi: 0, bank: 0, cheque: 0, old_gold_exchange: 0, old_silver_exchange: 0 };
  const push = ({
    id, at, description, debit = 0, credit = 0, source_type, source_id,
    settlementType = 'liquid', mode = null,
    invoiceId = null, customerId = null, recordedAt = null,
  }) => {
    const when = asDate(at);
    if (!when) return false;
    const d = toMoneyNumber(debit);
    const c = toMoneyNumber(credit);
    if (d <= 0 && c <= 0) return false;
    const resolvedInvoiceId = invoiceId
      || ((source_type === 'sale' || source_type === 'refund') ? source_id : null);
    const recorded = asDate(recordedAt) || when;
    events.push({
      id,
      occurred_at: when.toISOString(),
      business_day: calendarDayFromValue(when),
      recorded_at: recorded.toISOString(),
      _ts: when.getTime(),
      description: description || 'Transaction',
      debit: d,
      credit: c,
      source_type,
      source_id,
      invoice_id: resolvedInvoiceId || null,
      customer_id: customerId || null,
      // Old gold exchange is barter settlement (Dr 1300 Old Gold Stock in the GL) —
      // it never touches Cash/Bank/UPI/Card, so it must not move the liquid running
      // balance even though it's still shown as a passbook row.
      settlement_type: settlementType,
      affects_liquid_balance: settlementType !== 'non_cash',
      mode_bucket: modeBucket(mode),
    });
    return true;
  };

  for (const inv of invoices || []) {
    if (isPreAccountsRecord(inv) || invoiceExcludedFromStatement(inv, { includeHidden: wantsHidden })) continue;
    const items = invoiceItemsOf(inv);
    const kind = saleKind(items);
    const names = itemNames(items);
    const who = inv.customer_name || 'Walk-in';
    const saleAt = invoiceOccurredAt(inv);
    const jsonPays = invoicePaymentsOf(inv);
    const tablePays = (paymentsByInvoice.get(inv.id) || []).map((p) => ({
      mode: p.mode,
      amount: p.amount,
      paid_at: p.paid_at,
    }));
    const pays = jsonPays.length ? jsonPays : tablePays;
    let credited = 0;
    pays.forEach((p, idx) => {
      if (!isMoneyMode(p?.mode)) return;
      const amt = Number(p.amount) || 0;
      if (amt <= 0) return;
      const when = subRowOccurredAt(inv.business_date, p.paid_at || p.date, inv.createdAt) || saleAt;
      const ok = push({
        id: `sale-${inv.id}-${idx}`,
        at: when,
        recordedAt: modelActivityAt(inv),
        description: joinDesc([kind, inv.invoice_no, who, names, fmtModeLabel(p.mode)]),
        credit: amt,
        source_type: 'sale',
        source_id: inv.id,
        mode: p.mode,
        invoiceId: inv.id,
        customerId: inv.customer_id,
      });
      if (ok) credited += amt;
    });
    // grand_total is already net of scheme (and, for legacy invoices, old gold too).
    // Always surface a POS bill when no cash/UPI/card tender was parsed (credit sale /
    // missing payments JSON). New-style invoices carry Old Gold as a payment row
    // (excluded from `credited` by isMoneyMode) and it's credited separately below
    // (via OldGoldReceipt or the old-gold fallback loop) — subtract it here so a
    // fully old-gold-settled invoice isn't credited twice.
    if (credited <= 0) {
      const hasOgPayment = pays.some((p) => String(p?.mode || '').toLowerCase() === 'old_gold_exchange');
      const hasOsPayment = pays.some((p) => String(p?.mode || '').toLowerCase() === 'old_silver_exchange');
      const ogAlreadyCredited = hasOgPayment ? (Number(inv.old_gold_value) || 0) : 0;
      const osAlreadyCredited = hasOsPayment ? (Number(inv.old_silver_value) || 0) : 0;
      const saleAmt = Math.max(0, (Number(inv.grand_total) || 0) - ogAlreadyCredited - osAlreadyCredited);
      if (saleAmt > 0) {
        push({
          id: `sale-${inv.id}`,
          at: saleAt,
          recordedAt: modelActivityAt(inv),
          description: joinDesc([kind, inv.invoice_no, who, names]),
          credit: saleAmt,
          source_type: 'sale',
          source_id: inv.id,
          invoiceId: inv.id,
          customerId: inv.customer_id,
        });
      }
    }
  }

  // Cancelled/returned invoices stay in the database for audit, but they must
  // not recreate the original tender as an ERP Statement credit. That used to
  // put historical cancelled bills back on the passbook after GL had already
  // reversed them. Only a real refund Payment row belongs here (as a debit).
  // When a refund exists, keep the original collected credit beside it so the
  // pair nets to zero and matches journal reversal — do not invent a debit
  // when no refund was recorded.
  const voidInvoices = (allInvoices || []).filter((i) => (
    invoiceVoid(i)
    && !isPreAccountsRecord(i)
    && (wantsHidden || !isHiddenBill(i))
  ));
  if (voidInvoices.length) {
    await hydrateInvoiceItems(voidInvoices);
    const voidIds = voidInvoices.map((i) => i.id);
    const refundRows = await Payment.findAll({
      where: { invoice_id: { [Op.in]: voidIds } },
    }).catch(() => []);
    const refundsByInvoice = new Map();
    for (const p of refundRows) {
      if (!isRealInvoiceRefundPayment(p)) continue;
      const arr = refundsByInvoice.get(p.invoice_id) || [];
      arr.push(p);
      refundsByInvoice.set(p.invoice_id, arr);
    }
    for (const inv of voidInvoices) {
      const refunds = refundsByInvoice.get(inv.id) || [];
      if (!refunds.length) continue;

      const items = invoiceItemsOf(inv);
      const kind = saleKind(items);
      const names = itemNames(items);
      const who = inv.customer_name || 'Walk-in';
      const saleAt = invoiceOccurredAt(inv);
      const collected = Math.max(0, toMoneyNumber(inv.grand_total) - toMoneyNumber(inv.balance_due));
      // Old gold / silver handed back on cancel is barter, like the original
      // exchange: its original credit and its return are both non-cash rows,
      // and only the money part of `collected` touches the liquid balance.
      const metalRefunds = refunds.filter((r) => !isMoneyMode(r.mode));
      const metalBack = toMoneyNumber(metalRefunds.reduce((s, r) => s + Math.abs(toMoneyNumber(r.amount)), 0));
      const liquidCollected = Math.max(0, toMoneyNumber(collected - metalBack));
      if (liquidCollected > 0) {
        push({
          id: `sale-void-${inv.id}`,
          at: saleAt,
          recordedAt: modelActivityAt(inv),
          description: joinDesc([kind, inv.invoice_no, who, names, '(cancelled/returned)']),
          credit: liquidCollected,
          source_type: 'sale',
          source_id: inv.id,
          invoiceId: inv.id,
          customerId: inv.customer_id,
        });
      }
      for (const r of metalRefunds) {
        push({
          id: `sale-void-metal-${r.id}`,
          at: saleAt,
          recordedAt: modelActivityAt(inv),
          description: joinDesc([kind, inv.invoice_no, who, fmtModeLabel(r.mode), '(cancelled/returned)']),
          credit: Math.abs(toMoneyNumber(r.amount)),
          source_type: 'sale',
          source_id: inv.id,
          settlementType: 'non_cash',
          mode: r.mode,
          invoiceId: inv.id,
          customerId: inv.customer_id,
        });
      }
      for (const r of refunds) {
        const metal = !isMoneyMode(r.mode);
        push({
          id: `refund-${r.id}`,
          at: invoiceOccurredAt(r),
          recordedAt: modelActivityAt(r) || modelActivityAt(inv),
          description: joinDesc([metal ? 'Returned to customer' : 'Refund', inv.invoice_no, who, fmtModeLabel(r.mode)]),
          debit: Math.abs(toMoneyNumber(r.amount)),
          source_type: 'refund',
          source_id: inv.id,
          ...(metal ? { settlementType: 'non_cash' } : {}),
          mode: r.mode,
          invoiceId: inv.id,
          customerId: inv.customer_id,
        });
      }
    }
  }

  const invoiceNos = new Set((invoices || []).map((i) => i.invoice_no).filter(Boolean));
  const exchangeCovered = new Set();
  for (const r of receipts || []) {
    if (isPreAccountsRecord(r)) continue;
    const inv = r.invoice_id ? invoiceById.get(r.invoice_id) : null;
    if (linkedToHidden(r.invoice_id, inv?.invoice_no)) continue;
    if (inv && invoiceExcludedFromStatement(inv, { includeHidden: wantsHidden })) continue;
    const amt = Number(r.value) || 0;
    const metal = fmtWeightPurity(r.weight_g, r.purity);
    const who = inv?.customer_name || customerName.get(r.customer_id) || '';
    const isSilver = normalizeReceiptMetal(r.metal) === 'silver';
    if (r.invoice_id) {
      exchangeCovered.add(r.invoice_id);
      push({
        id: `ogx-${r.id}`,
        at: invoiceOccurredAt(r),
        recordedAt: modelActivityAt(inv) || modelActivityAt(r),
        description: joinDesc([
          isSilver ? 'Old silver exchange' : 'Old gold exchange',
          inv?.invoice_no || r.receipt_no,
          who,
          metal,
          r.description,
        ]),
        credit: amt,
        source_type: isSilver ? 'old_silver_exchange' : 'old_gold_exchange',
        source_id: r.id,
        settlementType: 'non_cash',
        mode: isSilver ? 'old_silver_exchange' : 'old_gold_exchange',
        invoiceId: r.invoice_id,
        customerId: inv?.customer_id || r.customer_id,
      });
    } else {
      push({
        id: `ogb-${r.id}`,
        at: invoiceOccurredAt(r),
        recordedAt: modelActivityAt(r),
        description: joinDesc([
          isSilver ? 'Old silver purchase' : 'Old gold purchase',
          r.receipt_no,
          who,
          metal,
          r.description,
        ]),
        debit: amt,
        source_type: isSilver ? 'old_silver_buy' : 'old_gold_buy',
        source_id: r.id,
      });
    }
  }

  for (const inv of invoices || []) {
    if (isPreAccountsRecord(inv) || invoiceExcludedFromStatement(inv, { includeHidden: wantsHidden }) || exchangeCovered.has(inv.id)) continue;
    const og = Number(inv.old_gold_value) || 0;
    if (og <= 0) continue;
    push({
      id: `ogx-inv-${inv.id}`,
      at: invoiceOccurredAt(inv),
      recordedAt: modelActivityAt(inv),
      description: joinDesc(['Old gold exchange', inv.invoice_no, inv.customer_name]),
      credit: og,
      source_type: 'old_gold_exchange',
      source_id: inv.id,
      settlementType: 'non_cash',
      mode: 'old_gold_exchange',
      invoiceId: inv.id,
      customerId: inv.customer_id,
    });
  }
  for (const inv of invoices || []) {
    if (isPreAccountsRecord(inv) || invoiceExcludedFromStatement(inv, { includeHidden: wantsHidden }) || exchangeCovered.has(inv.id)) continue;
    const os = Number(inv.old_silver_value) || 0;
    if (os <= 0) continue;
    push({
      id: `osx-inv-${inv.id}`,
      at: invoiceOccurredAt(inv),
      recordedAt: modelActivityAt(inv),
      description: joinDesc(['Old silver exchange', inv.invoice_no, inv.customer_name]),
      credit: os,
      source_type: 'old_silver_exchange',
      source_id: inv.id,
      settlementType: 'non_cash',
      mode: 'old_silver_exchange',
      invoiceId: inv.id,
      customerId: inv.customer_id,
    });
  }

  // Old Gold Sale/Disposal (to a wholesaler/refiner) is real Cash/Bank/UPI
  // inflow — a genuine liquid passbook row, not a GL-only entry — otherwise
  // it only ever shows up anonymously as a "GL reconciliation" plug since the
  // journal it posts touches a liquid account with nothing here to explain it.
  const hiddenOgSaleIds = new Set();
  if (!wantsHidden && (oldGoldSales || []).length) {
    const rids = [...new Set(
      (oldGoldSales || []).flatMap((s) => (Array.isArray(s.receipt_ids) ? s.receipt_ids : []).filter(Boolean)),
    )];
    if (rids.length) {
      const recs = await OldGoldReceipt.findAll({
        where: { id: { [Op.in]: rids } },
        attributes: ['id', 'invoice_id'],
      }).catch(() => []);
      const badReceipts = new Set(
        (recs || []).filter((r) => r.invoice_id && shopHiddenIds.has(r.invoice_id)).map((r) => r.id),
      );
      for (const s of oldGoldSales) {
        const ids = Array.isArray(s.receipt_ids) ? s.receipt_ids : [];
        if (ids.some((id) => badReceipts.has(id))) hiddenOgSaleIds.add(s.id);
      }
    }
  }
  for (const s of oldGoldSales || []) {
    if (isPreAccountsRecord(s)) continue;
    if (s.status === 'cancelled') continue;
    if (hiddenOgSaleIds.has(s.id)) continue;
    const netReceived = toMoneyNumber((Number(s.sale_value) || 0) - (Number(s.refining_charges) || 0));
    if (netReceived <= 0) continue;
    const isSilverSale = normalizeReceiptMetal(s.metal) === 'silver';
    push({
      id: `ogsale-${s.id}`,
      at: invoiceOccurredAt(s),
      recordedAt: modelActivityAt(s),
      description: joinDesc([
        isSilverSale ? 'Old Silver Sale / Disposal' : 'Old Gold Sale / Disposal',
        s.sale_no,
        s.buyer_name,
        fmtModeLabel(s.payment_mode),
      ]),
      credit: netReceived,
      source_type: isSilverSale ? 'old_silver_sale' : 'old_gold_sale',
      source_id: s.id,
      mode: s.payment_mode,
    });
  }

  for (const p of purchases || []) {
    if (isPreAccountsRecord(p)) continue;
    const items = jsonArr(p.items);
    const names = itemNames(items);
    const kind = purchaseKind(p.purchase_type);
    const pays = jsonArr(p.payments);
    if (pays.length) {
      pays.forEach((pay, idx) => {
        const amt = Number(pay.amount) || 0;
        if (amt <= 0) return;
        push({
          id: `pur-${p.id}-${idx}`,
          at: subRowOccurredAt(p.purchase_date, pay.paid_at || pay.date, p.createdAt) || invoiceOccurredAt(p),
          recordedAt: modelActivityAt(p),
          description: joinDesc([kind, p.po_number, p.vendor_name, names, fmtModeLabel(pay.mode)]),
          debit: amt,
          source_type: 'purchase',
          source_id: p.id,
          mode: pay.mode,
        });
      });
    } else if (Number(p.paid_amount) > 0) {
      push({
        id: `pur-${p.id}`,
        at: invoiceOccurredAt(p),
        recordedAt: modelActivityAt(p),
        description: joinDesc([kind, p.po_number, p.vendor_name, names]),
        debit: p.paid_amount,
        source_type: 'purchase',
        source_id: p.id,
      });
    }
  }

  for (const e of expenses || []) {
    if (isPreAccountsRecord(e)) continue;
    push({
      id: `exp-${e.id}`,
      at: dateTimeOf(e),
      recordedAt: modelActivityAt(e),
      description: joinDesc(['Expense', e.category_name, e.description, fmtModeLabel(e.payment_mode)]),
      debit: e.amount,
      source_type: 'expense',
      source_id: e.id,
      mode: e.payment_mode,
    });
  }

  for (const i of incomes || []) {
    if (isPreAccountsRecord(i)) continue;
    push({
      id: `inc-${i.id}`,
      at: dateTimeOf(i),
      recordedAt: modelActivityAt(i),
      description: joinDesc(['Income', i.description, fmtModeLabel(i.payment_mode)]),
      credit: i.amount,
      source_type: 'income',
      source_id: i.id,
      mode: i.payment_mode,
    });
  }

  for (const s of schemes || []) {
    if (isPreAccountsRecord(s)) continue;
    const pays = jsonArr(s.payments);
    pays.forEach((p, idx) => {
      const amt = Number(p.amount) || 0;
      if (amt <= 0) return;
      const isLast = idx === pays.length - 1;
      const recorded = p.recorded_at || (isLast ? (s.updatedAt || s.updated_at) : null);
      push({
        id: `sch-${s.id}-${p.id || idx}`,
        // p.business_date (the transaction date), not the real paid_at clock
        // time, is the anchor — same rule as every other row in this passbook.
        at: invoiceOccurredAt(p) || invoiceOccurredAt(s),
        recordedAt: recorded,
        description: joinDesc([
          'Scheme installment',
          s.customer_name,
          s.plan_name,
          fmtModeLabel(p.mode),
        ]),
        credit: amt,
        source_type: 'scheme',
        source_id: s.id,
        mode: p.mode,
        customerId: s.customer_id,
      });
    });
  }

  for (const a of advances || []) {
    if (isPreAccountsRecord(a)) continue;
    push({
      id: `adv-${a.id}`,
      at: invoiceOccurredAt(a),
      recordedAt: modelActivityAt(a),
      description: joinDesc([
        'Customer advance',
        customerName.get(a.customer_id),
        a.reference,
        fmtModeLabel(a.mode),
      ]),
      credit: a.amount,
      source_type: 'advance',
      source_id: a.id,
      mode: a.mode,
    });
  }

  for (const o of orders || []) {
    if (isPreAccountsRecord(o)) continue;
    const amt = Number(o.advance_paid) || 0;
    if (amt <= 0) continue;
    push({
      id: `ord-${o.id}`,
      at: invoiceOccurredAt(o),
      recordedAt: modelActivityAt(o),
      description: joinDesc([
        o.type === 'repair' ? 'Repair order advance' : 'Custom order advance',
        o.order_no,
        o.customer_name,
        o.description,
      ]),
      credit: amt,
      source_type: 'order_advance',
      source_id: o.id,
    });
  }

  for (const cn of creditNotes || []) {
    if (isPreAccountsRecord(cn)) continue;
    if (linkedToHidden(cn.invoice_id, cn.invoice_no)) continue;
    const inv = invoiceById.get(cn.invoice_id);
    if (inv && invoiceExcludedFromStatement(inv, { includeHidden: wantsHidden })) continue;
    push({
      id: `cn-${cn.id}`,
      at: invoiceOccurredAt(cn),
      recordedAt: modelActivityAt(cn),
      description: joinDesc([
        'Credit note',
        cn.credit_note_no,
        cn.reason,
        inv?.invoice_no ? `Inv ${inv.invoice_no}` : null,
        inv?.customer_name,
      ]),
      debit: cn.grand_total,
      source_type: 'credit_note',
      source_id: cn.id,
      invoiceId: cn.invoice_id,
      customerId: inv?.customer_id,
    });
  }

  for (const c of cashbook || []) {
    if (isPreAccountsRecord(c)) continue;
    if (c.linked_expense_id || c.linked_invoice_id) continue;
    if (linkedToHidden(c.linked_invoice_id, c.reference)) continue;
    if (c.reference && (invoiceNos.has(c.reference) || hiddenNos.has(String(c.reference)))) continue;
    const amt = Number(c.amount) || 0;
    const isIn = String(c.entry_type).toLowerCase() === 'in';
    const isPaymentTransfer = String(c.reference || '').startsWith('TRF-');
    push({
      id: `cb-${c.id}`,
      at: invoiceOccurredAt(c) || asDate(c.date),
      recordedAt: modelActivityAt(c),
      description: joinDesc([
        isPaymentTransfer ? 'Payment transfer' : (c.contra ? 'Cash book (contra)' : 'Cash book'),
        c.notes || c.reference,
        fmtModeLabel(c.mode),
      ]),
      credit: isIn ? amt : 0,
      debit: isIn ? 0 : amt,
      source_type: 'cashbook',
      source_id: c.id,
      mode: c.mode,
    });
  }

  for (const p of payments || []) {
    if (isPreAccountsRecord(p)) continue;
    if (!isMoneyMode(p.mode)) continue;
    if (linkedToHidden(p.invoice_id, p.reference)) continue;
    // Advance receipts are mirrored here as a Payment row (for the cash
    // register) AND as their own CustomerAdvance row (the loop above) —
    // skip the mirror or the same cash-in gets counted twice. The refund
    // side has no CustomerAdvance row of its own, so it still belongs here.
    if (p.meta?.kind === 'customer_advance') continue;
    const amt = toMoneyNumber(p.amount);
    const isRefund = amt < 0;
    const isAdvanceRefund = p.meta?.kind === 'customer_advance_refund';
    // A refund is a negative Payment.amount — passing that straight through as
    // `credit` made push() treat it as "nothing to record" (both debit and
    // credit <= 0) and silently drop the row. The GL journal still posted it
    // though, so the passbook's running total fell out of sync with the real
    // GL balance — which is exactly what the "GL reconciliation" plug further
    // down exists to paper over, with a synthetic date and a description that
    // can't name what actually happened. Recording it properly as a debit here
    // means that plug never has to fire for this money in the first place.
    push({
      id: `pay-${p.id}`,
      at: invoiceOccurredAt(p),
      recordedAt: modelActivityAt(p),
      description: joinDesc([
        isAdvanceRefund ? 'Customer advance refund' : (isRefund ? 'Refund' : 'Receipt'),
        customerName.get(p.customer_id),
        p.reference,
        fmtModeLabel(p.mode),
      ]),
      credit: isRefund ? 0 : amt,
      debit: isRefund ? Math.abs(amt) : 0,
      source_type: isAdvanceRefund ? 'advance_refund' : 'payment',
      source_id: p.id,
      mode: p.mode,
    });
  }

  for (const ev of await loadSetupJournalEvents(shopId, from, to)) {
    push(ev);
  }

  for (const e of events) {
    const inv = e.invoice_id ? (allById.get(e.invoice_id) || invoiceById.get(e.invoice_id)) : null;
    e.invoice_no = inv?.invoice_no || null;
    e.customer_id = e.customer_id || inv?.customer_id || null;
    e.customer_serial = e.customer_id != null ? (customerSerial.get(e.customer_id) ?? null) : null;
    if (!e.recorded_at && inv) {
      const activity = asDate(modelActivityAt(inv));
      if (activity) e.recorded_at = activity.toISOString();
    }
  }

  decorateErpStatementRecency(events);
  events.sort(compareErpStatementAsc);

  let opsOpening = 0;
  for (const e of events) {
    const day = e.business_day || calendarDayFromValue(e.occurred_at);
    if (day && day < from && e.affects_liquid_balance !== false) {
      opsOpening = toMoneyNumber(opsOpening + e.credit - e.debit);
    }
  }

  const { opening, source: openingSource, note: openingNote } = await resolveErpOpeningBalance(
    shopId,
    { glOpening: liquidBalances.opening, opsOpening },
  );

  let running = opening;
  const rows = [];
  let totalDebit = 0;
  let totalCredit = 0;
  for (const e of events) {
    const day = e.business_day || calendarDayFromValue(e.occurred_at);
    if (!day || day < from || day > to) continue;
    // Non-cash settlements (old gold exchange) are shown with their own
    // debit/credit value but never move the liquid running balance or the
    // headline totals — see the `push()` helper above.
    if (e.affects_liquid_balance !== false) {
      running = toMoneyNumber(running + e.credit - e.debit);
      totalDebit += e.debit;
      totalCredit += e.credit;
    }
    if (e.mode_bucket) {
      modeTotals[e.mode_bucket] = toMoneyNumber(modeTotals[e.mode_bucket] + e.credit - e.debit);
    }
    rows.push({
      id: e.id,
      occurred_at: e.occurred_at,
      business_day: day,
      recorded_at: e.recorded_at || null,
      description: e.description,
      debit: e.debit,
      credit: e.credit,
      balance: running,
      source_type: e.source_type,
      source_id: e.source_id,
      settlement_type: e.settlement_type,
      affects_liquid_balance: e.affects_liquid_balance,
      invoice_no: e.invoice_no || null,
      customer_id: e.customer_id || null,
      customer_serial: e.customer_serial ?? null,
    });
  }

  const glClosingRaw = liquidBalances.closing;
  const tillForClose = await loadTillOpeningFloat(shopId);
  const cutoverPosted = await hasAccountingCutover(shopId);
  const goLiveChain = tillForClose > 0 && !cutoverPosted && !(await hasPriorClosedDay(shopId));
  const glClosing = goLiveChain
    ? toMoneyNumber(glClosingRaw + tillForClose)
    : glClosingRaw;
  const gap = toMoneyNumber(glClosing - running);
  let glRow = null;
  if (Math.abs(gap) >= 0.01) {
    totalDebit += gap < 0 ? Math.abs(gap) : 0;
    totalCredit += gap > 0 ? gap : 0;
    glRow = {
      id: 'gl-reconcile',
      occurred_at: toEnd.toISOString(),
      business_day: to,
      description: 'GL reconciliation (ledger adjustments not in passbook)',
      debit: gap < 0 ? Math.abs(gap) : 0,
      credit: gap > 0 ? gap : 0,
      balance: glClosing,
      source_type: 'gl_reconciliation',
      source_id: null,
      settlement_type: 'liquid',
      affects_liquid_balance: true,
    };
    running = glClosing;
  }

  // Balance is computed chronologically (oldest -> newest) above, since each
  // row's running total depends on every prior one — but the passbook reads
  // newest-first (latest invoice of the latest date at the top). Keep the GL
  // plug at the bottom so it cannot sit above real bills.
  rows.reverse();
  if (glRow) rows.push(glRow);

  return {
    from,
    to,
    opening_balance: toMoneyNumber(opening),
    opening_source: openingSource,
    opening_note: openingNote,
    total_debit: toMoneyNumber(totalDebit),
    total_credit: toMoneyNumber(totalCredit),
    closing_balance: toMoneyNumber(glClosing),
    gl_liquid_closing: toMoneyNumber(glClosing),
    row_count: rows.length,
    rows,
    mode_totals: {
      cash: toMoneyNumber(modeTotals.cash),
      upi: toMoneyNumber(modeTotals.upi),
      bank: toMoneyNumber(modeTotals.bank),
      cheque: toMoneyNumber(modeTotals.cheque),
      old_gold_exchange: toMoneyNumber(modeTotals.old_gold_exchange),
      old_silver_exchange: toMoneyNumber(modeTotals.old_silver_exchange),
    },
    note: goLiveChain
      ? 'Opening/closing include locked drawer float (go-live) plus ledger Cash/Bank/UPI/Card.'
      : 'Opening/closing match GL Cash + Bank + UPI + Card (accounts dashboard basis).',
  };
}
