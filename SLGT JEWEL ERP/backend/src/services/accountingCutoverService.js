/**
 * Historical reconstructability assessment + opening-balance cutover.
 */
import { Op } from 'sequelize';
import sequelize from '../db.js';
import {
  Invoice,
  Purchase,
  Expense,
  Payment,
  CustomerAdvance,
  OldGoldReceipt,
  CreditNote,
  JournalEntry,
  Product,
  Setting,
} from '../models/index.js';
import { newId } from '../utils.js';
import { toMoneyNumber } from '../utils/money.js';
import { getDefaultShopId } from './defaultShop.js';
import { asObject } from './settingsStore.js';
import { postOpeningBalanceVoucher, ensureDefaultAccounts } from './ledgerService.js';
import { excludePreAccountsWhere } from './financialMode.js';
import { stockCostValue } from './productCost.js';

function classify(label, status, reason, count = 0) {
  return { event: label, status, reason, count };
}

/** Read-only assessment of whether historical ops can rebuild full-accrual journals. */
export async function assessHistoricalAccounting(shopId) {
  const resolvedShopId = shopId || await getDefaultShopId();

  const [
    invoiceCount,
    paymentCount,
    purchaseCount,
    expenseCount,
    advanceCount,
    ogCount,
    cnCount,
    journalCount,
  ] = await Promise.all([
    Invoice.count({ where: { shop_id: resolvedShopId } }),
    Payment.count({ where: { shop_id: resolvedShopId } }),
    Purchase.count({ where: { shop_id: resolvedShopId } }),
    Expense.count({ where: { shop_id: resolvedShopId } }),
    CustomerAdvance.count({ where: { shop_id: resolvedShopId } }),
    OldGoldReceipt.count({ where: { shop_id: resolvedShopId } }),
    CreditNote.count({ where: { shop_id: resolvedShopId } }),
    JournalEntry.count({ where: { shop_id: resolvedShopId } }),
  ]);

  const invoicesWithBalance = await Invoice.count({
    where: { shop_id: resolvedShopId, balance_due: { [Op.gt]: 0 }, cancelled_at: null },
  });
  const invoicesMissingGstSplit = await Invoice.count({
    where: {
      shop_id: resolvedShopId,
      gst_amount: { [Op.gt]: 0 },
      [Op.or]: [{ cgst_amount: null }, { cgst_amount: 0 }],
    },
  });

  const classes = [
    classify(
      'cash_sale',
      'partial',
      'Totals + CGST/SGST usually present; payment dates weak pre-Payment table; no IGST',
      invoiceCount,
    ),
    classify(
      'credit_sale',
      invoicesWithBalance > 0 ? 'partial' : 'partial',
      'balance_due may be 0 for legacy unpaid invoices (column defaulted without backfill)',
      invoicesWithBalance,
    ),
    classify(
      'partial_collections',
      paymentCount > 0 ? 'partial' : 'not_safe',
      'Payment.paid_at only after payments table; JSON payments often lack dates',
      paymentCount,
    ),
    classify(
      'advances',
      advanceCount > 0 ? 'partial' : 'not_safe',
      'Reconstructable after advances tables; pre-table only mode=advance on invoice',
      advanceCount,
    ),
    classify(
      'purchases',
      'partial',
      'subtotal/gst_amount/grand_total present; no CGST/SGST split; payments JSON has dates',
      purchaseCount,
    ),
    classify(
      'expenses',
      'fully_simple',
      'amount+mode+date enough for Dr Expense Cr Cash — never journalled historically',
      expenseCount,
    ),
    classify(
      'returns',
      'partial',
      'Credit note totals exist; refund mode / AR interaction weak',
      cnCount,
    ),
    classify(
      'old_gold',
      'partial',
      'Often invoice value only; standalone cash buys previously unjournalled',
      ogCount,
    ),
    classify(
      'full_accrual_pnl_history',
      'not_safe',
      'Prior journals cash-shaped; GST never on 2100; no COGS; expenses off-books — do not replay',
      journalCount,
    ),
  ];

  const recommendedCutover = new Date().toISOString().slice(0, 10);

  return {
    shop_id: resolvedShopId,
    recommended_cutover_date: recommendedCutover,
    strategy: 'cutover_opening_balances',
    strategy_reason:
      'End-to-end full-accrual history is not safely reconstructable. Use opening balances at cutover D and post accrual journals forward only.',
    counts: {
      invoices: invoiceCount,
      payments: paymentCount,
      purchases: purchaseCount,
      expenses: expenseCount,
      advances: advanceCount,
      old_gold_receipts: ogCount,
      credit_notes: cnCount,
      existing_journals: journalCount,
      invoices_with_balance_due: invoicesWithBalance,
      invoices_gst_without_cgst: invoicesMissingGstSplit,
    },
    classification: classes,
  };
}

