/**
 * Full-accrual double-entry posting for jewellery CRM.
 * Every post* requires a transaction; failures must propagate to caller.
 */
import {
  ChartOfAccount,
  JournalEntry,
  JournalLine,
} from '../models/index.js';
import { newId } from '../utils.js';
import { toPaise } from '../utils/money.js';
import { getDefaultShopId } from './defaultShop.js';
import { FINANCIAL_MODE, resolveFinancialMode } from './financialMode.js';

export const SYSTEM_ACCOUNTS = [
  { code: '1000', name: 'Cash', type: 'asset' },
  { code: '1010', name: 'Bank', type: 'asset' },
  { code: '1020', name: 'UPI', type: 'asset' },
  { code: '1030', name: 'Card', type: 'asset' },
  { code: '1100', name: 'Accounts Receivable', type: 'asset' },
  { code: '1200', name: 'Inventory', type: 'asset' },
  { code: '1300', name: 'Old Gold Stock', type: 'asset' },
  { code: '1310', name: 'Old Silver Stock', type: 'asset' },
  { code: '1400', name: 'Input GST', type: 'asset' },
  { code: '2000', name: 'Customer Advances', type: 'liability' },
  { code: '2100', name: 'Output GST Payable', type: 'liability' },
  { code: '2200', name: 'Supplier Payable', type: 'liability' },
  { code: '2300', name: 'Scheme Liability', type: 'liability' },
  { code: '3000', name: 'Opening Equity', type: 'equity' },
  { code: '3100', name: 'Suspense', type: 'equity' },
  { code: '4000', name: 'Sales', type: 'income' },
  { code: '4100', name: 'Sales Returns', type: 'income' },
  { code: '4200', name: 'Other Income', type: 'income' },
  { code: '4210', name: 'Gain on Old Gold Sale', type: 'income' },
  { code: '4220', name: 'Gain on Old Silver Sale', type: 'income' },
  { code: '5000', name: 'COGS', type: 'expense' },
  { code: '5100', name: 'Expenses', type: 'expense' },
  { code: '5210', name: 'Loss on Old Gold Sale', type: 'expense' },
  { code: '5220', name: 'Loss on Old Silver Sale', type: 'expense' },
];

export async function ensureDefaultAccounts(shopId, { transaction } = {}) {
  if (!shopId) throw new Error('ensureDefaultAccounts requires shopId');
  const systemCodes = SYSTEM_ACCOUNTS.map((a) => a.code);
  let rows = await ChartOfAccount.findAll({
    where: { shop_id: shopId, code: systemCodes },
    transaction,
  });
  const existingCodes = new Set(rows.map((row) => row.code));
  const missing = SYSTEM_ACCOUNTS.filter((account) => !existingCodes.has(account.code));
  if (missing.length) {
    await ChartOfAccount.bulkCreate(
      missing.map((account) => ({
        id: newId(),
        shop_id: shopId,
        ...account,
        is_system: true,
      })),
      { transaction, ignoreDuplicates: true },
    );
    rows = await ChartOfAccount.findAll({
      where: { shop_id: shopId, code: systemCodes },
      transaction,
    });
  }

  const out = {};
  const definitionByCode = new Map(SYSTEM_ACCOUNTS.map((account) => [account.code, account]));
  for (const row of rows) {
    const definition = definitionByCode.get(row.code);
    if (!definition) continue;
    if (row.is_system && (row.name !== definition.name || row.type !== definition.type)) {
      await row.update({ name: definition.name, type: definition.type }, { transaction });
    }
    out[row.code] = row;
  }
  return out;
}

