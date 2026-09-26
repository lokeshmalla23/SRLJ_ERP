/**
 * One-time shop go-live opening balances — drawer cash + GL cutover in one place.
 */
import { JournalEntry, Setting, DailyClosing } from '../models/index.js';
import { newId } from '../utils.js';
import { toMoneyNumber } from '../utils/money.js';
import { getDefaultShopId } from './defaultShop.js';
import { FINANCIAL_MODE } from './financialMode.js';
import {
  applyAccountingCutover,
  assessHistoricalAccounting,
  buildOpeningSnapshot,
} from './accountingCutoverService.js';
import { saveTillOpeningCash, setActiveBillingDate } from './dailyClosingService.js';
import { asObject } from './settingsStore.js';
import { invoiceOccurredAt } from '../utils/invoiceRead.js';
import { broadcast } from './wsServer.js';

const TILL_KEY = 'till_opening_cash';
const CUTOVER_KEY = 'accounting_cutover_date';
const SETUP_COMPLETE_KEY = 'erp_opening_setup_complete';

export const ACCOUNTS_SETUP_STATUS = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
});

export const ACCOUNTS_SETUP_REQUIRED = 'ACCOUNTS_SETUP_REQUIRED';

const POS_SETUP_MESSAGE =
  'Accounts Setup Required. Please complete Opening Balance / Opening Trial Balance setup before creating a POS Bill.';
const ESTIMATION_SETUP_MESSAGE =
  'Accounts Setup Required. Please complete Accounts Setup before creating Estimates.';

export class AccountsSetupError extends Error {
  constructor(message, { status = 403, code = ACCOUNTS_SETUP_REQUIRED, operation = null } = {}) {
    super(message);
    this.name = 'AccountsSetupError';
    this.status = status;
    this.code = code;
    this.operation = operation;
  }
}

function parseSettingValue(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { amount: raw };
    }
  }
  return { amount: raw };
}

async function readTillOpening() {
  const row = await Setting.findOne({ where: { key: TILL_KEY } });
  if (!row?.value) return { amount: 0, locked: false };
  const v = parseSettingValue(row.value);
  const amount = toMoneyNumber(v?.amount ?? v);
  return { amount: amount > 0 ? amount : 0, locked: amount > 0 };
}

async function readCutoverDate() {
  const row = await Setting.findOne({ where: { key: CUTOVER_KEY } });
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
  return v.date ? String(v.date).slice(0, 10) : null;
}

function setupCompleteKeyForShop(shopId) {
  return shopId ? `${SETUP_COMPLETE_KEY}:${shopId}` : SETUP_COMPLETE_KEY;
}

function flagBelongsToShop(flag, shopId) {
  if (!shopId || !flag?.shop_id) return true;
  return String(flag.shop_id) === String(shopId);
}

async function readSetupCompleteFlag(shopId) {
  if (shopId) {
    const scoped = await Setting.findOne({ where: { key: setupCompleteKeyForShop(shopId) } });
    if (scoped) return parseSettingValue(scoped.value);
  }
  const row = await Setting.findOne({ where: { key: SETUP_COMPLETE_KEY } });
  const parsed = parseSettingValue(row?.value);
  if (!flagBelongsToShop(parsed, shopId)) return null;
  return parsed;
}

function isCompletedFlag(flag) {
  if (!flag || typeof flag !== 'object') return false;
  if (String(flag.status || '').toUpperCase() === ACCOUNTS_SETUP_STATUS.COMPLETED) return true;
  return Boolean(flag.completed_at);
}

async function persistSetupComplete(shopId, payload, { transaction } = {}) {
  const completedAt = new Date().toISOString();
  const inferredPriorClose = payload?.reason === 'prior_closed_day';
  const body = {
    status: ACCOUNTS_SETUP_STATUS.COMPLETED,
    completed_at: completedAt,
    shop_id: shopId,
    financial_mode: FINANCIAL_MODE.LIVE,
    ...payload,
  };
  if (!body.status) body.status = ACCOUNTS_SETUP_STATUS.COMPLETED;
  if (!body.financial_mode) body.financial_mode = FINANCIAL_MODE.LIVE;
  if (!inferredPriorClose && !body.accounts_go_live_at) {
    body.accounts_go_live_at = body.completed_at || completedAt;
  }
  const key = setupCompleteKeyForShop(shopId);
  let row = await Setting.findOne({ where: { key }, transaction });
  if (!row && shopId) {
    const legacy = await Setting.findOne({ where: { key: SETUP_COMPLETE_KEY }, transaction });
    const legacyVal = parseSettingValue(legacy?.value);
    if (legacy && flagBelongsToShop(legacyVal, shopId)) row = legacy;
  }
  if (row) {
    await row.update({ value: body, shop_id: shopId, key }, { transaction });
  } else {
    await Setting.create({
      id: newId(),
      shop_id: shopId,
      key,
      value: body,
    }, { transaction });
  }
  return body;
}

