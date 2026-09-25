/**
 * Phase 1 accounting controls: GL query helpers, party ledgers, AR/AP/TB integrity.
 */
import { Op } from 'sequelize';
import {
  ChartOfAccount,
  JournalEntry,
  JournalLine,
  Invoice,
  Purchase,
  Customer,
  Vendor,
  CustomerAdvance,
  Product,
  Setting,
} from '../models/index.js';
import { getDefaultShopId } from './defaultShop.js';
import {
  accountBalances,
  accountNetBalance,
  ensureDefaultAccounts,
} from './ledgerService.js';
import { toMoneyNumber } from '../utils/money.js';
import { excludePreAccountsWhere, excludePreAccountsJournalWhere } from './financialMode.js';
import { withNotHidden } from '../utils/invoiceVisibility.js';
import { asObject } from './settingsStore.js';
import { stockCostValue } from './productCost.js';

const AR_SOURCES = new Set([
  'sale_invoice',
  'credit_payment',
  'credit_sale',
  'invoice_payment',
  'advance_application',
  'old_gold_application',
  'credit_note',
  'reverse_sale_invoice',
  'reverse_credit_payment',
  'reverse_credit_sale',
  'reverse_invoice_payment',
  'reverse_advance_application',
  'reverse_old_gold_application',
  'reverse_credit_note',
]);

const AP_SOURCES = new Set([
  'purchase',
  'purchase_payment',
  'reverse_purchase',
  'reverse_purchase_payment',
]);

async function getCutoverDate(shopId) {
  const row = await Setting.findOne({ where: { key: 'accounting_cutover_date' } });
  const raw = row?.value;
  if (!raw) return null;
  // Under SQLite, Sequelize's JSONB column can come back as the raw stored
  // JSON text (e.g. '{"date":"2026-09-12"}') rather than a parsed object —
  // a plain `typeof raw === 'string'` check would then treat that JSON text
  // itself as the date. Only a string that isn't JSON is a legacy raw date.
  if (typeof raw === 'string' && !raw.trim().startsWith('{')) {
    return raw.slice(0, 10);
  }
  const v = asObject(raw);
  if (v.date) return String(v.date).slice(0, 10);
  if (v[shopId]) return String(v[shopId]).slice(0, 10);
  return null;
}

/** General ledger lines for one account code. */
export async function generalLedger({
  shopId,
  accountCode,
  from = null,
  to = null,
  limit = 500,
  excludeSourceIds = null,
} = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();
  await ensureDefaultAccounts(resolvedShopId);
  const account = await ChartOfAccount.findOne({
    where: { shop_id: resolvedShopId, code: accountCode },
  });
  if (!account) return { account: null, lines: [], opening: 0, closing: 0 };

  const entryWhere = { shop_id: resolvedShopId, ...excludePreAccountsJournalWhere() };
  if (from || to) {
    entryWhere.entry_date = {};
    if (from) entryWhere.entry_date[Op.gte] = from;
    if (to) entryWhere.entry_date[Op.lte] = to;
  }

  const entries = await JournalEntry.findAll({
    where: entryWhere,
    order: [['entry_date', 'ASC'], ['created_at', 'ASC']],
  });
  const excludeSet = excludeSourceIds?.length ? new Set(excludeSourceIds) : null;
  const visibleEntries = excludeSet
    ? entries.filter((e) => !excludeSet.has(e.source_id))
    : entries;
  const entryIds = visibleEntries.map((e) => e.id);
  const entryMap = new Map(visibleEntries.map((e) => [e.id, e]));

  const lines = entryIds.length
    ? await JournalLine.findAll({
      where: {
        account_id: account.id,
        journal_entry_id: { [Op.in]: entryIds },
      },
      order: [['created_at', 'ASC']],
      limit,
    })
    : [];

  let running = 0;
  const rows = lines.map((l) => {
    const e = entryMap.get(l.journal_entry_id);
    const debit = (Number(l.debit_paise) || 0) / 100;
    const credit = (Number(l.credit_paise) || 0) / 100;
    if (account.type === 'liability' || account.type === 'equity' || account.type === 'income') {
      running = toMoneyNumber(running + credit - debit);
    } else {
      running = toMoneyNumber(running + debit - credit);
    }
    return {
      journal_entry_id: l.journal_entry_id,
      entry_date: e?.entry_date || null,
      source_type: e?.source_type || null,
      source_id: e?.source_id || null,
      memo: l.memo || e?.memo || null,
      debit,
      credit,
      balance: running,
    };
  });

  return {
    account: { code: account.code, name: account.name, type: account.type },
    lines: rows,
    closing: running,
  };
}

/**
 * Customer ledger from invoices + payments + AR-related journals.
 * Operational invoice trail is primary; GL AR balance is control total.
 */