/** Map payment mode → CoA cash/bank code. Advance returns null (liability path). */
export function cashAccountCode(mode) {
  const m = String(mode || 'cash').toLowerCase();
  if (m === 'cash') return '1000';
  if (m === 'upi') return '1020';
  if (m === 'card') return '1030';
  if (m === 'bank' || m === 'bank_transfer' || m === 'cheque' || m === 'neft' || m === 'rtgs') return '1010';
  if (m === 'advance' || m === 'old_gold_exchange' || m === 'old_silver_exchange' || m === 'scheme') return null;
  // legacy / unknown electronic → Bank
  if (m === 'bank / upi') return '1010';
  return '1010';
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function toEntryDate(entryDate) {
  if (!entryDate) return todayDate();
  if (entryDate instanceof Date) return entryDate.toISOString().slice(0, 10);
  return String(entryDate).slice(0, 10);
}

async function findByRequestId(requestId, transaction) {
  if (requestId) {
    return JournalEntry.findOne({ where: { request_id: requestId }, transaction });
  }
  return null;
}

/** Test-only: next postBalanced call throws (for atomicity tests). */
let _forceNextJournalFail = false;
export function __testForceNextJournalFail() {
  _forceNextJournalFail = true;
}

/**
 * Aggregate payment amounts by cash account code (paise).
 * Skips advance / null modes.
 */
function tenderDebitsByAccount(payments = []) {
  const byCode = new Map();
  for (const p of payments || []) {
    const mode = String(p.mode || 'cash').toLowerCase();
    if (mode === 'advance') continue;
    const code = cashAccountCode(mode);
    if (!code) continue;
    const paise = toPaise(p.amount);
    if (!(paise > 0)) continue;
    byCode.set(code, (byCode.get(code) || 0) + paise);
  }
  return byCode;
}

async function postBalanced({
  shopId,
  memo,
  sourceType,
  sourceId,
  requestId,
  userId,
  lines,
  transaction,
  entryDate = null,
  isOpening = false,
  voucherType = 'auto',
  voucherNo = null,
  financialMode = null,
}) {
  if (!transaction) throw new Error('Journal posting requires a transaction');
  if (_forceNextJournalFail) {
    _forceNextJournalFail = false;
    throw new Error('INJECTED_JOURNAL_FAIL');
  }
  const existing = await findByRequestId(requestId, transaction);
  if (existing) return existing;

  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  const accounts = await ensureDefaultAccounts(resolvedShopId, { transaction });

  let debit = 0;
  let credit = 0;
  for (const l of lines) {
    debit += Number(l.debitPaise) || 0;
    credit += Number(l.creditPaise) || 0;
  }
  if (debit !== credit) {
    throw new Error(`Unbalanced journal ${sourceType}:${sourceId} Dr ${debit} Cr ${credit}`);
  }
  if (debit <= 0) return null;

  for (const l of lines) {
    if (!accounts[l.accountCode]) {
      throw new Error(`Unknown account code ${l.accountCode} in ${sourceType}`);
    }
  }

  const mode = isOpening
    ? FINANCIAL_MODE.LIVE
    : (financialMode || await resolveFinancialMode(resolvedShopId, { transaction }));

  const entry = await JournalEntry.create({
    id: newId(),
    shop_id: resolvedShopId,
    entry_date: toEntryDate(entryDate),
    memo,
    source_type: sourceType,
    source_id: sourceId,
    request_id: requestId || null,
    created_by: userId || null,
    is_opening: Boolean(isOpening),
    voucher_type: voucherType,
    voucher_no: voucherNo || null,
    financial_mode: mode,
  }, { transaction });

  await JournalLine.bulkCreate(
    lines.map((l) => ({
      id: newId(),
      shop_id: resolvedShopId,
      journal_entry_id: entry.id,
      account_id: accounts[l.accountCode].id,
      debit_paise: Number(l.debitPaise) || 0,
      credit_paise: Number(l.creditPaise) || 0,
      memo: l.memo || null,
    })),
    { transaction },
  );

  return entry;
}

/**
 * Reverse an existing journal entry with opposite lines (append-only).
 */
export async function reverseJournalEntry(entry, {
  requestId = null,
  userId = null,
  transaction,
  memoPrefix = 'Reverse',
  entryDate = null,
} = {}) {
  if (!transaction) throw new Error('reverseJournalEntry requires transaction');
  if (!entry) return null;
  const existing = await findByRequestId(requestId, transaction);
  if (existing) return existing;

  const lines = await JournalLine.findAll({
    where: { journal_entry_id: entry.id },
    transaction,
  });
  if (!lines.length) return null;

  const accounts = await ChartOfAccount.findAll({
    where: { shop_id: entry.shop_id },
    transaction,
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const reverseLines = lines.map((l) => {
    const acct = byId.get(l.account_id);
    if (!acct) throw new Error(`Missing account for journal line ${l.id}`);
    return {
      accountCode: acct.code,
      debitPaise: Number(l.credit_paise) || 0,
      creditPaise: Number(l.debit_paise) || 0,
      memo: l.memo || null,
    };
  });

  return postBalanced({
    shopId: entry.shop_id,
    memo: `${memoPrefix}: ${entry.memo || entry.source_type || entry.id}`,
    sourceType: `reverse_${entry.source_type || 'journal'}`,
    sourceId: entry.source_id || entry.id,
    requestId,
    userId,
    transaction,
    entryDate: entryDate || entry.entry_date,
    lines: reverseLines,
    financialMode: entry.financial_mode || null,
  });
}

/**
 * Reverse all journals for a source (e.g. invoice cancel). Skips already-reversed.
 */
export async function reverseJournalsForSource({
  shopId,
  sourceId,
  sourceTypes = null,
  requestIdPrefix,
  userId = null,
  transaction,
  entryDate = null,
}) {
  const { Op } = await import('sequelize');
  const where = {
    shop_id: shopId,
    source_id: sourceId,
  };
  if (sourceTypes?.length) {
    where.source_type = { [Op.in]: sourceTypes };
  }
  const entries = await JournalEntry.findAll({
    where,
    order: [['created_at', 'ASC']],
    transaction,
  });

  const out = [];
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    if (String(e.source_type || '').startsWith('reverse_')) continue;
    const rev = await reverseJournalEntry(e, {
      requestId: requestIdPrefix ? `${requestIdPrefix}:${e.id}` : `rev:${e.id}`,
      userId,
      transaction,
      entryDate,
    });
    if (rev) out.push(rev);
  }
  return out;
}

/**
 * Accrual sales invoice recognition + settlements in one balanced journal.
 *
 * Dr Cash/Bank/UPI/Card (tenders) + Dr AR (balance) + Dr Advances + Dr OG + Dr Scheme
 * Cr Sales (taxable) + Cr Output GST + round-off adjust
 */
export async function postSaleInvoiceJournal({
  shopId,
  invoiceId,
  taxableAmount,
  gstAmount,
  roundOff = 0,
  payments = [],
  advanceApplied = 0,
  oldGoldValue = 0,
  oldSilverValue = 0,
  schemeCredit = 0,
  balanceDue = 0,
  entryDate = null,
  requestId = null,
  userId = null,
  transaction,
}) {
  const salesPaise = toPaise(taxableAmount);
  const gstPaise = toPaise(gstAmount);
  const roundPaise = toPaise(roundOff);
  const advPaise = toPaise(advanceApplied);
  const ogPaise = toPaise(oldGoldValue);
  const osPaise = toPaise(oldSilverValue);
  const schemePaise = toPaise(schemeCredit);
  const arPaise = toPaise(balanceDue);

  const lines = [];
  const tenders = tenderDebitsByAccount(payments);
  for (const [code, paise] of tenders) {
    lines.push({
      accountCode: code,
      debitPaise: paise,
      creditPaise: 0,
      memo: 'Tender',
    });
  }
  if (advPaise > 0) {
    lines.push({
      accountCode: '2000',
      debitPaise: advPaise,
      creditPaise: 0,
      memo: 'Advance applied',
    });
  }
  if (ogPaise > 0) {
    lines.push({
      accountCode: '1300',
      debitPaise: ogPaise,
      creditPaise: 0,
      memo: 'Old gold received',
    });
  }
  if (osPaise > 0) {
    lines.push({
      accountCode: '1310',
      debitPaise: osPaise,
      creditPaise: 0,
      memo: 'Old silver received',
    });
  }
  if (schemePaise > 0) {
    lines.push({
      accountCode: '2300',
      debitPaise: schemePaise,
      creditPaise: 0,
      memo: 'Scheme credit',
    });
  }
  if (arPaise > 0) {
    lines.push({
      accountCode: '1100',
      debitPaise: arPaise,
      creditPaise: 0,
      memo: 'Accounts receivable',
    });
  }

  let salesCredit = salesPaise;
  if (roundPaise > 0) salesCredit += roundPaise;
  if (roundPaise < 0) {
    lines.push({
      accountCode: '4000',
      debitPaise: Math.abs(roundPaise),
      creditPaise: 0,
      memo: 'Round off',
    });
  }
  if (salesCredit > 0) {
    lines.push({
      accountCode: '4000',
      debitPaise: 0,
      creditPaise: salesCredit,
      memo: 'Sales',
    });
  }
  if (gstPaise > 0) {
    lines.push({
      accountCode: '2100',
      debitPaise: 0,
      creditPaise: gstPaise,
      memo: 'Output GST',
    });
  }

  // Paise reconcile: payments may settle within ₹0.50 tolerance while
  // round_off still posts the full rounded obligation — plug up to that
  // tolerance into Sales so the journal always balances.
  let dr = 0;
  let cr = 0;
  for (const l of lines) {
    dr += Number(l.debitPaise) || 0;
    cr += Number(l.creditPaise) || 0;
  }
  const diff = dr - cr;
  const maxPlugPaise = toPaise(0.5); // matches PAYMENT_TOLERANCE in billingCalc
  if (diff !== 0 && Math.abs(diff) <= maxPlugPaise) {
    const salesLine = lines.find((l) => l.accountCode === '4000' && (l.creditPaise > 0 || l.memo === 'Sales'));
    if (diff > 0) {
      // Extra debit (e.g. overpay within tolerance) → bump Sales credit
      if (salesLine) salesLine.creditPaise += diff;
      else lines.push({ accountCode: '4000', debitPaise: 0, creditPaise: diff, memo: 'Paise adjust' });
    } else if (salesLine && salesLine.creditPaise >= Math.abs(diff)) {
      // Short debit (underpay within tolerance / round-off) → reduce Sales credit
      salesLine.creditPaise += diff; // diff is negative
    } else {
      lines.push({
        accountCode: '4000',
        debitPaise: Math.abs(diff),
        creditPaise: 0,
        memo: 'Paise adjust',
      });
    }
  }

  return postBalanced({
    shopId,
    memo: `Sale invoice ${invoiceId}`,
    sourceType: 'sale_invoice',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines,
  });
}

/** Dr COGS / Cr Inventory for known purchase costs. */
export async function postCogsJournal({
  shopId,
  invoiceId,
  cogsAmount,
  entryDate = null,
  requestId = null,
  userId = null,
  transaction,
  sourceType = 'sale_cogs',
}) {
  const amtPaise = toPaise(cogsAmount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `COGS ${invoiceId}`,
    sourceType,
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '5000', debitPaise: amtPaise, creditPaise: 0, memo: 'COGS' },
      { accountCode: '1200', debitPaise: 0, creditPaise: amtPaise, memo: 'Inventory' },
    ],
  });
}