async function hasCutoverJournal(shopId) {
  const row = await JournalEntry.findOne({
    where: { shop_id: shopId, source_type: 'opening_balance' },
    // 'createdAt' — Sequelize's JS-side attribute name for the auto
    // timestamp; the physical column name 'created_at' is NOT a valid
    // `attributes` entry and silently returns undefined.
    attributes: ['id', 'entry_date', 'source_id', 'createdAt'],
  });
  return row;
}

async function hasPriorClosedDay(shopId) {
  const row = await DailyClosing.findOne({
    where: { shop_id: shopId, status: 'closed' },
    attributes: ['id'],
  });
  return Boolean(row);
}

/** Earliest closed business day — the best real-world proxy for "when this
 * shop actually went live" for shops with no cutover journal at all. */
async function earliestClosedDay(shopId) {
  return DailyClosing.findOne({
    where: { shop_id: shopId, status: 'closed' },
    attributes: ['id', 'date', 'closed_at'],
    order: [['date', 'ASC']],
  });
}

/**
 * Persist COMPLETED for shops that already initialized accounts.
 * Never invent opening balances, and never treat "amount > 0" as completion
 * (₹0 is a valid opening). Existing invoices alone are not enough — those
 * are the historical bills this gate is meant to prevent.
 */
async function maybeBackfillAccountsSetupCompleted(shopId) {
  const existing = await readSetupCompleteFlag(shopId);
  if (isCompletedFlag(existing)) return existing;

  const cutoverEntry = await hasCutoverJournal(shopId);
  const priorClose = cutoverEntry ? null : await earliestClosedDay(shopId);
  if (!cutoverEntry && !priorClose) return existing;

  // Reconstruct the REAL historical go-live moment instead of stamping "now"
  // (whenever this backfill code happens to run, e.g. after a deploy) — date
  // from the cutover/closing's own business date, time from its real
  // created_at/closed_at, exactly like every other transaction in the ERP.
  const goLiveAt = cutoverEntry
    ? invoiceOccurredAt({ business_date: cutoverEntry.entry_date, paid_at: cutoverEntry.createdAt })
    : invoiceOccurredAt({ business_date: priorClose.date, paid_at: priorClose.closed_at });

  return persistSetupComplete(shopId, {
    inferred: true,
    reason: cutoverEntry ? 'opening_balance_journal' : 'prior_closed_day',
    ...(goLiveAt ? { accounts_go_live_at: goLiveAt.toISOString() } : {}),
  });
}

function remainingSetupSteps({ cutoverPosted, completeFlag }) {
  const remaining = [];
  if (!cutoverPosted) remaining.push('Save Opening Balance / Opening Trial Balance (cutover voucher)');
  if (!isCompletedFlag(completeFlag)) remaining.push('Confirm and lock opening books');
  return remaining;
}