export async function customerLedger({ shopId, customerId, from = null, to = null } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();
  const customer = await Customer.findByPk(customerId);
  if (!customer) return null;

  const invWhere = {
    shop_id: resolvedShopId,
    customer_id: customerId,
    cancelled_at: null,
    ...excludePreAccountsWhere(),
  };
  if (from || to) {
    invWhere.created_at = {};
    if (from) invWhere.created_at[Op.gte] = new Date(`${from}T00:00:00`);
    if (to) invWhere.created_at[Op.lte] = new Date(`${to}T23:59:59`);
  }

  const invoices = await Invoice.findAll({
    where: withNotHidden(invWhere),
    order: [['created_at', 'ASC']],
  });

  const rows = [];
  let balance = 0;
  for (const inv of invoices) {
    const taxable = toMoneyNumber(
      (Number(inv.subtotal) || 0) - (Number(inv.discount) || 0),
    );
    const gst = toMoneyNumber(inv.gst_amount);
    const gross = toMoneyNumber(taxable + gst + (Number(inv.round_off) || 0));
    balance = toMoneyNumber(balance + gross);
    rows.push({
      date: String(inv.created_at).slice(0, 10),
      particular: `Invoice ${inv.invoice_no}`,
      reference: inv.id,
      type: 'invoice',
      debit: gross,
      credit: 0,
      balance,
    });

    const payments = Array.isArray(inv.payments) ? inv.payments : [];
    for (const p of payments) {
      // Old Gold Exchange is credited once below (from old_gold_value) regardless
      // of whether it also appears in `payments` — skip it here to avoid double-crediting.
      if (String(p?.mode || '').toLowerCase() === 'old_gold_exchange') continue;
      if (String(p?.mode || '').toLowerCase() === 'old_silver_exchange') continue;
      const amt = toMoneyNumber(p.amount);
      if (!(amt > 0)) continue;
      balance = toMoneyNumber(balance - amt);
      rows.push({
        date: String(inv.created_at).slice(0, 10),
        particular: `Payment (${p.mode || 'cash'})`,
        reference: inv.id,
        type: 'payment',
        debit: 0,
        credit: amt,
        balance,
      });
    }
    const og = toMoneyNumber(inv.old_gold_value);
    if (og > 0) {
      balance = toMoneyNumber(balance - og);
      rows.push({
        date: String(inv.created_at).slice(0, 10),
        particular: 'Old gold',
        reference: inv.id,
        type: 'old_gold',
        debit: 0,
        credit: og,
        balance,
      });
    }
    const os = toMoneyNumber(inv.old_silver_value);
    if (os > 0) {
      balance = toMoneyNumber(balance - os);
      rows.push({
        date: String(inv.created_at).slice(0, 10),
        particular: 'Old silver',
        reference: inv.id,
        type: 'old_silver',
        debit: 0,
        credit: os,
        balance,
      });
    }
    const scheme = toMoneyNumber(inv.scheme_credit);
    if (scheme > 0) {
      balance = toMoneyNumber(balance - scheme);
      rows.push({
        date: String(inv.created_at).slice(0, 10),
        particular: 'Scheme credit',
        reference: inv.id,
        type: 'scheme',
        debit: 0,
        credit: scheme,
        balance,
      });
    }
  }

  const outstanding = toMoneyNumber(
    invoices.reduce((s, i) => s + (Number(i.balance_due) || 0), 0),
  );
  const glAr = await accountNetBalance(resolvedShopId, '1100');

  return {
    customer: { id: customer.id, name: customer.name, mobile: customer.mobile },
    rows,
    outstanding_ops: outstanding,
    running_balance: balance,
    gl_ar_control: glAr,
  };
}

export async function supplierLedger({ shopId, vendorId, from = null, to = null } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();
  const vendor = await Vendor.findByPk(vendorId);
  if (!vendor) return null;

  const where = { shop_id: resolvedShopId, vendor_id: vendorId, ...excludePreAccountsWhere() };
  if (from || to) {
    where.purchase_date = {};
    if (from) where.purchase_date[Op.gte] = from;
    if (to) where.purchase_date[Op.lte] = to;
  }

  const purchases = await Purchase.findAll({
    where,
    order: [['purchase_date', 'ASC'], ['created_at', 'ASC']],
  });

  const rows = [];
  let balance = 0;
  for (const p of purchases) {
    if (p.status === 'voided' || p.status === 'draft') continue;
    const total = toMoneyNumber(p.grand_total);
    balance = toMoneyNumber(balance + total);
    rows.push({
      date: p.purchase_date,
      particular: `Purchase ${p.po_number || p.id}`,
      reference: p.id,
      type: 'purchase',
      debit: 0,
      credit: total,
      balance,
    });
    const pays = Array.isArray(p.payments) ? p.payments : [];
    for (const pay of pays) {
      const amt = toMoneyNumber(pay.amount);
      if (!(amt > 0)) continue;
      balance = toMoneyNumber(balance - amt);
      rows.push({
        date: pay.date || p.purchase_date,
        particular: `Payment (${pay.mode || 'cash'})`,
        reference: p.id,
        type: 'payment',
        debit: amt,
        credit: 0,
        balance,
      });
    }
  }

  const outstanding = toMoneyNumber(
    purchases.reduce((s, p) => s + (Number(p.balance) || 0), 0),
  );
  const glAp = await accountNetBalance(resolvedShopId, '2200');

  return {
    vendor: { id: vendor.id, name: vendor.name },
    rows,
    outstanding_ops: outstanding,
    running_balance: balance,
    gl_ap_control: glAp,
  };
}