/** Reverse COGS when stock returned (Dr Inventory / Cr COGS). */
export async function postCogsReverseJournal({
  shopId,
  sourceId,
  cogsAmount,
  entryDate = null,
  requestId = null,
  userId = null,
  transaction,
  sourceType = 'sale_cogs_return',
}) {
  const amtPaise = toPaise(cogsAmount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `COGS reverse ${sourceId}`,
    sourceType,
    sourceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '1200', debitPaise: amtPaise, creditPaise: 0, memo: 'Inventory restore' },
      { accountCode: '5000', debitPaise: 0, creditPaise: amtPaise, memo: 'COGS reverse' },
    ],
  });
}

/**
 * @deprecated Prefer postSaleInvoiceJournal — kept for legacy callers / tests.
 * Now clears AR (accrual settlement), not Sales.
 */
export async function postInvoicePaymentJournal({
  shopId, invoiceId, amount, mode, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  const cashCode = cashAccountCode(mode);
  if (!cashCode) return null;
  return postBalanced({
    shopId,
    memo: `Invoice payment ${invoiceId}`,
    sourceType: 'invoice_payment',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: cashCode, debitPaise: amtPaise, creditPaise: 0, memo: mode },
      { accountCode: '1100', debitPaise: 0, creditPaise: amtPaise, memo: 'AR cleared' },
    ],
  });
}