/** Status for Opening Setup UI and POS/Estimation gates. */
export async function getOpeningSetupStatus(shopId) {
  const resolvedShopId = shopId || await getDefaultShopId();
  await maybeBackfillAccountsSetupCompleted(resolvedShopId);

  const till = await readTillOpening();
  const cutoverEntry = await hasCutoverJournal(resolvedShopId);
  const cutoverDate = await readCutoverDate();
  const assessment = await assessHistoricalAccounting(resolvedShopId);
  const priorClose = await hasPriorClosedDay(resolvedShopId);
  const completeFlag = await readSetupCompleteFlag(resolvedShopId);

  const cutoverPosted = Boolean(cutoverEntry);
  const setupComplete = isCompletedFlag(completeFlag) || cutoverPosted;
  const accountsSetupStatus = setupComplete
    ? ACCOUNTS_SETUP_STATUS.COMPLETED
    : ACCOUNTS_SETUP_STATUS.PENDING;

  const snapshot = await buildOpeningSnapshot(resolvedShopId, {
    cash: till.amount || null,
    bank: null,
    upi: null,
    card: null,
  });

  const remaining = setupComplete ? [] : remainingSetupSteps({ cutoverPosted, completeFlag });
  const financialMode = setupComplete ? FINANCIAL_MODE.LIVE : FINANCIAL_MODE.PRE_ACCOUNTS;
  const accountsGoLiveAt = completeFlag?.accounts_go_live_at
    || (setupComplete ? (completeFlag?.completed_at || cutoverEntry?.createdAt || null) : null);

  return {
    till_opening_cash: till.amount,
    till_locked: till.locked,
    cutover_date: cutoverDate || cutoverEntry?.entry_date || null,
    cutover_posted: cutoverPosted,
    has_prior_closed_day: priorClose,
    setup_complete: setupComplete,
    accounts_setup_status: accountsSetupStatus,
    financial_mode: financialMode,
    accounts_go_live_at: accountsGoLiveAt,
    completed_at: completeFlag?.completed_at || null,
    opening_saved: completeFlag && typeof completeFlag === 'object'
      ? {
          cash: completeFlag.cash ?? till.amount ?? 0,
          bank: completeFlag.bank ?? 0,
          upi: completeFlag.upi ?? 0,
          card: completeFlag.card ?? 0,
          cutover_date: completeFlag.cutover_date || cutoverDate || null,
        }
      : null,
    remaining_steps: remaining,
    recommended_cutover_date: assessment.recommended_cutover_date,
    snapshot: snapshot.auto,
    show_setup_tab: true,
    note: setupComplete
      ? 'Accounts Setup Completed. ERP is now in Live Accounting Mode.'
      : 'Accounts Setup is not completed. Financial transactions are currently in Test Mode.',
  };
}

export async function isAccountsSetupCompleted(shopId) {
  const resolvedShopId = shopId || await getDefaultShopId();
  const flag = await maybeBackfillAccountsSetupCompleted(resolvedShopId);
  if (isCompletedFlag(flag) && flagBelongsToShop(flag, resolvedShopId)) return true;
  const cutoverEntry = await hasCutoverJournal(resolvedShopId);
  return Boolean(cutoverEntry);
}

/**
 * Historical helper. Do not use to block POS billing or estimation.
 * Pre-accounts shops create PRE_ACCOUNTS / TEST transactions instead.
 */
export async function assertAccountsSetupCompleted({
  shopId = null,
  operation = 'pos',
} = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();
  const completed = await isAccountsSetupCompleted(resolvedShopId);
  if (completed) return { shopId: resolvedShopId, status: ACCOUNTS_SETUP_STATUS.COMPLETED };

  const isEstimation = operation === 'estimation' || operation === 'quotation';
  throw new AccountsSetupError(
    isEstimation ? ESTIMATION_SETUP_MESSAGE : POS_SETUP_MESSAGE,
    { operation },
  );
}

/** Used by automated tests that call billing services without HTTP middleware. */
export async function markAccountsSetupCompleted(shopId, payload = {}, { transaction } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();
  return persistSetupComplete(resolvedShopId, payload, { transaction });
}

/**
 * Save go-live opening balances: GL cutover voucher + drawer till float (cash).
 * Marks setup complete after the opening voucher is posted.
 */
