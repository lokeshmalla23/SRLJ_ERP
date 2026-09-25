/**
 * Shop-floor payment transfers between liquid pockets (Cash / Bank / UPI / Card).
 *
 * Posts a GL contra (Dr destination, Cr source) so Cash Book, Bank Book,
 * dashboard KPIs and day-close expected cash all move, plus a matching pair
 * of contra cashbook lines so the ERP Statement passbook lists the transfer
 * without changing combined liquid closing (the two lines net to zero).
 */
import { Op } from 'sequelize';
import { CashbookEntry } from '../models/index.js';
import { newId } from '../utils.js';
import { toMoneyNumber } from '../utils/money.js';
import { getActiveBillingDate } from './dailyClosingService.js';
import {
  accountBalances,
  cashAccountCode,
  ensureDefaultAccounts,
  postManualVoucher,
} from './ledgerService.js';
import { appendEventLog } from './eventLogService.js';
import branchConfig from '../config/branchConfig.js';
import {
  expandHiddenLinkedSourceIds,
  loadHiddenInvoiceIds,
} from '../utils/invoiceVisibility.js';

export const TRANSFER_MODES = ['cash', 'bank', 'upi', 'card'];

const MODE_LABEL = {
  cash: 'Cash',
  bank: 'Bank',
  upi: 'UPI',
  card: 'Card',
};

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function isYmd(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function normalizeTransferMode(mode) {
  const m = String(mode || '').toLowerCase().replace(/\s+/g, '_');
  if (m === 'bank_transfer' || m === 'neft' || m === 'rtgs') return 'bank';
  if (TRANSFER_MODES.includes(m)) return m;
  return null;
}

export function transferModeLabel(mode) {
  const key = normalizeTransferMode(mode);
  return (key && MODE_LABEL[key]) || String(mode || '');
}

async function hiddenExcludeSourceIds(shopId, { transaction } = {}) {
  const hidden = await loadHiddenInvoiceIds(shopId, { transaction });
  if (!hidden.size) return null;
  const expanded = await expandHiddenLinkedSourceIds(shopId, [...hidden], { transaction });
  return expanded.length ? expanded : null;
}

function pocketsFromBalanceRows(rows = []) {
  const pick = (code) => {
    const row = (rows || []).find((r) => r.code === code);
    if (!row) return 0;
    return toMoneyNumber((Number(row.debit) || 0) - (Number(row.credit) || 0));
  };
  return {
    cash: pick('1000'),
    bank: pick('1010'),
    upi: pick('1020'),
    card: pick('1030'),
  };
}

function pocketTotal(pockets) {
  return toMoneyNumber(
    (Number(pockets?.cash) || 0)
    + (Number(pockets?.bank) || 0)
    + (Number(pockets?.upi) || 0)
    + (Number(pockets?.card) || 0),
  );
}

/**
 * Liquid pocket balances for transfers. Hidden-bill journals are always
 * stripped — even if the owner has unlocked hidden figures elsewhere —
 * so Transfer payments only moves normal billing money.
 */
export async function getPaymentPockets({
  shopId, date, transaction, excludeHidden = true,
} = {}) {
  await ensureDefaultAccounts(shopId, { transaction });
  const excludeInvoiceIds = excludeHidden
    ? await hiddenExcludeSourceIds(shopId, { transaction })
    : null;
  const rows = await accountBalances({
    shopId,
    to: date,
    transaction,
    excludeInvoiceIds,
  });
  return pocketsFromBalanceRows(rows);
}

/** Hidden remainder sitting in Cash / Bank / UPI / Card (full GL − visible). */
export async function getHiddenLiquidPockets({ shopId, date, transaction } = {}) {
  const [full, visible] = await Promise.all([
    getPaymentPockets({ shopId, date, transaction, excludeHidden: false }),
    getPaymentPockets({ shopId, date, transaction, excludeHidden: true }),
  ]);
  const hidden = {
    cash: toMoneyNumber(full.cash - visible.cash),
    bank: toMoneyNumber(full.bank - visible.bank),
    upi: toMoneyNumber(full.upi - visible.upi),
    card: toMoneyNumber(full.card - visible.card),
  };
  return {
    hidden: { ...hidden, total: pocketTotal(hidden) },
    visible: { ...visible, total: pocketTotal(visible) },
    full: { ...full, total: pocketTotal(full) },
  };
}

function stripPathFromNotes(notes, fromLabel, toLabel) {
  const raw = String(notes || '').trim();
  if (!raw) return null;
  const prefix = `${fromLabel} → ${toLabel}`;
  if (raw === prefix) return null;
  if (raw.startsWith(`${prefix} · `)) return raw.slice(prefix.length + 3).trim() || null;
  return raw;
}

export async function listPaymentTransfers({ shopId, limit = 25 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const rows = await CashbookEntry.findAll({
    where: {
      shop_id: shopId,
      contra: true,
      reference: { [Op.like]: 'TRF-%' },
    },
    order: [['date', 'DESC'], ['created_at', 'DESC']],
    limit: cap * 2,
  });

  const byRef = new Map();
  for (const e of rows) {
    const ref = e.reference;
    if (!ref) continue;
    const rec = byRef.get(ref) || {
      id: ref,
      date: e.date,
      amount: toMoneyNumber(e.amount),
      from_mode: null,
      to_mode: null,
      notes: null,
      created_at: e.created_at,
    };
    if (String(e.entry_type).toLowerCase() === 'out') rec.from_mode = e.mode;
    if (String(e.entry_type).toLowerCase() === 'in') rec.to_mode = e.mode;
    rec.amount = toMoneyNumber(e.amount);
    rec.date = e.date;
    rec.created_at = e.created_at;
    rec.notes = e.notes;
    byRef.set(ref, rec);
  }

  return [...byRef.values()]
    .filter((r) => r.from_mode && r.to_mode)
    .slice(0, cap)
    .map((r) => ({
      ...r,
      from_label: transferModeLabel(r.from_mode),
      to_label: transferModeLabel(r.to_mode),
      notes: stripPathFromNotes(r.notes, transferModeLabel(r.from_mode), transferModeLabel(r.to_mode)),
    }));
}

export async function listPaymentTransfersAndPockets({ shopId, date, limit = 25 } = {}) {
  let asOf = isYmd(date) ? date : null;
  if (!asOf) {
    asOf = (await getActiveBillingDate({ shopId })).date;
  }
  const [pockets, transfers] = await Promise.all([
    getPaymentPockets({ shopId, date: asOf }),
    listPaymentTransfers({ shopId, limit }),
  ]);
  return { date: asOf, pockets, transfers };
}

export async function postPaymentTransfer({
  shopId,
  fromMode,
  toMode,
  amount,
  date: requestedDate,
  notes,
  userId,
  transaction,
}) {
  if (!transaction) throw new Error('postPaymentTransfer requires transaction');

  const from = normalizeTransferMode(fromMode);
  const to = normalizeTransferMode(toMode);
  if (!from || !to) {
    throw httpError(400, 'From and To must be Cash, Bank, UPI or Card');
  }
  if (from === to) {
    throw httpError(400, 'From and To must be different');
  }

  const amt = toMoneyNumber(amount);
  if (!(amt > 0)) {
    throw httpError(400, 'Amount must be greater than 0');
  }

  let date = isYmd(requestedDate) ? requestedDate : null;
  if (!date) {
    date = (await getActiveBillingDate({ shopId, transaction })).date;
  }

  await ensureDefaultAccounts(shopId, { transaction });

  const fromCode = cashAccountCode(from);
  const toCode = cashAccountCode(to);
  if (!fromCode || !toCode) {
    throw httpError(400, 'From and To must be Cash, Bank, UPI or Card');
  }

  const visiblePockets = await getPaymentPockets({ shopId, date, transaction, excludeHidden: true });
  const available = toMoneyNumber(visiblePockets[from] || 0);
  if (amt - available > 0.009) {
    throw httpError(
      400,
      `Not enough ${transferModeLabel(from)} on ${date}. Available ${toMoneyNumber(available).toFixed(2)}, need ${amt.toFixed(2)}.`,
    );
  }

  const fromLabel = transferModeLabel(from);
  const toLabel = transferModeLabel(to);
  const userNote = String(notes || '').trim() || null;
  const pathLabel = `${fromLabel} → ${toLabel}`;
  const storedNotes = userNote ? `${pathLabel} · ${userNote}` : pathLabel;
  const memo = userNote ? `Payment transfer ${pathLabel} — ${userNote}` : `Payment transfer ${pathLabel}`;

  const transferId = newId();
  const voucherNo = `TRF-${transferId.replace(/-/g, '').slice(0, 10).toUpperCase()}`;

  const entry = await postManualVoucher({
    shopId,
    voucherType: 'contra',
    voucherNo,
    entryDate: date,
    memo,
    requestId: voucherNo,
    userId,
    transaction,
    lines: [
      {
        accountCode: toCode,
        debit: amt,
        credit: 0,
        memo: `Transfer from ${fromLabel}`,
      },
      {
        accountCode: fromCode,
        debit: 0,
        credit: amt,
        memo: `Transfer to ${toLabel}`,
      },
    ],
  });

  const common = {
    shop_id: shopId,
    date,
    amount: amt,
    contra: true,
    reference: voucherNo,
    notes: storedNotes,
    created_by: userId || null,
    origin_device_id: branchConfig.device_id || null,
  };

  const outRow = await CashbookEntry.create({
    id: newId(),
    ...common,
    entry_type: 'out',
    mode: from,
  }, { transaction });

  const inRow = await CashbookEntry.create({
    id: newId(),
    ...common,
    entry_type: 'in',
    mode: to,
  }, { transaction });

  await appendEventLog({
    eventType: 'PAYMENT_TRANSFER',
    entityType: 'journal_entry',
    entityId: entry?.id || voucherNo,
    critical: true,
    payload: {
      voucher_no: voucherNo,
      from_mode: from,
      to_mode: to,
      amount: amt,
      date,
      notes: userNote,
      cashbook_out_id: outRow.id,
      cashbook_in_id: inRow.id,
    },
    originDeviceId: branchConfig.device_id,
    userId,
    transaction,
  });

  const pockets = await getPaymentPockets({ shopId, date, transaction });
  return {
    id: voucherNo,
    date,
    from_mode: from,
    to_mode: to,
    from_label: fromLabel,
    to_label: toLabel,
    amount: amt,
    notes: userNote,
    pockets,
    journal_id: entry?.id || null,
  };
}