/** Advance applied against AR (not Sales). */
export async function postAdvanceApplicationJournal({
  shopId, invoiceId, amount, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Advance applied to invoice ${invoiceId}`,
    sourceType: 'advance_application',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '2000', debitPaise: amtPaise, creditPaise: 0, memo: 'Advance applied' },
      { accountCode: '1100', debitPaise: 0, creditPaise: amtPaise, memo: 'AR cleared' },
    ],
  });
}

export async function postAdvanceReceivedJournal({
  shopId, advanceId, amount, mode, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Advance received ${advanceId}`,
    sourceType: 'customer_advance',
    sourceId: advanceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: cashAccountCode(mode) || '1000', debitPaise: amtPaise, creditPaise: 0 },
      { accountCode: '2000', debitPaise: 0, creditPaise: amtPaise },
    ],
  });
}

export async function postAdvanceRefundJournal({
  shopId, advanceId, amount, mode, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Advance refund ${advanceId}`,
    sourceType: 'customer_advance_refund',
    sourceId: advanceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '2000', debitPaise: amtPaise, creditPaise: 0 },
      { accountCode: cashAccountCode(mode) || '1000', debitPaise: 0, creditPaise: amtPaise },
    ],
  });
}

/**
 * Old gold on invoice is part of sale_invoice; standalone cash buy:
 * Dr Old Gold Stock / Cr Cash|Bank
 */
export async function postOldGoldPurchaseJournal({
  shopId, receiptId, amount, mode = 'cash', requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Old gold buy ${receiptId}`,
    sourceType: 'old_gold_purchase',
    sourceId: receiptId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '1300', debitPaise: amtPaise, creditPaise: 0, memo: 'Old gold stock' },
      { accountCode: cashAccountCode(mode) || '1000', debitPaise: 0, creditPaise: amtPaise, memo: 'Cash buy' },
    ],
  });
}