export async function applyOpeningSetup({
  shopId,
  cutoverDate,
  cash = 0,
  bank = 0,
  upi = 0,
  card = 0,
  outputGst = 0,
  inputGst = 0,
  userId = null,
} = {}) {
  if (!cutoverDate || !/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate)) {
    throw Object.assign(new Error('cutover_date YYYY-MM-DD required'), { status: 400 });
  }

  const resolvedShopId = shopId || await getDefaultShopId();
  const before = await getOpeningSetupStatus(resolvedShopId);

  if (before.setup_complete) {
    throw Object.assign(new Error('Opening setup is already complete'), { status: 409, status_snapshot: before });
  }

  let cashAmt = toMoneyNumber(cash);
  const bankAmt = toMoneyNumber(bank);
  const upiAmt = toMoneyNumber(upi);
  const cardAmt = toMoneyNumber(card);
  const outputGstAmt = toMoneyNumber(outputGst);
  const inputGstAmt = toMoneyNumber(inputGst);

  if (before.till_locked && cashAmt <= 0) {
    cashAmt = before.till_opening_cash;
  }

  const liquidTotal = toMoneyNumber(cashAmt + bankAmt + upiAmt + cardAmt);
  if (liquidTotal <= 0) {
    throw Object.assign(new Error('Enter at least one opening balance (cash, bank, UPI, or card)'), { status: 400 });
  }

  const out = { cutover: null, till: null };

  if (!before.cutover_posted) {
    out.cutover = await applyAccountingCutover({
      shopId: resolvedShopId,
      cutoverDate,
      cash: cashAmt,
      bank: bankAmt,
      upi: upiAmt,
      card: cardAmt,
      outputGst: outputGstAmt,
      inputGst: inputGstAmt,
      userId,
    });
  }

  if (!before.till_locked && cashAmt > 0) {
    out.till = await saveTillOpeningCash(cashAmt, { shopId: resolvedShopId, userId });
  }

  // Pin the active business/transaction day to the cutover date chosen here,
  // instead of whatever date it lazily defaulted to earlier (real "today" the
  // first time any pre-accounts/test activity read it). Only safe because
  // this whole function only ever runs once, before any day has been closed —
  // skip it if a day was somehow already closed first, so we never rewind
  // the business date behind existing closed history.
  if (!before.has_prior_closed_day) {
    await setActiveBillingDate({ shopId: resolvedShopId, date: cutoverDate });
  }

  await persistSetupComplete(resolvedShopId, {
    cutover_date: cutoverDate,
    cash: cashAmt,
    bank: bankAmt,
    upi: upiAmt,
    card: cardAmt,
    output_gst: outputGstAmt,
    input_gst: inputGstAmt,
    set_by: userId || null,
  });

  // Practice POS / estimations / incomes / expenses drop out of live shop-floor
  // data. Catalog products and live stock_qty are not deleted.
  try {
    const { purgePreAccountsPracticeData } = await import('./purgePreAccountsPracticeData.js');
    out.practice_purge = await purgePreAccountsPracticeData(resolvedShopId);
  } catch (err) {
    out.practice_purge = { error: err?.message || String(err) };
  }

  const after = await getOpeningSetupStatus(resolvedShopId);
  try {
    broadcast({
      type: 'accounts:opening_setup_complete',
      setup_complete: Boolean(after.setup_complete),
      financial_mode: after.financial_mode,
      accounts_setup_status: after.accounts_setup_status,
    });
  } catch { /* ws not available */ }
  return { ...out, status: after };
}

/**
 * Close Day turned OFF (auto_day_close) — small shops skip Opening Setup:
 * go live with zero opening balances from today, pinned the same way
 * applyOpeningSetup does. No-op once setup is already complete.
 */
export async function goLiveForAutoDayClose({ shopId, today, userId = null } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId();
  // Cheap check first — this runs on every auto-close tick.
  if (await isAccountsSetupCompleted(resolvedShopId)) return { skipped: true };
  const before = await getOpeningSetupStatus(resolvedShopId);
  if (before.setup_complete) return { skipped: true, status: before };

  if (!before.has_prior_closed_day) {
    await setActiveBillingDate({ shopId: resolvedShopId, date: today });
  }
  await persistSetupComplete(resolvedShopId, {
    cutover_date: today,
    cash: 0,
    bank: 0,
    upi: 0,
    card: 0,
    reason: 'auto_day_close',
    set_by: userId || null,
  });

  const out = { skipped: false };
  // Same as applyOpeningSetup — practice (test-mode) bills drop out once live.
  try {
    const { purgePreAccountsPracticeData } = await import('./purgePreAccountsPracticeData.js');
    out.practice_purge = await purgePreAccountsPracticeData(resolvedShopId);
  } catch (err) {
    out.practice_purge = { error: err?.message || String(err) };
  }

  const after = await getOpeningSetupStatus(resolvedShopId);
  try {
    broadcast({
      type: 'accounts:opening_setup_complete',
      setup_complete: Boolean(after.setup_complete),
      financial_mode: after.financial_mode,
      accounts_setup_status: after.accounts_setup_status,
    });
  } catch { /* ws not available */ }
  return { ...out, status: after };
}
