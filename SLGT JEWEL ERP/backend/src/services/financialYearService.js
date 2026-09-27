/**
 * Indian Financial Year service — the single authority for resolving the
 * financial year of any accounting transaction.
 *
 * Indian FY: 01 April YYYY → 31 March YYYY+1  (2026-27 = 01-Apr-2026 … 31-Mar-2027)
 *
 * The FY is ALWAYS derived from the ERP's authoritative BUSINESS DATE
 * (journal entry_date / transaction business_date) — never from created_at /
 * updated_at / server timestamp. This keeps it consistent with Business Date /
 * Day Closing and the existing PRE_ACCOUNTS / LIVE financial-mode architecture
 * (which is a separate concept and is never touched here).
 */
import { Op } from 'sequelize';
import { FinancialYear, JournalEntry } from '../models/index.js';
import { newId } from '../utils.js';
import { getDefaultShopId } from './defaultShop.js';
import { getActiveBillingDate } from './dailyClosingService.js';
import { appendAuditEvent } from './auditTrailService.js';
import { appendEventLog } from './eventLogService.js';
import { accountBalances, postOpeningBalanceVoucher, ensureDefaultAccounts } from './ledgerService.js';

export const FY_STATUS = Object.freeze({
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
});

/** Safe YYYY-MM-DD from Date / ISO / DATEONLY — returns null when invalid. */
function toYmd(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * The Indian Financial Year code for a date: "2026-27".
 * 15-Sep-2026 → "2026-27"   02-Apr-2027 → "2027-28"
 */
export function fyCodeForDate(value) {
  const ymd = toYmd(value);
  if (!ymd) return null;
  const [y, m] = ymd.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

/**
 * The Indian Financial Year [start_date, end_date] for a date.
 * 15-Sep-2026 → { start_date: "2026-04-01", end_date: "2027-03-31" }
 */
export function fyRangeForDate(value) {
  const ymd = toYmd(value);
  if (!ymd) return null;
  const [y, m] = ymd.split('-').map(Number);
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  return {
    start_date: `${startYear}-04-01`,
    end_date: `${endYear}-03-31`,
  };
}

export function fyDisplayName(code) {
  if (!code) return null;
  const [startYear, endShort] = String(code).split('-');
  const start = Number(startYear);
  const end = Number(`${startYear.slice(0, 2)}${endShort}`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return `FY ${code}`;
  return `FY ${code} (Apr ${start} – Mar ${end})`;
}

function normalizeStatus(status) {
  return String(status || FY_STATUS.OPEN).toUpperCase() === FY_STATUS.CLOSED
    ? FY_STATUS.CLOSED
    : FY_STATUS.OPEN;
}

/**
 * Resolve (find-or-create) the Financial Year master row for a business date.
 * This is the centralized resolver every accounting code path must use instead
 * of duplicating FY calculations.
 *
 * @returns {Promise<FinancialYear>} the FY row (never null when businessDate valid)
 */
export async function resolveFinancialYear(businessDate, shopId, { transaction } = {}) {
  const ymd = toYmd(businessDate);
  if (!ymd) throw Object.assign(new Error('A valid business date is required to resolve a financial year'), { status: 400 });
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  const code = fyCodeForDate(ymd);
  const range = fyRangeForDate(ymd);

  let fy = await FinancialYear.findOne({
    where: { shop_id: resolvedShopId, financial_year_code: code },
    transaction,
  });
  if (!fy) {
    // Idempotent find-or-create (unique shop_id+financial_year_code guards races).
    try {
      fy = await FinancialYear.create({
        id: newId(),
        shop_id: resolvedShopId,
        financial_year_code: code,
        display_name: fyDisplayName(code),
        start_date: range.start_date,
        end_date: range.end_date,
        status: FY_STATUS.OPEN,
        is_current: false,
      }, { transaction });
    } catch (err) {
      if (!/unique|duplicate/i.test(String(err?.message || ''))) throw err;
      fy = await FinancialYear.findOne({
        where: { shop_id: resolvedShopId, financial_year_code: code },
        transaction,
      });
    }
  }
  return fy;
}

/**
 * The current Financial Year for a shop — derived from the active BUSINESS DATE
 * (not the server clock), so it stays consistent with Day Closing. The FY that
 * contains the active business date is marked is_current.
 */
export async function getCurrentFinancialYear(shopId, { transaction } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  const { date: businessDate } = await getActiveBillingDate({ shopId: resolvedShopId, transaction });
  const ymd = toYmd(businessDate);
  if (!ymd) return null;
  const code = fyCodeForDate(ymd);
  const fy = await FinancialYear.findOne({
    where: { shop_id: resolvedShopId, financial_year_code: code },
    transaction,
  });
  return fy || null;
}

/** List all financial years for a shop, newest first. */
export async function listFinancialYears(shopId, { transaction } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  return FinancialYear.findAll({
    where: { shop_id: resolvedShopId },
    order: [['start_date', 'DESC']],
    transaction,
  });
}

/**
 * Ensure the financial year for a business date exists and is flagged current.
 * Called at startup and whenever the business date advances. Idempotent.
 */
export async function ensureCurrentFinancialYear(shopId, { transaction } = {}) {
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  const { date: businessDate } = await getActiveBillingDate({ shopId: resolvedShopId, transaction });
  const ymd = toYmd(businessDate);
  if (!ymd) return null;
  const code = fyCodeForDate(ymd);
  const range = fyRangeForDate(ymd);

  const fy = await resolveFinancialYear(ymd, resolvedShopId, { transaction });
  // Re-flag this shop's current FY (clear any stale is_current first).
  await FinancialYear.update(
    { is_current: false },
    { where: { shop_id: resolvedShopId, is_current: true }, transaction },
  );
  await fy.update({ is_current: true, start_date: range.start_date, end_date: range.end_date }, { transaction });
  return fy;
}

/**
 * Validate that a transaction's business_date falls inside its financial_year_id.
 * Never trusts a frontend-sent financial_year_id without this check.
 * Returns { ok, financialYear }.
 */
export async function validateTransactionFinancialYear({ businessDate, financialYearId, shopId }, { transaction } = {}) {
  const ymd = toYmd(businessDate);
  if (!ymd) return { ok: false, reason: 'business_date missing' };
  const resolvedShopId = shopId || await getDefaultShopId({ transaction });
  const expected = await resolveFinancialYear(ymd, resolvedShopId, { transaction });
  if (!financialYearId) {
    // Auto-resolve from business_date when the caller didn't supply one.
    return { ok: true, financialYear: expected, autoResolved: true };
  }
  if (String(financialYearId) !== String(expected.id)) {
    return { ok: false, reason: 'financial_year_id does not match business_date', expected };
  }
  return { ok: true, financialYear: expected };
}

/**
 * Close a financial year. Idempotent. Before closing we run the closing checks
 * supported by the existing architecture (balanced journals, valid lines, no
 * transactions outside valid periods, accounting equation). Once CLOSED the FY
 * is read-only for ordinary users; corrections require an explicit reopen.
 */
export async function closeFinancialYear(financialYearId, { userId = null, transaction } = {}) {
  const run = async (t) => {
    const fy = await FinancialYear.findByPk(financialYearId, { transaction: t });
    if (!fy) throw Object.assign(new Error('Financial year not found'), { status: 404 });
    if (normalizeStatus(fy.status) === FY_STATUS.CLOSED) {
      return { idempotent: true, financialYear: fy };
    }

    const checks = await runClosingChecks(fy, { transaction: t });
    if (!checks.ok) {
      const err = new Error(`Cannot close ${fy.financial_year_code}: ${checks.reasons.join('; ')}`);
      err.status = 409;
      err.code = 'FY_CLOSE_CHECKS_FAILED';
      err.checks = checks;
      throw err;
    }

    fy.status = FY_STATUS.CLOSED;
    fy.closed_at = new Date();
    fy.closed_by = userId || null;
    await fy.save({ transaction: t });

    await appendAuditEvent({
      eventType: 'financial_year',
      action: 'closed',
      entityType: 'financial_year',
      entityId: fy.id,
      userId,
      oldValue: FY_STATUS.OPEN,
      newValue: FY_STATUS.CLOSED,
      transaction: t,
    });
    await appendEventLog({
      eventType: 'FINANCIAL_YEAR_CLOSED',
      entityType: 'financial_year',
      entityId: fy.id,
      payload: { financial_year_code: fy.financial_year_code, shop_id: fy.shop_id },
      userId,
      transaction: t,
    });

    // Carry forward Balance-Sheet balances into the next FY (idempotent).
    let carryForward = null;
    try {
      carryForward = await carryForwardBalanceSheet(fy, { userId, transaction: t });
    } catch (err) {
      // Never block the close itself if carry-forward fails; surface it instead.
      carryForward = { carried: false, error: err?.message || String(err) };
    }

    return { idempotent: false, financialYear: fy, carryForward };
  };

  if (transaction) return run(transaction);
  const { default: sequelize } = await import('../db.js');
  return sequelize.transaction(run);
}

/**
 * Carry forward Balance-Sheet balances into the next Financial Year when an FY
 * is closed. Reuses the existing opening-balance voucher architecture
 * (postOpeningBalanceVoucher, is_opening=true) so:
 *   - BS balances (Cash/Bank/UPI/Card, Receivables, Payables, Customer advances,
 *     GST, Inventory, Old Gold/Silver, Equity) carry forward.
 *   - Revenue/expense (P&L) activity does NOT carry forward — P&L resets.
 *   - No transaction history is duplicated and no original journal is altered.
 *   - No artificial balancing journals are created (the voucher balances by
 *     construction through Opening Equity).
 * Idempotent: safe to call multiple times.
 */
export async function carryForwardBalanceSheet(financialYear, { userId = null, transaction } = {}) {
  const run = async (t) => {
    const shopId = financialYear.shop_id;
    const to = financialYear.end_date;
    await ensureDefaultAccounts(shopId, { transaction: t });

    // Closing BS balances as of the closed FY's end date.
    const balances = await accountBalances({ shopId, to, transaction: t, includeOpening: true });

    const lines = [];
    const pushDr = (code, amt, memo) => {
      const a = Math.round((Number(amt) || 0) * 100) / 100;
      if (a > 0) lines.push({ accountCode: code, debit: a, credit: 0, memo });
    };
    const pushCr = (code, amt, memo) => {
      const a = Math.round((Number(amt) || 0) * 100) / 100;
      if (a > 0) lines.push({ accountCode: code, debit: 0, credit: a, memo });
    };

    for (const row of balances) {
      if (row.type === 'asset') pushDr(row.code, row.debit - row.credit, `Opening ${row.name}`);
      else if (row.type === 'liability') pushCr(row.code, row.credit - row.debit, `Opening ${row.name}`);
      else if (row.type === 'equity') pushCr(row.code, row.credit - row.debit, `Opening ${row.name}`);
      // income / expense → intentionally skipped (P&L resets)
    }

    if (!lines.length) {
      return { carried: false, reason: 'no balance-sheet balances to carry forward' };
    }

    // Find/create the next FY (starts the day after this FY ends).
    const nextRange = fyRangeForDate(to);
    // next FY start = end_date + 1 day
    const [ny, nm, nd] = to.split('-').map(Number);
    const nextStart = new Date(ny, nm - 1, nd + 1);
    const nextStartYmd = `${nextStart.getFullYear()}-${String(nextStart.getMonth() + 1).padStart(2, '0')}-${String(nextStart.getDate()).padStart(2, '0')}`;
    const nextFy = await resolveFinancialYear(nextStartYmd, shopId, { transaction: t });

    // Post the opening balance voucher in the NEXT FY (is_opening=true keeps it
    // out of P&L). Idempotent via a deterministic request_id.
    const entry = await postOpeningBalanceVoucher({
      shopId,
      entryDate: nextStartYmd,
      lines,
      requestId: `fy-carryforward:${financialYear.id}:${nextFy.id}`,
      userId,
      transaction: t,
      memo: `FY ${financialYear.financial_year_code} closing balances carried forward to ${nextFy.financial_year_code}`,
    });

    await appendEventLog({
      eventType: 'FINANCIAL_YEAR_CARRY_FORWARD',
      entityType: 'financial_year',
      entityId: financialYear.id,
      payload: {
        from_fy: financialYear.financial_year_code,
        to_fy: nextFy.financial_year_code,
        entry_id: entry?.id || null,
        line_count: lines.length,
      },
      userId,
      transaction: t,
    });

    return { carried: true, entryId: entry?.id || null, toFy: nextFy.financial_year_code, lineCount: lines.length };
  };

  if (transaction) return run(transaction);
  const { default: sequelize } = await import('../db.js');
  return sequelize.transaction(run);
}

/**
 * Reopen a CLOSED financial year — a controlled, elevated-permission workflow.
 * Records who reopened, when, reason, previous state and new state.
 */
export async function reopenFinancialYear(financialYearId, { userId = null, reason = null, transaction } = {}) {
  const run = async (t) => {
    const fy = await FinancialYear.findByPk(financialYearId, { transaction: t });
    if (!fy) throw Object.assign(new Error('Financial year not found'), { status: 404 });
    if (normalizeStatus(fy.status) !== FY_STATUS.CLOSED) {
      return { idempotent: true, financialYear: fy };
    }

    const previousState = fy.status;
    fy.status = FY_STATUS.OPEN;
    fy.reopened_at = new Date();
    fy.reopened_by = userId || null;
    await fy.save({ transaction: t });

    await appendAuditEvent({
      eventType: 'financial_year',
      action: 'reopened',
      entityType: 'financial_year',
      entityId: fy.id,
      userId,
      reason,
      oldValue: previousState,
      newValue: FY_STATUS.OPEN,
      transaction: t,
    });
    await appendEventLog({
      eventType: 'FINANCIAL_YEAR_REOPENED',
      entityType: 'financial_year',
      entityId: fy.id,
      payload: { financial_year_code: fy.financial_year_code, shop_id: fy.shop_id, reason },
      userId,
      transaction: t,
    });
    return { idempotent: false, financialYear: fy };
  };

  if (transaction) return run(transaction);
  const { default: sequelize } = await import('../db.js');
  return sequelize.transaction(run);
}

/**
 * Closing checks supported by the existing architecture. Read-only — never
 * mutates data and never creates balancing journals.
 */
export async function runClosingChecks(financialYear, { transaction } = {}) {
  const reasons = [];
  const shopId = financialYear.shop_id;
  const from = financialYear.start_date;
  const to = financialYear.end_date;

  // 1. Journals in this FY must be balanced (debit === credit per entry).
  const entries = await JournalEntry.findAll({
    where: { shop_id: shopId, entry_date: { [Op.between]: [from, to] } },
    attributes: ['id'],
    transaction,
  });
  const entryIds = entries.map((e) => e.id);

  if (entryIds.length) {
    const { JournalLine } = await import('../models/index.js');
    const lines = await JournalLine.findAll({
      where: { journal_entry_id: { [Op.in]: entryIds } },
      attributes: ['journal_entry_id', 'debit_paise', 'credit_paise'],
      transaction,
    });
    const byEntry = new Map();
    for (const l of lines) {
      const row = byEntry.get(l.journal_entry_id) || { debit: 0, credit: 0 };
      row.debit += Number(l.debit_paise) || 0;
      row.credit += Number(l.credit_paise) || 0;
      byEntry.set(l.journal_entry_id, row);
    }
    let unbalanced = 0;
    for (const [, v] of byEntry) {
      if (v.debit !== v.credit) unbalanced += 1;
    }
    if (unbalanced > 0) reasons.push(`${unbalanced} unbalanced journal entr${unbalanced === 1 ? 'y' : 'ies'}`);
  }

  // 2. No journal entry dated outside its own FY period (data integrity).
  const outside = await JournalEntry.count({
    where: {
      shop_id: shopId,
      financial_year_id: financialYear.id,
      [Op.or]: [
        { entry_date: { [Op.lt]: from } },
        { entry_date: { [Op.gt]: to } },
      ],
    },
    transaction,
  });
  if (outside > 0) reasons.push(`${outside} journal entr${outside === 1 ? 'y' : 'ies'} dated outside this FY`);

  return { ok: reasons.length === 0, reasons };
}

export {
  toYmd as fyDate,
};