/** @deprecated Use sale_invoice settlement; kept for compatibility. */
export async function postOldGoldApplicationJournal({
  shopId, invoiceId, amount, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Old gold applied to invoice ${invoiceId}`,
    sourceType: 'old_gold_application',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '1300', debitPaise: amtPaise, creditPaise: 0, memo: 'Old gold stock' },
      { accountCode: '1100', debitPaise: 0, creditPaise: amtPaise, memo: 'AR / settlement' },
    ],
  });
}

/**
 * Disposal of Old Gold Stock to a wholesaler/refiner:
 * Dr Cash/Bank (net realized) [+ Dr Expenses (refining charges)]
 * Cr Old Gold Stock (book value) [+ Cr/Dr Gain/Loss on Old Gold Sale]
 *
 * Gain/loss is always measured against book value alone (saleValue - bookValue) —
 * refining charges are a separate operating expense and never affect it. The
 * three lines always balance by construction: Dr(net + charges [+ loss]) ==
 * Cr(bookValue [+ gain]) since net + charges == saleValue == bookValue + gain.
 */
export async function postOldGoldSaleJournal({
  shopId, saleId, bookValue, saleValue, refiningCharges = 0, mode = 'cash',
  requestId = null, userId = null, transaction, entryDate = null,
  metal = 'gold',
}) {
  const isSilver = String(metal || '').toLowerCase() === 'silver';
  const stockCode = isSilver ? '1310' : '1300';
  const gainCode = isSilver ? '4220' : '4210';
  const lossCode = isSilver ? '5220' : '5210';
  const stockLabel = isSilver ? 'Old silver stock disposed' : 'Old gold stock disposed';
  const proceedsLabel = isSilver ? 'Old silver sale proceeds' : 'Old gold sale proceeds';
  const gainLabel = isSilver ? 'Gain on old silver sale' : 'Gain on old gold sale';
  const lossLabel = isSilver ? 'Loss on old silver sale' : 'Loss on old gold sale';
  const memo = isSilver ? `Old silver sale ${saleId}` : `Old gold sale ${saleId}`;
  const sourceType = isSilver ? 'old_silver_sale' : 'old_gold_sale';

  const bookPaise = toPaise(bookValue);
  const salePaise = toPaise(saleValue);
  const chargesPaise = toPaise(refiningCharges);
  const netPaise = salePaise - chargesPaise;
  const gainPaise = salePaise - bookPaise;

  const lines = [];
  if (netPaise > 0) {
    lines.push({ accountCode: cashAccountCode(mode) || '1000', debitPaise: netPaise, creditPaise: 0, memo: proceedsLabel });
  }
  if (chargesPaise > 0) {
    lines.push({ accountCode: '5100', debitPaise: chargesPaise, creditPaise: 0, memo: 'Refining/melting charges' });
  }
  if (bookPaise > 0) {
    lines.push({ accountCode: stockCode, debitPaise: 0, creditPaise: bookPaise, memo: stockLabel });
  }
  if (gainPaise > 0) {
    lines.push({ accountCode: gainCode, debitPaise: 0, creditPaise: gainPaise, memo: gainLabel });
  } else if (gainPaise < 0) {
    lines.push({ accountCode: lossCode, debitPaise: Math.abs(gainPaise), creditPaise: 0, memo: lossLabel });
  }

  return postBalanced({
    shopId,
    memo,
    sourceType,
    sourceId: saleId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines,
  });
}

/**
 * Purchase accrual: Dr Inventory (taxable) + Dr Input GST / Cr AP (or cash if paid).
 */
export async function postPurchaseJournal({
  shopId,
  purchaseId,
  inventoryAmount,
  gstAmount = 0,
  paidAmount = 0,
  paymentMode = 'cash',
  amount = null, // legacy: grand_total when inventoryAmount omitted
  requestId = null,
  userId = null,
  transaction,
  entryDate = null,
}) {
  let inv = inventoryAmount;
  let gst = gstAmount;
  if (inv == null && amount != null) {
    // Legacy single-amount call: treat as pre-ITC gross into inventory+AP
    inv = amount;
    gst = 0;
  }
  const invPaise = toPaise(inv || 0);
  const gstPaise = toPaise(gst || 0);
  const paidPaise = toPaise(paidAmount || 0);
  const apPaise = invPaise + gstPaise - paidPaise;
  if (invPaise + gstPaise <= 0) return null;

  const lines = [];
  if (invPaise > 0) {
    lines.push({ accountCode: '1200', debitPaise: invPaise, creditPaise: 0, memo: 'Inventory' });
  }
  if (gstPaise > 0) {
    lines.push({ accountCode: '1400', debitPaise: gstPaise, creditPaise: 0, memo: 'Input GST' });
  }
  if (paidPaise > 0) {
    const code = cashAccountCode(paymentMode) || '1000';
    lines.push({ accountCode: code, debitPaise: 0, creditPaise: paidPaise, memo: 'Paid at purchase' });
  }
  if (apPaise > 0) {
    lines.push({ accountCode: '2200', debitPaise: 0, creditPaise: apPaise, memo: 'Supplier payable' });
  } else if (apPaise < 0) {
    // Over-paid at create — rare; plug to cash debit
    lines.push({
      accountCode: cashAccountCode(paymentMode) || '1000',
      debitPaise: Math.abs(apPaise),
      creditPaise: 0,
      memo: 'Overpay adjust',
    });
  }

  return postBalanced({
    shopId,
    memo: `Purchase ${purchaseId}`,
    sourceType: 'purchase',
    sourceId: purchaseId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines,
  });
}

export async function postPurchasePaymentJournal({
  shopId, purchaseId, amount, mode = 'cash', requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Purchase payment ${purchaseId}`,
    sourceType: 'purchase_payment',
    sourceId: purchaseId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '2200', debitPaise: amtPaise, creditPaise: 0, memo: 'AP cleared' },
      { accountCode: cashAccountCode(mode) || '1000', debitPaise: 0, creditPaise: amtPaise, memo: mode },
    ],
  });
}