/** Trial balance + control account reconciliations. */
export async function accountingIntegrityCheck({ shopId, from = null, to = null } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();
  const cutover = await getCutoverDate(resolvedShopId);
  const balances = await accountBalances({
    shopId: resolvedShopId,
    from: cutover && !from ? cutover : from,
    to,
  });

  let totalDebit = 0;
  let totalCredit = 0;
  for (const r of balances) {
    totalDebit += r.debit;
    totalCredit += r.credit;
  }
  totalDebit = toMoneyNumber(totalDebit);
  totalCredit = toMoneyNumber(totalCredit);
  const tbDiff = toMoneyNumber(totalDebit - totalCredit);

  const glAr = await accountNetBalance(resolvedShopId, '1100', { to });
  const opsArRows = await Invoice.findAll({
    where: {
      shop_id: resolvedShopId,
      balance_due: { [Op.gt]: 0 },
      cancelled_at: null,
      ...excludePreAccountsWhere(),
    },
    attributes: ['balance_due'],
  });
  const opsAr = toMoneyNumber(opsArRows.reduce((s, i) => s + (Number(i.balance_due) || 0), 0));

  const glAp = await accountNetBalance(resolvedShopId, '2200', { to });
  const opsApRows = await Purchase.findAll({
    where: {
      shop_id: resolvedShopId,
      balance: { [Op.gt]: 0 },
      status: { [Op.notIn]: ['draft', 'voided'] },
      ...excludePreAccountsWhere(),
    },
    attributes: ['balance'],
  });
  const opsAp = toMoneyNumber(opsApRows.reduce((s, p) => s + (Number(p.balance) || 0), 0));

  const products = await Product.findAll({
    where: { shop_id: resolvedShopId },
    attributes: ['purchase_price', 'stock_qty', 'status', 'tray_total_weight', 'purchase_cost_per_gram'],
  });
  let invVal = 0;
  for (const p of products) {
    if (p.status === 'sold' || p.status === 'deleted_p' || p.status === 'deleted' || p.status === 'discontinued') continue;
    const qty = Number(p.stock_qty) || 0;
    const value = stockCostValue(p, qty);
    if (qty > 0 && value > 0) invVal += value;
  }
  invVal = toMoneyNumber(invVal);
  const glInv = await accountNetBalance(resolvedShopId, '1200', { to });

  const advances = await CustomerAdvance.findAll({
    where: { shop_id: resolvedShopId, status: 'open', ...excludePreAccountsWhere() },
    attributes: ['remaining_amount'],
  });
  const opsAdv = toMoneyNumber(
    advances.reduce((s, a) => s + (Number(a.remaining_amount) || 0), 0),
  );
  const glAdv = await accountNetBalance(resolvedShopId, '2000', { to });

  const warnings = [];
  if (Math.abs(tbDiff) > 0.02) {
    warnings.push({ code: 'TB_IMBALANCE', message: `Trial balance imbalance Dr−Cr = ${tbDiff}` });
  }
  if (Math.abs(glAr - opsAr) > 1) {
    warnings.push({
      code: 'AR_CONTROL',
      message: `AR GL ${glAr} vs invoice balance_due ${opsAr}`,
      gl: glAr,
      ops: opsAr,
    });
  }
  if (Math.abs(glAp - opsAp) > 1) {
    warnings.push({
      code: 'AP_CONTROL',
      message: `AP GL ${glAp} vs purchase balance ${opsAp}`,
      gl: glAp,
      ops: opsAp,
    });
  }
  if (Math.abs(glAdv - opsAdv) > 1) {
    warnings.push({
      code: 'ADVANCE_CONTROL',
      message: `Advances GL ${glAdv} vs remaining ${opsAdv}`,
      gl: glAdv,
      ops: opsAdv,
    });
  }

  return {
    cutover_date: cutover,
    trial_balance: {
      total_debit: totalDebit,
      total_credit: totalCredit,
      balanced: Math.abs(tbDiff) <= 0.02,
      difference: tbDiff,
      accounts: balances,
    },
    controls: {
      ar: { gl: glAr, ops: opsAr, ok: Math.abs(glAr - opsAr) <= 1 },
      ap: { gl: glAp, ops: opsAp, ok: Math.abs(glAp - opsAp) <= 1 },
      advances: { gl: glAdv, ops: opsAdv, ok: Math.abs(glAdv - opsAdv) <= 1 },
      inventory: { gl: glInv, ops_valuation: invVal, note: 'Ops valuation uses purchase_price×qty; GL may diverge pre-cutover' },
    },
    warnings,
    ok: warnings.filter((w) => w.code === 'TB_IMBALANCE').length === 0,
  };
}

export { getCutoverDate, AR_SOURCES, AP_SOURCES };