/** Snapshot operational opening figures for cutover voucher (no inventing cash). */
export async function buildOpeningSnapshot(shopId, {
  cash = null,
  bank = null,
  upi = null,
  card = null,
  outputGst = null,
  inputGst = null,
} = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();

  const arRows = await Invoice.findAll({
    where: {
      shop_id: resolvedShopId,
      balance_due: { [Op.gt]: 0 },
      cancelled_at: null,
      ...excludePreAccountsWhere(),
    },
    attributes: ['balance_due'],
  });
  const ar = toMoneyNumber(arRows.reduce((s, i) => s + (Number(i.balance_due) || 0), 0));

  const apRows = await Purchase.findAll({
    where: {
      shop_id: resolvedShopId,
      balance: { [Op.gt]: 0 },
      status: { [Op.notIn]: ['draft', 'voided'] },
      ...excludePreAccountsWhere(),
    },
    attributes: ['balance'],
  });
  const ap = toMoneyNumber(apRows.reduce((s, p) => s + (Number(p.balance) || 0), 0));

  const advRows = await CustomerAdvance.findAll({
    where: { shop_id: resolvedShopId, status: 'open', ...excludePreAccountsWhere() },
    attributes: ['remaining_amount'],
  });
  const advances = toMoneyNumber(
    advRows.reduce((s, a) => s + (Number(a.remaining_amount) || 0), 0),
  );

  const ogRows = await OldGoldReceipt.findAll({
    where: {
      shop_id: resolvedShopId,
      status: { [Op.in]: ['in_stock', 'posted', 'available'] },
      invoice_id: null,
    },
    attributes: ['value'],
  });
  const oldGold = toMoneyNumber(ogRows.reduce((s, r) => s + (Number(r.value) || 0), 0));

  const products = await Product.findAll({
    where: { shop_id: resolvedShopId },
    attributes: ['purchase_price', 'stock_qty', 'status', 'tray_total_weight', 'purchase_cost_per_gram'],
  });
  let inventory = 0;
  for (const p of products) {
    if (p.status === 'sold' || p.status === 'deleted_p' || p.status === 'deleted' || p.status === 'discontinued') continue;
    const qty = Number(p.stock_qty) || 0;
    const value = stockCostValue(p, qty);
    if (qty > 0 && value > 0) inventory += value;
  }
  inventory = toMoneyNumber(inventory);

  return {
    shop_id: resolvedShopId,
    auto: {
      accounts_receivable: ar,
      supplier_payable: ap,
      customer_advances: advances,
      old_gold_stock: oldGold,
      inventory,
    },
    manual_required: {
      cash,
      bank,
      upi,
      card,
      output_gst: outputGst,
      input_gst: inputGst,
      note: 'Cash/Bank/UPI/Card and GST balances cannot be proven from ops tables — enter physical counts / GST return snapshot',
    },
  };
}

/**
 * Post opening balance voucher and persist cutover date.
 * Does not rewrite historical journals.
 */
export async function applyAccountingCutover({
  shopId,
  cutoverDate,
  cash = 0,
  bank = 0,
  upi = 0,
  card = 0,
  outputGst = 0,
  inputGst = 0,
  userId = null,
  requestId = null,
} = {}) {
  if (!cutoverDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate)) {
    throw Object.assign(new Error('cutoverDate YYYY-MM-DD required'), { status: 400 });
  }

  return sequelize.transaction(async (transaction) => {
    const resolvedShopId = shopId || await getDefaultShopId({ transaction });
    await ensureDefaultAccounts(resolvedShopId, { transaction });

    const existing = await JournalEntry.findOne({
      where: {
        shop_id: resolvedShopId,
        source_type: 'opening_balance',
        source_id: `opening:${cutoverDate}`,
      },
      transaction,
    });
    if (existing) {
      return { idempotent: true, entry: existing, cutover_date: cutoverDate };
    }

    const snap = await buildOpeningSnapshot(resolvedShopId, {
      cash, bank, upi, card, outputGst, inputGst,
    });

    const lines = [];
    const pushDr = (code, amt, memo) => {
      const a = toMoneyNumber(amt);
      if (a > 0) lines.push({ accountCode: code, debit: a, credit: 0, memo });
    };
    const pushCr = (code, amt, memo) => {
      const a = toMoneyNumber(amt);
      if (a > 0) lines.push({ accountCode: code, debit: 0, credit: a, memo });
    };

    pushDr('1000', cash, 'Opening cash count');
    pushDr('1010', bank, 'Opening bank count');
    pushDr('1020', upi, 'Opening UPI count');
    pushDr('1030', card, 'Opening card count');
    pushDr('1100', snap.auto.accounts_receivable, 'Opening AR');
    pushDr('1200', snap.auto.inventory, 'Opening inventory');
    pushDr('1300', snap.auto.old_gold_stock, 'Opening old gold');
    pushDr('1400', inputGst, 'Opening input GST');

    pushCr('2000', snap.auto.customer_advances, 'Opening advances');
    pushCr('2100', outputGst, 'Opening output GST');
    pushCr('2200', snap.auto.supplier_payable, 'Opening AP');

    const entry = await postOpeningBalanceVoucher({
      shopId: resolvedShopId,
      entryDate: cutoverDate,
      lines,
      requestId: requestId || `opening:${resolvedShopId}:${cutoverDate}`,
      userId,
      transaction,
      memo: `Accounting cutover opening balances ${cutoverDate}`,
    });

    const settingKey = 'accounting_cutover_date';
    const [setting] = await Setting.findOrCreate({
      where: { key: settingKey },
      defaults: { id: newId(), value: { date: cutoverDate, shop_id: resolvedShopId } },
      transaction,
    });
    await setting.update({
      value: {
        ...asObject(setting.value),
        date: cutoverDate,
        shop_id: resolvedShopId,
        applied_at: new Date().toISOString(),
      },
    }, { transaction });

    return {
      idempotent: false,
      entry,
      cutover_date: cutoverDate,
      snapshot: snap,
    };
  });
}