/**
 * Credit note / return: Dr Sales Returns + Dr Output GST / Cr Cash|AR|Bank
 */
export async function postCreditNoteJournal({
  shopId,
  creditNoteId,
  taxableAmount = null,
  gstAmount = 0,
  amount = null, // legacy grand
  mode = 'cash',
  settleToAr = false,
  requestId = null,
  userId = null,
  transaction,
  entryDate = null,
}) {
  let taxable = taxableAmount;
  let gst = gstAmount;
  if (taxable == null && amount != null) {
    taxable = amount;
    gst = 0;
  }
  const taxPaise = toPaise(taxable || 0);
  const gstPaise = toPaise(gst || 0);
  const totalPaise = taxPaise + gstPaise;
  if (!(totalPaise > 0)) return null;

  const creditCode = settleToAr ? '1100' : (cashAccountCode(mode) || '1000');
  const lines = [
    { accountCode: '4100', debitPaise: taxPaise || totalPaise, creditPaise: 0, memo: 'Sales returns' },
  ];
  if (gstPaise > 0) {
    lines.push({ accountCode: '2100', debitPaise: gstPaise, creditPaise: 0, memo: 'Output GST reverse' });
  }
  lines.push({
    accountCode: creditCode,
    debitPaise: 0,
    creditPaise: totalPaise,
    memo: settleToAr ? 'AR credit' : 'Refund',
  });

  return postBalanced({
    shopId,
    memo: `Credit note ${creditNoteId}`,
    sourceType: 'credit_note',
    sourceId: creditNoteId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines,
  });
}

/** @deprecated Prefer reverseJournalsForSource on cancel. */
export async function postInvoiceCancelJournal({
  shopId, invoiceId, amount, mode = 'cash', requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  const cashCode = cashAccountCode(mode) || '1000';
  return postBalanced({
    shopId,
    memo: `Invoice cancel ${invoiceId}`,
    sourceType: 'invoice_cancel',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '4000', debitPaise: amtPaise, creditPaise: 0, memo: 'Sales reverse' },
      { accountCode: cashCode, debitPaise: 0, creditPaise: amtPaise, memo: 'Refund' },
    ],
  });
}

export async function postExpenseJournal({
  shopId, expenseId, amount, mode = 'cash', requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Expense ${expenseId}`,
    sourceType: 'expense',
    sourceId: expenseId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '5100', debitPaise: amtPaise, creditPaise: 0 },
      { accountCode: cashAccountCode(mode) || '1000', debitPaise: 0, creditPaise: amtPaise },
    ],
  });
}

/** Mirror of postExpenseJournal for the credit side — Dr the cash/bank/UPI/card
 * account that received the money, Cr Other Income (4200). */
export async function postIncomeJournal({
  shopId, incomeId, amount, mode = 'cash', memo = null, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: memo || `Income ${incomeId}`,
    sourceType: 'income',
    sourceId: incomeId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: cashAccountCode(mode) || '1000', debitPaise: amtPaise, creditPaise: 0 },
      { accountCode: '4200', debitPaise: 0, creditPaise: amtPaise },
    ],
  });
}

/** @deprecated Covered by sale_invoice AR line. */
export async function postCreditSaleJournal({
  shopId, invoiceId, amount, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Credit sale ${invoiceId}`,
    sourceType: 'credit_sale',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '1100', debitPaise: amtPaise, creditPaise: 0, memo: 'Accounts Receivable' },
      { accountCode: '4000', debitPaise: 0, creditPaise: amtPaise, memo: 'Sales' },
    ],
  });
}

export async function postCreditPaymentJournal({
  shopId, invoiceId, amount, mode, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  const cashCode = cashAccountCode(mode) || '1000';
  return postBalanced({
    shopId,
    memo: `Credit payment collected ${invoiceId}`,
    sourceType: 'credit_payment',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: cashCode, debitPaise: amtPaise, creditPaise: 0, memo: mode },
      { accountCode: '1100', debitPaise: 0, creditPaise: amtPaise, memo: 'AR cleared' },
    ],
  });
}

/** Restore advance liability on cancel when sale reverse is not used. */
export async function postAdvanceRestoreJournal({
  shopId, invoiceId, amount, requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Advance restore on cancel ${invoiceId}`,
    sourceType: 'advance_restore',
    sourceId: invoiceId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: '1100', debitPaise: amtPaise, creditPaise: 0, memo: 'AR' },
      { accountCode: '2000', debitPaise: 0, creditPaise: amtPaise, memo: 'Advance restored' },
    ],
  });
}

/** Scheme installment: Dr Cash/Bank / Cr Scheme Liability 2300 */
export async function postSchemePaymentJournal({
  shopId, schemeId, paymentId, amount, mode = 'cash', requestId = null, userId = null, transaction, entryDate = null,
}) {
  const amtPaise = toPaise(amount);
  if (!(amtPaise > 0)) return null;
  return postBalanced({
    shopId,
    memo: `Scheme payment ${schemeId}`,
    sourceType: 'scheme_payment',
    sourceId: paymentId || schemeId,
    requestId,
    userId,
    transaction,
    entryDate,
    lines: [
      { accountCode: cashAccountCode(mode) || '1000', debitPaise: amtPaise, creditPaise: 0, memo: mode },
      { accountCode: '2300', debitPaise: 0, creditPaise: amtPaise, memo: 'Scheme liability' },
    ],
  });
}

/**
 * Resolve unit COGS for a sold line without inventing arbitrary costs.
 * Priority: tray per-gram cost × weight sold → product.purchase_price → line.purchase_price/cost
 * → metal content at line rate×purity (tagged as estimate).
 */
export function resolveUnitCogs(product, line = {}) {
  const qty = parseFloat(line.quantity) || 1;
  const trayWeight = Number(line.tray_weight_sold) || 0;
  const perGram = Number(product?.purchase_cost_per_gram) || 0;
  if (trayWeight > 0 && perGram > 0) {
    const total = Math.round(perGram * trayWeight * 100) / 100;
    return { unit: total / qty, total, source: 'purchase_cost_per_gram' };
  }
  const explicit = Number(product?.purchase_price ?? line.purchase_price ?? line.cost_price);
  if (Number.isFinite(explicit) && explicit > 0) {
    return { unit: explicit, total: explicit * qty, source: 'purchase_price' };
  }
  const net = Number(line.net_weight ?? product?.net_weight) || 0;
  // The line's own charged rate — already resolved for that line's actual
  // metal (gold/silver/platinum) by calcLineAmounts. Never `line.gold_rate`:
  // that's the invoice-level 24K gold rate, stamped on every line regardless
  // of metal, and would otherwise price a silver/platinum line's estimated
  // cost at the day's gold rate (~100x too high for silver).
  const rate = Number(line.rate ?? line.charged_rate) || 0;
  const metalText = String(line.metal || line.metal_name || product?.metal_name || '').toLowerCase();
  const isSilver = /silver/.test(metalText);
  let purity = Number(line.purity_factor);
  if (!(purity > 0)) {
    const p = String(line.purity || product?.purity || '');
    if (/24|999/.test(p)) purity = 1;
    else if (/925|sterling/.test(p)) purity = 925 / 999;
    else if (/22|916/.test(p)) purity = 0.9167;
    else if (/18|750/.test(p)) purity = 0.75;
    else if (/14|585/.test(p)) purity = 0.5833;
    else purity = isSilver ? 925 / 999 : 0.9167;
  }
  if (net > 0 && rate > 0) {
    const unit = Math.round(net * rate * purity * 100) / 100;
    if (unit > 0) {
      return { unit, total: unit * qty, source: 'metal_estimate' };
    }
  }
  return { unit: 0, total: 0, source: 'none' };
}

/**
 * Opening balance voucher — plug residual to Opening Equity / Suspense.
 * lines: [{ accountCode, debit, credit, memo }] in rupees.
 */
export async function postOpeningBalanceVoucher({
  shopId,
  entryDate,
  lines = [],
  requestId = null,
  userId = null,
  transaction,
  memo = 'Opening balances (accounting cutover)',
}) {
  if (!transaction) throw new Error('postOpeningBalanceVoucher requires transaction');
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  await ensureDefaultAccounts(resolvedShopId, { transaction });

  const mapped = lines.map((l) => ({
    accountCode: String(l.accountCode || l.account_code || ''),
    debitPaise: toPaise(l.debit || l.debit_amount || 0),
    creditPaise: toPaise(l.credit || l.credit_amount || 0),
    memo: l.memo || null,
  })).filter((l) => (l.debitPaise || l.creditPaise) > 0);

  let dr = 0;
  let cr = 0;
  for (const l of mapped) {
    dr += l.debitPaise;
    cr += l.creditPaise;
  }
  const diff = dr - cr;
  if (diff > 0) {
    mapped.push({
      accountCode: '3000',
      debitPaise: 0,
      creditPaise: diff,
      memo: 'Opening equity plug',
    });
  } else if (diff < 0) {
    mapped.push({
      accountCode: '3000',
      debitPaise: Math.abs(diff),
      creditPaise: 0,
      memo: 'Opening equity plug',
    });
  }

  return postBalanced({
    shopId: resolvedShopId,
    memo,
    sourceType: 'opening_balance',
    sourceId: `opening:${toEntryDate(entryDate)}`,
    requestId: requestId || `opening:${resolvedShopId}:${toEntryDate(entryDate)}`,
    userId,
    transaction,
    entryDate,
    isOpening: true,
    voucherType: 'journal',
    voucherNo: `OB-${toEntryDate(entryDate)}`,
    lines: mapped,
  });
}

export async function postManualVoucher({
  shopId,
  voucherType = 'journal',
  voucherNo = null,
  entryDate = null,
  memo = null,
  lines = [],
  requestId = null,
  userId = null,
  transaction,
}) {
  if (!transaction) throw new Error('postManualVoucher requires transaction');
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  const accounts = await ensureDefaultAccounts(resolvedShopId, { transaction });

  const mapped = lines.map((l) => {
    const code = String(l.accountCode || l.account_code || '');
    if (!accounts[code]) throw Object.assign(new Error(`Unknown account ${code}`), { status: 400 });
    return {
      accountCode: code,
      debitPaise: toPaise(l.debit || l.debit_amount || 0),
      creditPaise: toPaise(l.credit || l.credit_amount || 0),
      memo: l.memo || null,
    };
  });

  const entry = await postBalanced({
    shopId: resolvedShopId,
    memo: memo || `${voucherType} voucher`,
    sourceType: `voucher_${voucherType}`,
    sourceId: voucherNo || requestId || newId(),
    requestId,
    userId,
    transaction,
    entryDate,
    voucherType,
    lines: mapped,
  });

  if (entry && voucherNo) {
    await entry.update({
      voucher_type: voucherType,
      voucher_no: voucherNo,
    }, { transaction });
  }
  return entry;
}

/** Aggregate journal lines for financial statements. */
export async function accountBalances({
  shopId, from, to, transaction, includeOpening = true, excludePreCutover = false, cutoverDate = null,
  excludeInvoiceIds = null,
} = {}) {
  const { Op } = await import('sequelize');
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  await ensureDefaultAccounts(resolvedShopId, { transaction });

  const entryWhere = { shop_id: resolvedShopId };
  if (from || to || (excludePreCutover && cutoverDate)) {
    entryWhere.entry_date = {};
    const effectiveFrom = excludePreCutover && cutoverDate
      ? (from && from > cutoverDate ? from : cutoverDate)
      : from;
    if (effectiveFrom) entryWhere.entry_date[Op.gte] = effectiveFrom;
    if (to) entryWhere.entry_date[Op.lte] = to;
  }

  const entries = await JournalEntry.findAll({
    where: entryWhere,
    attributes: ['id', 'is_opening', 'source_id', 'financial_mode', 'source_type'],
    transaction,
  });
  const excludeSet = excludeInvoiceIds && excludeInvoiceIds.length ? new Set(excludeInvoiceIds) : null;
  const entryIds = entries
    .filter((e) => includeOpening || !e.is_opening)
    .filter((e) => !excludeSet || !excludeSet.has(e.source_id))
    .filter((e) => e.is_opening || e.source_type === 'opening_balance'
      || String(e.financial_mode || '').toUpperCase() !== FINANCIAL_MODE.PRE_ACCOUNTS)
    .map((e) => e.id);

  const accounts = await ChartOfAccount.findAll({
    where: { shop_id: resolvedShopId },
    order: [['code', 'ASC']],
    transaction,
  });

  const lines = entryIds.length
    ? await JournalLine.findAll({
      where: { journal_entry_id: { [Op.in]: entryIds } },
      transaction,
    })
    : [];

  const byAccount = new Map();
  for (const a of accounts) {
    byAccount.set(a.id, {
      account_id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: 0,
      credit: 0,
    });
  }
  for (const l of lines) {
    const row = byAccount.get(l.account_id);
    if (!row) continue;
    row.debit += (Number(l.debit_paise) || 0) / 100;
    row.credit += (Number(l.credit_paise) || 0) / 100;
  }

  return [...byAccount.values()].map((r) => ({
    ...r,
    debit: Math.round(r.debit * 100) / 100,
    credit: Math.round(r.credit * 100) / 100,
    balance: Math.round((r.debit - r.credit) * 100) / 100,
  }));
}

/** Sum paise balance for one account code (debit − credit for assets; use carefully). */
export async function accountNetBalance(shopId, accountCode, { transaction, to = null, excludeInvoiceIds = null } = {}) {
  const rows = await accountBalances({ shopId, to, transaction, excludeInvoiceIds });
  const row = rows.find((r) => r.code === accountCode);
  if (!row) return 0;
  if (row.type === 'liability' || row.type === 'equity' || row.type === 'income') {
    return Math.round((row.credit - row.debit) * 100) / 100;
  }
  return Math.round((row.debit - row.credit) * 100) / 100;
}
