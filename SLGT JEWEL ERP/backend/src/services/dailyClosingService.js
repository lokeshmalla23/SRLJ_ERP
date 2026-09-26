/**
 * Daily cash closing (EOD) for local-first jewellery CRM.
 * Aggregates day's sales/payments/expenses/metals/schemes and
 * persists draft/closed records with sync + event-log replication.
 */
import { Op } from 'sequelize';
import sequelize from '../db.js';
import {
  DailyClosing,
  Expense,
  Income,
  Invoice,
  Payment,
  DraftSale,
  Notification,
  Scheme,
  CreditNote,
  OldGoldReceipt,
  OldGoldSale,
  CustomerAdvance,
  CustomerAdvanceApplication,
  Purchase,
  Product,
  Employee,
  GoldRateHistory,
  Setting,
  CatalogItem,
  CashbookEntry,
} from '../models/index.js';
import { toMoneyNumber } from '../utils/money.js';
import { isHiddenBill, loadHiddenInvoiceIds } from '../utils/invoiceVisibility.js';
import { formatINR } from '../utils/formatMoney.js';
import { newId } from '../utils.js';
import { getDefaultShopId } from './defaultShop.js';
import { appendEventLog, recordOperation } from './eventLogService.js';
import { appendAuditEvent } from './auditTrailService.js';
import branchConfig from '../config/branchConfig.js';
import { classifyMetalLine, round3 } from './metalClassify.js';
import { hydrateInvoiceItems, invoiceItemsOf, invoicePaymentsOf, shopScope } from '../utils/invoiceRead.js';
import { getOpeningSetupStatus } from './openingSetupService.js';
import { isPreAccountsRecord } from './financialMode.js';
import { normalizeReceiptMetal } from '../utils/oldMetal.js';
import { getAutoDayCloseMode } from './autoDayCloseMode.js';

const CANCELLED = new Set(['cancelled', 'canceled', 'void', 'voided', 'returned']);
const UNPAID = new Set(['pending', 'partial']);

const CLOSING_CHECKLIST_KEYS = [
  'cash_verified',
  'upi_verified',
  'bank_verified',
  'cheque_verified',
  'expenses_entered',
  'income_entered',
  'stock_checked',
  'rates_checked',
];

function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function checklistComplete(checklist) {
  const c = checklist && typeof checklist === 'object' ? checklist : {};
  return CLOSING_CHECKLIST_KEYS.every((k) => !!c[k]);
}

function dayBounds(dateStr) {
  const dayStart = new Date(`${dateStr}T00:00:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999`);
  return { dayStart, dayEnd };
}

function localDateStr(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function parsePayments(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Setting.value is JSONB, which Sequelize auto-parses on Postgres but returns
// as a raw JSON string on SQLite (desktop) — always normalize before reading.
function parseSettingValue(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function normalizeMode(mode) {
  const m = String(mode || 'cash').toLowerCase().trim();
  if (m === 'bank_transfer' || m === 'neft' || m === 'rtgs' || m === 'imps') return 'bank';
  if (m === 'cheque' || m === 'check') return 'cheque';
  if (m === 'card' || m === 'credit_card' || m === 'debit_card') return 'card';
  if (m === 'upi' || m === 'gpay' || m === 'phonepe' || m === 'paytm') return 'upi';
  if (m === 'cash') return 'cash';
  if (m === 'advance') return 'advance';
  if (m === 'old_gold_exchange' || m === 'old_gold' || m === 'exchange') return 'old_gold';
  if (m === 'old_silver_exchange' || m === 'old_silver') return 'old_silver';
  if (m === 'finance' || m === 'emi' || m === 'loan') return 'finance';
  return m || 'other';
}

const LEDGER_MODES = ['cash', 'upi', 'card', 'bank', 'cheque', 'old_gold', 'old_silver', 'finance', 'other'];
const REFUND_KINDS = new Set([
  'customer_advance_refund',
  'invoice_cancel_refund',
  'invoice_return_refund',
]);

function emptyLedgerBucket() {
  return { in: 0, out: 0, net: 0, lines: [] };
}

function emptyPaymentLedger() {
  const ledger = {};
  for (const mode of LEDGER_MODES) ledger[mode] = emptyLedgerBucket();
  return ledger;
}

function joinDesc(parts) {
  return parts.map((p) => String(p || '').trim()).filter(Boolean).join(' · ');
}

function pushLedger(ledger, mode, { side, amount, description, at, id, source }) {
  const key = ledger[mode] ? mode : 'other';
  const amt = toMoneyNumber(amount);
  if (!(amt > 0)) return;
  const bucket = ledger[key];
  if (side === 'debit') bucket.out = toMoneyNumber(bucket.out + amt);
  else bucket.in = toMoneyNumber(bucket.in + amt);
  bucket.lines.push({
    id: id || `${source || 'line'}-${key}-${bucket.lines.length}`,
    side: side === 'debit' ? 'debit' : 'credit',
    amount: amt,
    description: description || (side === 'debit' ? 'Payment out' : 'Payment in'),
    at: at || null,
    source: source || null,
  });
}

function finalizePaymentLedger(ledger) {
  for (const bucket of Object.values(ledger)) {
    bucket.net = toMoneyNumber(bucket.in - bucket.out);
    bucket.lines.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  }
  return ledger;
}

export { classifyMetalLine, round3 } from './metalClassify.js';

function emptyMetalSold() {
  return {
    gold_g: 0,
    silver_g: 0,
    gold: { '22k': 0, '24k': 0, '18k': 0, other: 0, jewellery_g: 0, pure_g: 0 },
    silver: { jewellery: 0, pure: 0 },
  };
}

function addSold(target, line) {
  if (!(line.weight > 0)) return;
  if (line.family === 'gold') {
    target.gold_g = round3(target.gold_g + line.weight);
    if (line.kind === 'pure') target.gold.pure_g = round3(target.gold.pure_g + line.weight);
    else target.gold.jewellery_g = round3(target.gold.jewellery_g + line.weight);
    if (target.gold[line.bucket] != null) {
      target.gold[line.bucket] = round3(target.gold[line.bucket] + line.weight);
    } else {
      target.gold.other = round3(target.gold.other + line.weight);
    }
  } else {
    target.silver_g = round3(target.silver_g + line.weight);
    if (line.bucket === 'pure') target.silver.pure = round3(target.silver.pure + line.weight);
    else target.silver.jewellery = round3(target.silver.jewellery + line.weight);
  }
}

async function previousClosedRow(shopId, dateStr, transaction) {
  return DailyClosing.findOne({
    where: {
      shop_id: shopId,
      date: { [Op.lt]: dateStr },
      status: 'closed',
    },
    order: [['date', 'DESC']],
    transaction,
  });
}

async function previousClosingCash(shopId, dateStr, transaction) {
  const prev = await previousClosedRow(shopId, dateStr, transaction);
  return prev ? toMoneyNumber(prev.closing_cash) : 0;
}

function readClosingSnapshot(closing) {
  const raw = closing?.snapshot_json;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === 'object' ? raw : null;
}

function ledgerFlow(ledger, mode) {
  const b = ledger?.[mode] || {};
  return {
    in: toMoneyNumber(b.in),
    out: toMoneyNumber(b.out),
  };
}

function buildPocket(opening, inn, out, counted) {
  const expected = toMoneyNumber(toMoneyNumber(opening) + toMoneyNumber(inn) - toMoneyNumber(out));
  const hasCount = counted != null && counted !== '';
  const countedN = hasCount ? toMoneyNumber(counted) : expected;
  return {
    opening: toMoneyNumber(opening),
    in: toMoneyNumber(inn),
    out: toMoneyNumber(out),
    expected,
    counted: countedN,
    variance: toMoneyNumber(countedN - expected),
  };
}

const TILL_OPENING_KEY = 'till_opening_cash';
const ACTIVE_BILLING_DATE_KEY = 'active_billing_date';
const STALE_WARNING_DAYS = 2;

function addDaysStr(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function daysBetweenStr(fromStr, toStr) {
  const [fy, fm, fd] = String(fromStr).split('-').map(Number);
  const [ty, tm, td] = String(toStr).split('-').map(Number);
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.round((toMs - fromMs) / 86400000);
}

/**
 * The active (open, unclosed) business/billing day. New transactions are
 * stamped with this date instead of the real wall-clock date; it only
 * advances when Day Close succeeds for it — see advanceActiveBillingDate.
 *
 * With Close Day turned OFF (auto_day_close), it is always the real calendar
 * date: the stored day pointer is left for autoDayCloseService to catch up.
 */
export async function getActiveBillingDate({ shopId, transaction } = {}) {
  const realToday = localTodayStr();
  const autoMode = await getAutoDayCloseMode(transaction);
  if (autoMode.enabled) {
    return {
      date: realToday,
      real_today: realToday,
      days_stale: 0,
      is_stale: false,
      date_mismatch: false,
      auto_day_close: true,
    };
  }
  const resolvedShopId = shopId || (await getDefaultShopId({ transaction }));
  const row = await Setting.findOne({ where: { key: ACTIVE_BILLING_DATE_KEY }, transaction });
  let date = parseSettingValue(row?.value).date;
  if (!date) {
    date = realToday;
    if (row) {
      await row.update({ value: { date }, shop_id: resolvedShopId }, { transaction });
    } else {
      try {
        await Setting.create({
          id: newId(),
          shop_id: resolvedShopId,
          key: ACTIVE_BILLING_DATE_KEY,
          value: { date },
        }, { transaction });
      } catch {
        // Lost a first-use race to another concurrent request — read what it wrote.
        const winner = await Setting.findOne({ where: { key: ACTIVE_BILLING_DATE_KEY }, transaction });
        date = parseSettingValue(winner?.value).date || date;
      }
    }
  }
  const daysStale = Math.max(0, daysBetweenStr(date, realToday));
  return {
    date,
    real_today: realToday,
    days_stale: daysStale,
    is_stale: daysStale >= STALE_WARNING_DAYS,
    date_mismatch: daysStale >= 1,
    auto_day_close: false,
  };
}

/**
 * Raw stored day pointer (the oldest day not yet closed), ignoring auto mode —
 * autoDayCloseService closes every day from here up to yesterday.
 */
export async function readStoredBillingDate({ transaction } = {}) {
  const row = await Setting.findOne({ where: { key: ACTIVE_BILLING_DATE_KEY }, transaction });
  return parseSettingValue(row?.value).date || null;
}

export { localTodayStr };

/**
 * Called right after a successful Day Close — advances the active billing
 * date by exactly one day from the date that was just closed. It never
 * jumps straight to real "today": a shop that is several real days behind
 * must click Close Day once per day to catch up, one day at a time.
 */
export async function advanceActiveBillingDate({ shopId, closedDate, transaction }) {
  const resolvedShopId = shopId || (await getDefaultShopId({ transaction }));
  const nextDate = addDaysStr(closedDate, 1);
  const row = await Setting.findOne({ where: { key: ACTIVE_BILLING_DATE_KEY }, transaction });
  if (row) {
    await row.update({ value: { date: nextDate }, shop_id: resolvedShopId }, { transaction });
  } else {
    await Setting.create({
      id: newId(),
      shop_id: resolvedShopId,
      key: ACTIVE_BILLING_DATE_KEY,
      value: { date: nextDate },
    }, { transaction });
  }
  return nextDate;
}

/**
 * Called once, right after go-live Opening Setup is saved — pins the active
 * business/billing day to the chosen accounting cutover date, instead of
 * leaving it at whatever date it happened to lazily default to (real "today"
 * the first time any pre-accounts/test activity ran getActiveBillingDate).
 * Only ever called before any day has been closed (see openingSetupService),
 * so there is no closed history to jump backward past.
 */
export async function setActiveBillingDate({ shopId, date, transaction }) {
  const resolvedShopId = shopId || (await getDefaultShopId({ transaction }));
  const row = await Setting.findOne({ where: { key: ACTIVE_BILLING_DATE_KEY }, transaction });
  if (row) {
    await row.update({ value: { date }, shop_id: resolvedShopId }, { transaction });
  } else {
    await Setting.create({
      id: newId(),
      shop_id: resolvedShopId,
      key: ACTIVE_BILLING_DATE_KEY,
      value: { date },
    }, { transaction });
  }
  return date;
}

async function hasPriorClosedDay(shopId, dateStr, transaction) {
  const prev = await DailyClosing.findOne({
    where: {
      shop_id: shopId,
      date: { [Op.lt]: dateStr },
      status: 'closed',
    },
    transaction,
  });
  return Boolean(prev);
}

async function loadTillOpeningFloat(shopId, transaction) {
  const row = await Setting.findOne({
    where: { key: TILL_OPENING_KEY },
    transaction,
  });
  if (!row?.value) return null;
  let v = row.value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      v = { amount: v };
    }
  }
  const amt = typeof v === 'object' && v != null ? v.amount : v;
  const n = toMoneyNumber(amt);
  return n > 0 ? n : null;
}

/** Draft default is 0 — treat that as unset so it cannot hide a locked till float. */
function draftOpeningAmount(closing) {
  if (closing?.status !== 'draft' || closing.opening_cash == null) return null;
  const n = toMoneyNumber(closing.opening_cash);
  return n > 0 ? n : null;
}

async function persistTillOpeningFloat(shopId, amount, { transaction, userId = null } = {}) {
  const n = toMoneyNumber(amount);
  if (n < 0) return;
  let row = await Setting.findOne({
    where: { key: TILL_OPENING_KEY },
    transaction,
  });
  const payload = {
    amount: n,
    set_at: new Date().toISOString(),
    set_by: userId || null,
  };
  if (row) {
    await row.update({ value: payload, shop_id: shopId }, { transaction });
  } else {
    await Setting.create({
      id: newId(),
      shop_id: shopId,
      key: TILL_OPENING_KEY,
      value: payload,
    }, { transaction });
  }
}

/**
 * Opening till cash: locked from previous EOD close once the chain starts;
 * on go-live (no prior closed day) the cashier sets the drawer float explicitly.
 */
async function resolveOpeningCash({
  shopId,
  dateStr,
  closing,
  requestedOpening,
  transaction,
}) {
  const prevCash = await previousClosingCash(shopId, dateStr, transaction);
  const chained = await hasPriorClosedDay(shopId, dateStr, transaction);

  if (closing?.status === 'closed') {
    return toMoneyNumber(closing.opening_cash);
  }
  if (chained) {
    return prevCash;
  }

  const tillFloat = await loadTillOpeningFloat(shopId, transaction);
  if (tillFloat != null) return tillFloat;

  if (requestedOpening != null && requestedOpening !== '') {
    const requested = toMoneyNumber(requestedOpening);
    if (requested > 0) return requested;
  }
  const draftAmt = draftOpeningAmount(closing);
  if (draftAmt != null) return draftAmt;
  return 0;
}

/** Same calendar-day rule as ERP Statement: business/transaction date first. */
function paymentDateKey(p) {
  if (p.business_date) return String(p.business_date).slice(0, 10);
  if (p.date) return String(p.date).slice(0, 10);
  if (p.paid_at) return localDateStr(p.paid_at);
  return null;
}

/**
 * Build a full day snapshot used by the Daily Closing UI and close validation.
 */
export async function buildDaySnapshot(dateStr, { shopId, transaction, includeHidden = false, skipFrozen = false } = {}) {
  const resolvedShopId = shopId || (await getDefaultShopId({ transaction }));
  const { dayStart, dayEnd } = dayBounds(dateStr);

  const [
    invoices,
    expenses,
    incomes,
    paymentRows,
    closing,
    drafts,
    sync,
    schemes,
    creditNotes,
    oldGoldRows,
    advancesReceived,
    advanceApps,
    purchases,
    purchasesWithPayments,
    employees,
    rateHist,
    rateSetting,
    catalogItems,
    products,
    oldGoldSales,
    cancelledOrReturnedToday,
  ] = await Promise.all([
    Invoice.findAll({
      where: {
        ...shopScope(resolvedShopId),
        [Op.or]: [
          { business_date: dateStr },
          { business_date: null, created_at: { [Op.between]: [dayStart, dayEnd] } },
        ],
      },
      attributes: [
        'id', 'invoice_no', 'status', 'grand_total', 'payments', 'items',
        'balance_due', 'created_at', 'business_date', 'discount', 'gst_amount', 'cgst_amount',
        'sgst_amount', 'old_gold_value', 'old_silver_value', 'scheme_credit', 'scheme_id',
        'salesperson_id', 'customer_name', 'subtotal', 'gold_rate', 'is_hidden',
      ],
      transaction,
    }),
    Expense.findAll({
      where: {
        date: dateStr,
        [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }],
      },
      transaction,
    }),
    Income.findAll({
      where: {
        date: dateStr,
        [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }],
      },
      transaction,
    }),
    Payment.findAll({
      where: {
        shop_id: resolvedShopId,
        status: { [Op.ne]: 'void' },
        [Op.or]: [
          { business_date: dateStr },
          {
            business_date: null,
            [Op.or]: [
              { paid_at: { [Op.between]: [dayStart, dayEnd] } },
              {
                paid_at: null,
                created_at: { [Op.between]: [dayStart, dayEnd] },
              },
            ],
          },
        ],
      },
      transaction,
    }),
    DailyClosing.findOne({
      where: { shop_id: resolvedShopId, date: dateStr },
      transaction,
    }),
    DraftSale.findAll({
      where: {
        status: { [Op.in]: ['pending', 'queued', 'conflict'] },
        [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }],
      },
      attributes: ['id', 'status', 'total', 'created_at'],
      transaction,
    }).catch(() => []),
    Promise.resolve({ pending: 0, failed: 0 }),
    Scheme.findAll({
      where: { [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }] },
      attributes: ['id', 'customer_name', 'plan_name', 'payments', 'status', 'financial_mode'],
      transaction,
    }).catch(() => []),
    CreditNote.findAll({
      where: {
        shop_id: resolvedShopId,
        [Op.or]: [
          { business_date: dateStr },
          { business_date: null, created_at: { [Op.between]: [dayStart, dayEnd] } },
        ],
      },
      attributes: ['id', 'credit_note_no', 'invoice_id', 'grand_total', 'reason', 'created_at', 'business_date'],
      transaction,
    }).catch(() => []),
    OldGoldReceipt.findAll({
      where: {
        shop_id: resolvedShopId,
        [Op.or]: [
          { business_date: dateStr },
          { business_date: null, created_at: { [Op.between]: [dayStart, dayEnd] } },
        ],
      },
      transaction,
    }).catch(() => []),
    CustomerAdvance.findAll({
      where: {
        shop_id: resolvedShopId,
        created_at: { [Op.between]: [dayStart, dayEnd] },
      },
      transaction,
    }).catch(() => []),
    CustomerAdvanceApplication.findAll({
      where: {
        shop_id: resolvedShopId,
        created_at: { [Op.between]: [dayStart, dayEnd] },
      },
      transaction,
    }).catch(() => []),
    Purchase.findAll({
      where: {
        purchase_date: dateStr,
        [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }],
        status: { [Op.ne]: 'draft' },
      },
      attributes: ['id', 'items', 'purchase_type', 'purchase_date'],
      transaction,
    }).catch(() => []),
    // Separate from `purchases` above (scoped by the PO's own purchase_date,
    // used only for metal-received reporting): a vendor can be paid several
    // days after the PO was created, so cash actually paid out today has to
    // be matched on each PAYMENT's own date, not the purchase's — this scans
    // recent non-draft purchases and the day-filtering happens in JS below.
    Purchase.findAll({
      where: {
        [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }],
        status: { [Op.ne]: 'draft' },
      },
      attributes: ['id', 'po_number', 'vendor_name', 'payments', 'financial_mode'],
      order: [['created_at', 'DESC']],
      limit: 5000,
      transaction,
    }).catch(() => []),
    Employee.findAll({
      where: { [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }] },
      attributes: ['id', 'name', 'user_id', 'job_title'],
      transaction,
    }).catch(() => []),
    GoldRateHistory.findAll({
      where: {
        shop_id: resolvedShopId,
        created_at: { [Op.lte]: dayEnd },
      },
      order: [['created_at', 'DESC']],
      limit: 40,
      transaction,
    }).catch(() => []),
    Setting.findOne({
      where: { key: 'gold_rate' },
      transaction,
    }).catch(() => null),
    CatalogItem.findAll({
      where: {
        type: { [Op.in]: ['metal_type', 'purity'] },
      },
      attributes: ['id', 'type', 'name', 'code'],
      transaction,
    }).catch(() => []),
    Product.findAll({
      where: {
        deleted_at: null,
        status: { [Op.notIn]: ['sold', 'discontinued', 'deleted', 'deleted_p'] },
        [Op.or]: [{ shop_id: resolvedShopId }, { shop_id: null }],
      },
      attributes: [
        'id', 'metal_type_id', 'purity_id', 'net_weight', 'gross_weight',
        'stock_qty', 'status', 'name', 'inventory_mode', 'tray_total_weight',
      ],
      transaction,
    }).catch(() => []),
    OldGoldSale.findAll({
      where: {
        shop_id: resolvedShopId,
        status: { [Op.ne]: 'cancelled' },
        [Op.or]: [
          { business_date: dateStr },
          { business_date: null, created_at: { [Op.between]: [dayStart, dayEnd] } },
        ],
      },
      transaction,
    }).catch(() => []),
    // Invoices cancelled/returned on THIS business day — deliberately scoped
    // by cancelled_at/returned_at, not business_date (which is the invoice's
    // ORIGINAL billing day). A bill billed on an earlier business day and
    // cancelled/returned today must still show up in today's Returns tile.
    Invoice.findAll({
      where: {
        ...shopScope(resolvedShopId),
        [Op.or]: [
          { cancelled_at: { [Op.between]: [dayStart, dayEnd] } },
          { returned_at: { [Op.between]: [dayStart, dayEnd] } },
        ],
      },
      attributes: ['id', 'invoice_no', 'status', 'grand_total', 'is_hidden', 'cancelled_at', 'returned_at'],
      transaction,
    }).catch(() => []),
  ]);

  await hydrateInvoiceItems(invoices);

  const lockedHiddenIds = includeHidden
    ? new Set()
    : await loadHiddenInvoiceIds(resolvedShopId, { transaction });

  const activeInvoices = invoices.filter((inv) => {
    if (!includeHidden && isHiddenBill(inv)) return false;
    return !CANCELLED.has(String(inv.status || '').toLowerCase());
  });
  // Deliberately from cancelledOrReturnedToday (cancelled_at/returned_at),
  // not from `invoices` (business_date = original billing day) — see the
  // query above.
  const cancelledInvoices = cancelledOrReturnedToday.filter((inv) => {
    if (!includeHidden && isHiddenBill(inv)) return false;
    return CANCELLED.has(String(inv.status || '').toLowerCase());
  });
  const pendingInvoices = activeInvoices.filter((inv) => {
    const st = String(inv.status || '').toLowerCase();
    if (UNPAID.has(st)) return true;
    const bal = toMoneyNumber(inv.balance_due);
    return bal > 0.009 && st !== 'paid';
  });

  const breakdown = {
    cash: 0, upi: 0, card: 0, bank: 0, cheque: 0,
    advance: 0, old_gold: 0, old_silver: 0, finance: 0, other: 0,
  };
  const invoiceIdsWithPaymentRows = new Set();

  for (const p of paymentRows) {
    if (isPreAccountsRecord(p)) continue;
    if (p.invoice_id && lockedHiddenIds.has(p.invoice_id)) continue;
    const meta = p.meta && typeof p.meta === 'object' ? p.meta : {};
    if (REFUND_KINDS.has(String(meta.kind || ''))) continue;
    if (p.invoice_id) invoiceIdsWithPaymentRows.add(p.invoice_id);
    const mode = normalizeMode(p.mode);
    const amt = toMoneyNumber(p.amount);
    if (!(amt > 0)) continue;
    if (breakdown[mode] != null) breakdown[mode] = toMoneyNumber(breakdown[mode] + amt);
    else breakdown.other = toMoneyNumber(breakdown.other + amt);
  }

  for (const inv of activeInvoices) {
    if (invoiceIdsWithPaymentRows.has(inv.id)) continue;
    const payments = invoicePaymentsOf(inv);
    for (const p of payments) {
      const mode = normalizeMode(p.mode || p.payment_mode);
      const amt = toMoneyNumber(p.amount);
      if (breakdown[mode] != null) breakdown[mode] = toMoneyNumber(breakdown[mode] + amt);
      else breakdown.other = toMoneyNumber(breakdown.other + amt);
    }
  }

  // Old gold on invoices is an exchange deduction — ensure counted even if not in payments
  let oldGoldFromInvoices = 0;
  let oldSilverFromInvoices = 0;
  for (const inv of activeInvoices) {
    const og = toMoneyNumber(inv.old_gold_value);
    if (og > 0) oldGoldFromInvoices = toMoneyNumber(oldGoldFromInvoices + og);
    const os = toMoneyNumber(inv.old_silver_value);
    if (os > 0) oldSilverFromInvoices = toMoneyNumber(oldSilverFromInvoices + os);
  }
  if (breakdown.old_gold < oldGoldFromInvoices) {
    breakdown.old_gold = oldGoldFromInvoices;
  }
  if (breakdown.old_silver < oldSilverFromInvoices) {
    breakdown.old_silver = oldSilverFromInvoices;
  }

  const liveExpenses = expenses.filter((e) => !isPreAccountsRecord(e));
  const liveIncomes = incomes.filter((i) => !isPreAccountsRecord(i));

  const totalSales = toMoneyNumber(
    activeInvoices.reduce((s, inv) => s + toMoneyNumber(inv.grand_total), 0),
  );
  const totalExpenses = toMoneyNumber(
    liveExpenses.reduce((s, e) => s + toMoneyNumber(e.amount), 0),
  );
  const cashExpenses = toMoneyNumber(
    liveExpenses
      .filter((e) => normalizeMode(e.payment_mode) === 'cash')
      .reduce((s, e) => s + toMoneyNumber(e.amount), 0),
  );
  let totalIncome = toMoneyNumber(
    liveIncomes.reduce((s, i) => s + toMoneyNumber(i.amount), 0),
  );
  let cashIncome = toMoneyNumber(
    liveIncomes
      .filter((i) => normalizeMode(i.payment_mode) === 'cash')
      .reduce((s, i) => s + toMoneyNumber(i.amount), 0),
  );
  const incomeByMode = {
    cash: 0, upi: 0, card: 0, bank: 0, cheque: 0, finance: 0, other: 0,
  };
  for (const i of liveIncomes) {
    const mode = normalizeMode(i.payment_mode);
    const amt = toMoneyNumber(i.amount);
    if (!(amt > 0)) continue;
    if (incomeByMode[mode] != null) incomeByMode[mode] = toMoneyNumber(incomeByMode[mode] + amt);
    else incomeByMode.other = toMoneyNumber(incomeByMode.other + amt);
  }

  // Old Gold Sale / Disposal — money received from the buyer (sale value minus
  // refining charges), by the payment mode chosen on the sale. Cash lands in
  // Cash income; UPI/bank/cheque land in Payment Summary for that mode.
  const oldGoldSaleRows = [];
  let cashOldGoldSales = 0;
  const ogSaleReceiptIds = [];
  for (const s of oldGoldSales || []) {
    const ids = Array.isArray(s.receipt_ids) ? s.receipt_ids : [];
    for (const id of ids) if (id) ogSaleReceiptIds.push(id);
  }
  const ogSaleReceipts = ogSaleReceiptIds.length
    ? await OldGoldReceipt.findAll({
      where: { id: { [Op.in]: [...new Set(ogSaleReceiptIds)] } },
      attributes: ['id', 'invoice_id'],
      transaction,
    }).catch(() => [])
    : [];
  const hiddenOgSaleReceiptIds = new Set(
    (ogSaleReceipts || [])
      .filter((r) => r.invoice_id && lockedHiddenIds.has(r.invoice_id))
      .map((r) => r.id),
  );
  for (const s of oldGoldSales || []) {
    if (isPreAccountsRecord(s)) continue;
    const rids = Array.isArray(s.receipt_ids) ? s.receipt_ids : [];
    if (rids.some((id) => hiddenOgSaleReceiptIds.has(id))) continue;
    const net = toMoneyNumber((Number(s.sale_value) || 0) - (Number(s.refining_charges) || 0));
    if (!(net > 0)) continue;
    const mode = normalizeMode(s.payment_mode);
    if (incomeByMode[mode] != null) incomeByMode[mode] = toMoneyNumber(incomeByMode[mode] + net);
    else incomeByMode.other = toMoneyNumber(incomeByMode.other + net);
    totalIncome = toMoneyNumber(totalIncome + net);
    if (mode === 'cash') {
      cashIncome = toMoneyNumber(cashIncome + net);
      cashOldGoldSales = toMoneyNumber(cashOldGoldSales + net);
    }
    const isSilverSale = normalizeReceiptMetal(s.metal) === 'silver';
    oldGoldSaleRows.push({
      id: s.id,
      sale_no: s.sale_no,
      buyer_name: s.buyer_name,
      amount: net,
      payment_mode: mode,
      at: s.createdAt || s.created_at,
      description: joinDesc([isSilverSale ? 'Old silver sale' : 'Old gold sale', s.sale_no, s.buyer_name]),
      kind: isSilverSale ? 'old_silver_sale' : 'old_gold_sale',
    });
  }

  // Cash actually paid out to vendors today — a real till outflow that must
  // reduce expected cash, same as any other cash expense. Matched on each
  // payment entry's own `date` (falling back to `paid_at`'s calendar day for
  // any legacy entry that predates the date field), not the PO's own date.
  let cashPurchases = 0;
  let totalPurchasePayments = 0;
  const purchaseByMode = {
    cash: 0, upi: 0, card: 0, bank: 0, cheque: 0, finance: 0, other: 0,
  };
  const purchase_payments = [];
  for (const pur of purchasesWithPayments) {
    if (isPreAccountsRecord(pur)) continue;
    const pays = invoicePaymentsOf(pur);
    pays.forEach((p, idx) => {
      const paidOn = p.date ? String(p.date).slice(0, 10) : (p.paid_at ? localDateStr(p.paid_at) : null);
      if (paidOn !== dateStr) return;
      const amt = toMoneyNumber(p.amount);
      if (!(amt > 0)) return;
      const mode = normalizeMode(p.mode || p.payment_mode);
      totalPurchasePayments = toMoneyNumber(totalPurchasePayments + amt);
      if (mode === 'cash') cashPurchases = toMoneyNumber(cashPurchases + amt);
      if (purchaseByMode[mode] != null) purchaseByMode[mode] = toMoneyNumber(purchaseByMode[mode] + amt);
      else purchaseByMode.other = toMoneyNumber(purchaseByMode.other + amt);
      purchase_payments.push({
        id: `${pur.id}-${idx}`,
        purchase_id: pur.id,
        po_number: pur.po_number,
        vendor_name: pur.vendor_name,
        amount: amt,
        mode,
        paid_at: p.paid_at || p.date || null,
        description: joinDesc(['Purchase', pur.po_number, pur.vendor_name]),
      });
    });
  }

  // `advance` is money already received on whatever day the customer's advance
  // was originally paid (it lands in this same `breakdown` under its own real
  // mode — cash/upi/etc — via the standalone advance-receipt Payment row).
  // The invoice's own `advance` line only marks that a slice of the sale was
  // *redeemed* from that pre-existing credit — it is not new money today, so
  // it must be excluded here (same treatment as `old_gold`) or it double-counts
  // the receipt.
  const collection = toMoneyNumber(
    breakdown.cash + breakdown.upi + breakdown.card + breakdown.bank
    + breakdown.cheque + breakdown.finance + breakdown.other,
  );

  // Metals sold from invoice lines
  const metalsSold = emptyMetalSold();
  for (const inv of activeInvoices) {
    for (const it of invoiceItemsOf(inv)) {
      addSold(metalsSold, classifyMetalLine(it));
    }
  }

  // Discounts + GST
  const discounts = {
    manual: toMoneyNumber(activeInvoices.reduce((s, i) => s + toMoneyNumber(i.discount), 0)),
    scheme: toMoneyNumber(activeInvoices.reduce((s, i) => s + toMoneyNumber(i.scheme_credit), 0)),
    total: 0,
  };
  discounts.total = toMoneyNumber(discounts.manual + discounts.scheme);

  const gst = {
    cgst: toMoneyNumber(activeInvoices.reduce((s, i) => s + toMoneyNumber(i.cgst_amount), 0)),
    sgst: toMoneyNumber(activeInvoices.reduce((s, i) => s + toMoneyNumber(i.sgst_amount), 0)),
    igst: 0,
    total: toMoneyNumber(activeInvoices.reduce((s, i) => s + toMoneyNumber(i.gst_amount), 0)),
    taxable: toMoneyNumber(activeInvoices.reduce((s, i) => s + toMoneyNumber(i.subtotal), 0)),
  };
  if (gst.cgst === 0 && gst.sgst === 0 && gst.total > 0) {
    gst.cgst = toMoneyNumber(gst.total / 2);
    gst.sgst = toMoneyNumber(gst.total / 2);
  }

  // Scheme installments collected today (transaction date, not wall-clock paid_at)
  const schemePayments = [];
  let schemeCollected = 0;
  let cashSchemes = 0;
  const schemeByMode = {
    cash: 0, upi: 0, card: 0, bank: 0, cheque: 0, finance: 0, other: 0,
  };
  for (const sch of schemes) {
    if (isPreAccountsRecord(sch)) continue;
    for (const p of parsePayments(sch.payments)) {
      if (paymentDateKey(p) !== dateStr) continue;
      const amt = toMoneyNumber(p.amount);
      if (!(amt > 0)) continue;
      schemeCollected = toMoneyNumber(schemeCollected + amt);
      const mode = normalizeMode(p.mode);
      if (mode === 'cash') {
        cashSchemes = toMoneyNumber(cashSchemes + amt);
      }
      if (schemeByMode[mode] != null) {
        schemeByMode[mode] = toMoneyNumber(schemeByMode[mode] + amt);
      } else {
        schemeByMode.other = toMoneyNumber(schemeByMode.other + amt);
      }
      schemePayments.push({
        scheme_id: sch.id,
        customer_name: sch.customer_name,
        plan_name: sch.plan_name,
        amount: amt,
        mode: p.mode,
        paid_at: p.paid_at,
        grams_credited: Number(p.grams_credited) || 0,
      });
    }
  }
  const schemeAdjustedOnBills = discounts.scheme;
  const scheme = {
    collected: schemeCollected,
    collected_cash: cashSchemes,
    collected_upi: schemeByMode.upi,
    by_mode: schemeByMode,
    adjusted_on_bills: schemeAdjustedOnBills,
    pending: toMoneyNumber(Math.max(0, schemeCollected - schemeAdjustedOnBills)),
    payment_count: schemePayments.length,
    payments: schemePayments.slice(0, 50),
  };

  // Old gold / old silver exchange
  const isSilverRec = (r) => String(r.metal || '').toLowerCase() === 'silver';
  const buildExchangeSnap = (receipts, invoiceValueField, invoiceFallbackTotal) => {
    const visible = (receipts || []).filter((r) => !r.invoice_id || !lockedHiddenIds.has(r.invoice_id));
    let weight = 0;
    let value = 0;
    for (const r of visible) {
      weight = round3(weight + Number(r.weight_g || 0));
      value = toMoneyNumber(value + toMoneyNumber(r.value));
    }
    if (value < invoiceFallbackTotal) value = invoiceFallbackTotal;
    const billsMap = new Map();
    for (const r of visible) {
      const key = r.invoice_id || r.invoice_no || r.id;
      const prev = billsMap.get(key) || { invoice_no: r.invoice_no || '—', amount: 0 };
      prev.invoice_no = r.invoice_no || prev.invoice_no || '—';
      prev.amount = toMoneyNumber(prev.amount + toMoneyNumber(r.value));
      billsMap.set(key, prev);
    }
    for (const inv of activeInvoices) {
      const amt = toMoneyNumber(inv[invoiceValueField]);
      if (!(amt > 0) || billsMap.has(inv.id)) continue;
      billsMap.set(inv.id, { invoice_no: inv.invoice_no || '—', amount: amt });
    }
    const bills = [...billsMap.values()];
    const purityMap = {};
    for (const r of visible) {
      const p = String(r.purity || '').trim() || 'Unknown';
      purityMap[p] = round3((purityMap[p] || 0) + (Number(r.weight_g) || 0));
    }
    const by_purity = Object.entries(purityMap)
      .filter(([, weight_g]) => weight_g > 0)
      .sort((a, b) => {
        const na = Number(String(a[0]).match(/(\d+(?:\.\d+)?)/)?.[1] || -1);
        const nb = Number(String(b[0]).match(/(\d+(?:\.\d+)?)/)?.[1] || -1);
        if (na !== nb) return nb - na;
        return String(a[0]).localeCompare(String(b[0]));
      })
      .map(([purity, weight_g]) => ({ purity, weight_g }));
    return {
      bill_count: bills.length || visible.length || activeInvoices.filter((i) => toMoneyNumber(i[invoiceValueField]) > 0).length,
      weight_g: weight,
      value,
      bills,
      by_purity,
    };
  };

  const visibleAllOg = (oldGoldRows || []).filter((r) => !r.invoice_id || !lockedHiddenIds.has(r.invoice_id));
  const old_gold = buildExchangeSnap(
    visibleAllOg.filter((r) => !isSilverRec(r)),
    'old_gold_value',
    oldGoldFromInvoices,
  );
  const old_silver = buildExchangeSnap(
    visibleAllOg.filter((r) => isSilverRec(r)),
    'old_silver_value',
    oldSilverFromInvoices,
  );

  // Advances — received today, utilized on bills, refunded on booking cancel
  const advReceived = toMoneyNumber(advancesReceived.reduce((s, a) => s + toMoneyNumber(a.amount), 0));
  const advUtilized = toMoneyNumber(advanceApps.reduce((s, a) => s + toMoneyNumber(a.amount), 0));
  const advRefunded = toMoneyNumber(paymentRows.reduce((s, p) => {
    const meta = p.meta && typeof p.meta === 'object' ? p.meta : {};
    if (meta.kind === 'customer_advance_refund') {
      return s + Math.abs(toMoneyNumber(p.amount));
    }
    return s;
  }, 0));
  // Also count payment-mode advance if applications empty
  const advFromPayments = breakdown.advance;
  const advances = {
    received: advReceived || (advFromPayments > 0 ? advFromPayments : 0),
    utilized: advUtilized || (advFromPayments > 0 ? advFromPayments : 0),
    refunded: advRefunded,
    balance: toMoneyNumber(
      (advReceived || (advFromPayments > 0 ? advFromPayments : 0))
      - (advUtilized || (advFromPayments > 0 ? advFromPayments : 0))
      - advRefunded,
    ),
    received_count: advancesReceived.length,
    utilized_count: advanceApps.length,
    refunded_count: paymentRows.filter((p) => p.meta?.kind === 'customer_advance_refund').length,
  };

  // Returns / cancelled
  const cancelReturnRefunded = toMoneyNumber(paymentRows.reduce((s, p) => {
    const kind = (p.meta && typeof p.meta === 'object' ? p.meta.kind : null);
    if (kind === 'invoice_cancel_refund' || kind === 'invoice_return_refund') {
      // Old gold / silver handed back on a cancel is metal, not money refunded.
      const m = normalizeMode(p.mode);
      if (m === 'old_gold' || m === 'old_silver') return s;
      return s + Math.abs(toMoneyNumber(p.amount));
    }
    return s;
  }, 0));
  const returns = {
    cancelled_count: cancelledInvoices.length,
    cancelled_amount: toMoneyNumber(cancelledInvoices.reduce((s, i) => s + toMoneyNumber(i.grand_total), 0)),
    credit_note_count: creditNotes.length,
    credit_note_amount: toMoneyNumber(creditNotes.reduce((s, c) => s + toMoneyNumber(c.grand_total), 0)),
    refunded_amount: cancelReturnRefunded,
    credit_notes: creditNotes.map((c) => ({
      id: c.id,
      credit_note_no: c.credit_note_no,
      invoice_id: c.invoice_id,
      amount: toMoneyNumber(c.grand_total),
      reason: c.reason,
    })),
  };

  // Expenses list — shop expenses plus vendor purchase payments (all modes)
  const expense_list = [
    ...liveExpenses.map((e) => ({
      id: e.id,
      description: e.description,
      category: e.category_name,
      amount: toMoneyNumber(e.amount),
      payment_mode: e.payment_mode,
      kind: 'expense',
      at: e.time ? `${dateStr}T${e.time}` : (e.createdAt || e.created_at),
    })),
    ...purchase_payments.map((p) => ({
      id: p.id,
      description: p.description,
      category: 'Vendor purchase',
      amount: p.amount,
      payment_mode: p.mode,
      kind: 'purchase',
      at: p.paid_at,
    })),
  ];

  // Income list
  const income_list = [
    ...liveIncomes.map((i) => ({
      id: i.id,
      description: i.description,
      amount: toMoneyNumber(i.amount),
      payment_mode: i.payment_mode,
      kind: 'income',
    })),
    ...oldGoldSaleRows.map((s) => ({
      id: s.id,
      description: s.description,
      amount: s.amount,
      payment_mode: s.payment_mode,
      kind: s.kind || 'old_gold_sale',
    })),
  ];

  // User activity
  const empById = new Map();
  for (const e of employees) {
    empById.set(e.id, e);
    if (e.user_id) empById.set(e.user_id, e);
  }
  const userBuckets = new Map();
  for (const inv of activeInvoices) {
    const sid = inv.salesperson_id;
    if (!sid) continue;
    const emp = empById.get(sid);
    const key = emp?.id || sid;
    if (!userBuckets.has(key)) {
      userBuckets.set(key, {
        employee_id: emp?.id || sid,
        employee_name: emp?.name || 'Unknown',
        job_title: emp?.job_title || null,
        invoice_count: 0,
        sales: 0,
      });
    }
    const b = userBuckets.get(key);
    b.invoice_count += 1;
    b.sales = toMoneyNumber(b.sales + toMoneyNumber(inv.grand_total));
  }
  const user_activity = [...userBuckets.values()].sort((a, b) => b.sales - a.sales);

  // Stock movement — sold / received / closing inventory best-effort
  const received = emptyMetalSold();
  for (const pur of purchases) {
    for (const it of parseItems(pur.items)) {
      addSold(received, classifyMetalLine({
        ...it,
        net_weight: it.net_weight ?? it.weight_g ?? it.gross_weight,
      }));
    }
  }

  const catalogById = new Map(catalogItems.map((c) => [c.id, c]));
  const closingInv = emptyMetalSold();
  for (const p of products) {
    const stock = Number(p.stock_qty);
    const isTray = Number(p.tray_total_weight) > 0;
    if (!isTray && !(stock > 0)) continue;
    const metalCat = catalogById.get(p.metal_type_id);
    const purityCat = catalogById.get(p.purity_id);
    // Tray unit: net_weight already holds the tray's own pooled weight, not a
    // per-piece figure — use it as-is. Unique tags: one piece. Quantity items:
    // per-piece weight × pieces in stock. (Same rule as inventoryQuickReports'
    // weightTotal/weightSumSql — keep in sync with that.)
    const weight = isTray
      ? round3(Number(p.tray_total_weight) || 0)
      : round3(Number(p.net_weight || p.gross_weight || 0) * (p.inventory_mode === 'unique_tag' ? 1 : stock));
    if (!(weight > 0)) continue;
    addSold(closingInv, classifyMetalLine({
      metal: metalCat?.name || p.name || '',
      purity: purityCat?.name || purityCat?.code || '',
      net_weight: weight,
      quantity: 1,
    }));
  }

  const stockRow = (label, open, recv, sold, close) => ({
    label, opening_g: open, received_g: recv, sold_g: sold, closing_g: close,
  });

  const stock = {
    gold: [
      stockRow(
        '22K',
        round3(closingInv.gold['22k'] - received.gold['22k'] + metalsSold.gold['22k']),
        received.gold['22k'],
        metalsSold.gold['22k'],
        closingInv.gold['22k'],
      ),
      stockRow(
        '24K',
        round3(closingInv.gold['24k'] - received.gold['24k'] + metalsSold.gold['24k']),
        received.gold['24k'],
        metalsSold.gold['24k'],
        closingInv.gold['24k'],
      ),
    ],
    silver: [
      stockRow(
        'Jewellery',
        round3(closingInv.silver.jewellery - received.silver.jewellery + metalsSold.silver.jewellery),
        received.silver.jewellery,
        metalsSold.silver.jewellery,
        closingInv.silver.jewellery,
      ),
      stockRow(
        'Pure',
        round3(closingInv.silver.pure - received.silver.pure + metalsSold.silver.pure),
        received.silver.pure,
        metalsSold.silver.pure,
        closingInv.silver.pure,
      ),
    ],
  };

  // Rates — opening = last history before day; closing = last on/before day end or current setting
  const parseRates = (raw) => {
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); } catch { return null; }
  };
  const settingRates = parseRates(rateSetting?.value) || {};
  let openingRates = null;
  let closingRates = null;
  // rateHist is newest-first
  for (const h of rateHist) {
    const key = localDateStr(h.created_at);
    const rates = parseRates(h.rates) || {};
    if (key && key <= dateStr && !closingRates) closingRates = rates;
    if (key && key < dateStr && !openingRates) openingRates = rates;
    if (closingRates && openingRates) break;
  }
  if (!closingRates) closingRates = settingRates;
  if (!openingRates) openingRates = closingRates;
  const rates = {
    opening: {
      gold_24k: Number(openingRates.gold_24k) || 0,
      gold_22k: Number(openingRates.gold_22k) || 0,
      silver: Number(openingRates.silver || openingRates.pure_silver) || 0,
    },
    closing: {
      gold_24k: Number(closingRates.gold_24k) || 0,
      gold_22k: Number(closingRates.gold_22k) || 0,
      silver: Number(closingRates.silver || closingRates.pure_silver) || 0,
    },
  };

  const prevClosed = await previousClosedRow(resolvedShopId, dateStr, transaction);
  const prevCash = prevClosed ? toMoneyNumber(prevClosed.closing_cash) : 0;
  const hasPreviousClose = await hasPriorClosedDay(resolvedShopId, dateStr, transaction);
  const tillFloat = await loadTillOpeningFloat(resolvedShopId, transaction);
  const openingSetup = await getOpeningSetupStatus(resolvedShopId);
  const openingEditable = !hasPreviousClose && closing?.status !== 'closed' && tillFloat == null;

  let displayOpening;
  if (closing?.status === 'closed') {
    displayOpening = toMoneyNumber(closing.opening_cash);
  } else if (hasPreviousClose) {
    displayOpening = prevCash;
  } else if (tillFloat != null) {
    displayOpening = tillFloat;
  } else {
    displayOpening = draftOpeningAmount(closing) ?? 0;
  }

  const cashReceived = toMoneyNumber(breakdown.cash);

  const reasons = [];
  if (!openingSetup.setup_complete && !hasPreviousClose && closing?.status !== 'closed') {
    reasons.push('Complete Accounts → Overview → Opening Setup before day closing');
  }
  if (pendingInvoices.length) {
    reasons.push(`${pendingInvoices.length} invoice(s) still pending/partial — collect or settle first`);
  }
  if (drafts.length) {
    reasons.push(`${drafts.length} offline draft sale(s) not promoted — resolve on host before closing`);
  }
  if (closing?.status === 'closed') {
    reasons.push('This day is already closed');
  }

  const invoiceById = new Map(activeInvoices.map((inv) => [inv.id, inv]));
  const payment_ledger = emptyPaymentLedger();
  let cashRefunded = 0;

  for (const p of paymentRows) {
    if (isPreAccountsRecord(p)) continue;
    if (p.invoice_id && lockedHiddenIds.has(p.invoice_id)) continue;
    const meta = p.meta && typeof p.meta === 'object' ? p.meta : {};
    const kind = String(meta.kind || '');
    const mode = normalizeMode(p.mode);
    const amt = Math.abs(toMoneyNumber(p.amount));
    if (!(amt > 0)) continue;
    const inv = p.invoice_id ? invoiceById.get(p.invoice_id) : null;
    const at = p.paid_at || p.created_at || null;
    if (REFUND_KINDS.has(kind)) {
      if (mode === 'cash') cashRefunded = toMoneyNumber(cashRefunded + amt);
      pushLedger(payment_ledger, mode, {
        side: 'debit',
        amount: amt,
        description: joinDesc(['Refund', inv?.invoice_no, inv?.customer_name]),
        at,
        id: p.id,
        source: 'refund',
      });
      continue;
    }
    if (kind === 'customer_advance') {
      pushLedger(payment_ledger, mode, {
        side: 'credit',
        amount: amt,
        description: joinDesc(['Advance', inv?.customer_name || meta.customer_name]),
        at,
        id: p.id,
        source: 'advance',
      });
      continue;
    }
    if (inv) {
      pushLedger(payment_ledger, mode, {
        side: 'credit',
        amount: amt,
        description: joinDesc(['Sale', inv.invoice_no, inv.customer_name]),
        at,
        id: p.id,
        source: 'sale',
      });
      continue;
    }
    pushLedger(payment_ledger, mode, {
      side: 'credit',
      amount: amt,
      description: joinDesc(['Payment', p.reference]),
      at,
      id: p.id,
      source: 'payment',
    });
  }

  for (const inv of activeInvoices) {
    if (invoiceIdsWithPaymentRows.has(inv.id)) continue;
    for (const p of invoicePaymentsOf(inv)) {
      const mode = normalizeMode(p.mode || p.payment_mode);
      if (mode === 'advance') continue;
      const amt = toMoneyNumber(p.amount);
      if (!(amt > 0)) continue;
      pushLedger(payment_ledger, mode, {
        side: 'credit',
        amount: amt,
        description: joinDesc(['Sale', inv.invoice_no, inv.customer_name]),
        at: p.paid_at || inv.created_at,
        id: `${inv.id}-${mode}`,
        source: 'sale',
      });
    }
  }

  for (const p of schemePayments) {
    pushLedger(payment_ledger, normalizeMode(p.mode), {
      side: 'credit',
      amount: p.amount,
      description: joinDesc(['Scheme installment', p.customer_name, p.plan_name]),
      at: p.paid_at,
      id: `scheme-${p.scheme_id}-${p.paid_at || p.amount}`,
      source: 'scheme',
    });
  }

  for (const i of liveIncomes) {
    pushLedger(payment_ledger, normalizeMode(i.payment_mode), {
      side: 'credit',
      amount: i.amount,
      description: joinDesc(['Income', i.description]),
      at: i.time ? `${dateStr}T${i.time}` : (i.createdAt || i.created_at),
      id: i.id,
      source: 'income',
    });
  }

  for (const s of oldGoldSaleRows) {
    pushLedger(payment_ledger, s.payment_mode, {
      side: 'credit',
      amount: s.amount,
      description: s.description,
      at: s.at,
      id: s.id,
      source: 'old_gold_sale',
    });
  }

  for (const e of liveExpenses) {
    pushLedger(payment_ledger, normalizeMode(e.payment_mode), {
      side: 'debit',
      amount: e.amount,
      description: joinDesc(['Expense', e.description]),
      at: e.time ? `${dateStr}T${e.time}` : (e.createdAt || e.created_at),
      id: e.id,
      source: 'expense',
    });
  }

  for (const p of purchase_payments) {
    pushLedger(payment_ledger, p.mode, {
      side: 'debit',
      amount: p.amount,
      description: p.description,
      at: p.paid_at,
      id: p.id,
      source: 'purchase',
    });
  }

  const transferEntries = await CashbookEntry.findAll({
    where: {
      [Op.and]: [
        shopScope(resolvedShopId),
        { date: dateStr },
        { contra: true },
        { reference: { [Op.like]: 'TRF-%' } },
      ],
    },
    order: [['created_at', 'ASC']],
    transaction,
  }).catch(() => []);

  let cashTransfersIn = 0;
  let cashTransfersOut = 0;
  for (const e of transferEntries || []) {
    if (isPreAccountsRecord(e)) continue;
    const mode = normalizeMode(e.mode);
    const amt = toMoneyNumber(e.amount);
    if (!(amt > 0)) continue;
    const isIn = String(e.entry_type).toLowerCase() === 'in';
    pushLedger(payment_ledger, mode, {
      side: isIn ? 'credit' : 'debit',
      amount: amt,
      description: joinDesc(['Payment transfer', e.notes || e.reference]),
      at: e.created_at || dateStr,
      id: e.id,
      source: 'transfer',
    });
    if (mode === 'cash') {
      if (isIn) cashTransfersIn += amt;
      else cashTransfersOut += amt;
    }
  }
  cashTransfersIn = toMoneyNumber(cashTransfersIn);
  cashTransfersOut = toMoneyNumber(cashTransfersOut);

  finalizePaymentLedger(payment_ledger);

  const payment_breakdown = {
    cash: toMoneyNumber(breakdown.cash + schemeByMode.cash + incomeByMode.cash),
    upi: toMoneyNumber(breakdown.upi + schemeByMode.upi + incomeByMode.upi),
    card: toMoneyNumber(breakdown.card + schemeByMode.card + incomeByMode.card),
    bank: toMoneyNumber(breakdown.bank + schemeByMode.bank + incomeByMode.bank),
    cheque: toMoneyNumber(breakdown.cheque + schemeByMode.cheque + incomeByMode.cheque),
    advance: breakdown.advance,
    old_gold: breakdown.old_gold,
    old_silver: breakdown.old_silver,
    finance: toMoneyNumber(breakdown.finance + schemeByMode.finance + incomeByMode.finance),
    other: toMoneyNumber(breakdown.other + schemeByMode.other + incomeByMode.other),
  };

  const report = {
    metals: metalsSold,
    scheme,
    old_gold,
    old_silver,
    advances,
    returns,
    discounts,
    gst,
    expense_list,
    income_list,
    purchase_payments,
    payment_ledger,
    user_activity,
    stock,
    rates,
    pending: {
      unpaid_invoices: pendingInvoices.length,
      hold_drafts: drafts.length,
      credit_notes: creditNotes.length,
    },
  };

  const cashInTotal = toMoneyNumber(cashReceived + cashSchemes + cashIncome + cashTransfersIn);
  const cashOutTotal = toMoneyNumber(cashExpenses + cashPurchases + cashTransfersOut + cashRefunded);
  const savedOpenings = openingSetup?.opening_saved || {};
  const prevFc = readClosingSnapshot(prevClosed)?.final_check || {};
  const savedFc = readClosingSnapshot(closing)?.final_check || {};
  const upiFlow = ledgerFlow(payment_ledger, 'upi');
  const bankFlow = ledgerFlow(payment_ledger, 'bank');
  const chequeFlow = ledgerFlow(payment_ledger, 'cheque');
  const openingUpi = hasPreviousClose
    ? toMoneyNumber(prevFc.upi?.counted ?? savedOpenings.upi)
    : toMoneyNumber(savedOpenings.upi);
  const openingBank = hasPreviousClose
    ? toMoneyNumber(prevFc.bank?.counted ?? savedOpenings.bank)
    : toMoneyNumber(savedOpenings.bank);
  const openingCheque = hasPreviousClose
    ? toMoneyNumber(prevFc.cheque?.counted ?? savedOpenings.cheque ?? 0)
    : toMoneyNumber(savedOpenings.cheque ?? 0);

  const final_check = {
    cash: buildPocket(
      displayOpening,
      cashInTotal,
      cashOutTotal,
      closing ? closing.closing_cash : savedFc.cash?.counted,
    ),
    upi: buildPocket(openingUpi, upiFlow.in, upiFlow.out, savedFc.upi?.counted),
    bank: buildPocket(openingBank, bankFlow.in, bankFlow.out, savedFc.bank?.counted),
    cheque: buildPocket(openingCheque, chequeFlow.in, chequeFlow.out, savedFc.cheque?.counted),
  };

  // If day already closed with frozen snapshot, prefer frozen report sections
  // unless a caller (Day Closing Report) needs a live hidden/unhidden view.
  const frozen = skipFrozen ? null : (
    closing?.snapshot_json && closing.status === 'closed'
      ? (typeof closing.snapshot_json === 'string'
        ? (() => { try { return JSON.parse(closing.snapshot_json); } catch { return null; } })()
        : closing.snapshot_json)
      : null
  );

  return {
    date: dateStr,
    shop_id: resolvedShopId,
    daily_closing: closing ? closing.toJSON() : null,
    has_previous_close: hasPreviousClose,
    opening_cash_editable: openingEditable,
    suggested_opening_cash: hasPreviousClose ? prevCash : (tillFloat ?? 0),
    previous_closing_cash: prevCash,
    till_opening_float: tillFloat,
    till_opening_locked: tillFloat != null,
    opening_setup_complete: openingSetup.setup_complete,
    totals: {
      sales: totalSales,
      collection: toMoneyNumber(
        payment_breakdown.cash + payment_breakdown.upi + payment_breakdown.card
        + payment_breakdown.bank + payment_breakdown.cheque + payment_breakdown.finance
        + payment_breakdown.other,
      ),
      expenses: totalExpenses,
      cash_expenses: cashExpenses,
      income: totalIncome,
      cash_income: cashIncome,
      cash_purchases: cashPurchases,
      vendor_payments: totalPurchasePayments,
      purchases_by_mode: purchaseByMode,
      cash_schemes: cashSchemes,
      cash_old_gold_sales: cashOldGoldSales,
      cash_transfers_in: cashTransfersIn,
      cash_transfers_out: cashTransfersOut,
      cash_refunded: cashRefunded,
      invoice_count: activeInvoices.length,
      expense_count: liveExpenses.length,
      income_count: liveIncomes.length + oldGoldSaleRows.length,
      // Excludes `advance` (redemption marker, not new money). Includes POS
      // settlements plus scheme installments collected on this date.
      payment_total: toMoneyNumber(
        Object.entries(payment_breakdown)
          .filter(([key]) => key !== 'advance')
          .reduce((s, [, v]) => s + toMoneyNumber(v), 0),
      ),
      gold_sold_g: metalsSold.gold_g,
      silver_sold_g: metalsSold.silver_g,
    },
    payment_breakdown,
    cash_summary: {
      opening_cash: displayOpening,
      cash_sales: cashReceived,
      cash_schemes: cashSchemes,
      cash_old_gold_sales: cashOldGoldSales,
      cash_expenses: cashExpenses,
      cash_income: cashIncome,
      cash_purchases: cashPurchases,
      purchases_by_mode: purchaseByMode,
      cash_transfers_in: cashTransfersIn,
      cash_transfers_out: cashTransfersOut,
      cash_refunded: cashRefunded,
      expected_closing_cash: toMoneyNumber(
        displayOpening + cashReceived + cashSchemes + cashIncome + cashTransfersIn
        - cashExpenses - cashPurchases - cashTransfersOut - cashRefunded,
      ),
      counted_closing_cash: closing ? toMoneyNumber(closing.closing_cash) : null,
      variance: closing
        ? toMoneyNumber(
          toMoneyNumber(closing.closing_cash)
          - toMoneyNumber(
            displayOpening + cashReceived + cashSchemes + cashIncome + cashTransfersIn
            - cashExpenses - cashPurchases - cashTransfersOut - cashRefunded,
          ),
        )
        : null,
    },
    ...(frozen || report),
    final_check: frozen?.final_check || final_check,
    checklist: closing?.checklist_json
      || frozen?.checklist
      || {
        cash_verified: false,
        upi_verified: false,
        bank_verified: false,
        cheque_verified: false,
        expenses_entered: false,
        income_entered: false,
        stock_checked: false,
        rates_checked: false,
      },
    blockers: {
      can_close: !pendingInvoices.length && !drafts.length && closing?.status !== 'closed'
        && (openingSetup.setup_complete || hasPreviousClose),
      pending_invoices: pendingInvoices.map((i) => ({
        id: i.id,
        invoice_no: i.invoice_no,
        status: i.status,
        grand_total: toMoneyNumber(i.grand_total),
        balance_due: toMoneyNumber(i.balance_due),
      })),
      pending_drafts: drafts.map((d) => ({
        id: d.id,
        status: d.status,
        total: toMoneyNumber(d.total),
      })),
      pending_sync: Number(sync.pending) || 0,
      failed_sync: Number(sync.failed) || 0,
      reasons,
      // Local-first: pending outbox is normal and does not need internet for day close
      warnings: [],
    },
  };
}

async function assertCanFinalize(snapshot, checklist, { shopId, transaction } = {}) {
  const active = await getActiveBillingDate({ shopId, transaction });
  if (snapshot.date !== active.date) {
    const err = new Error(
      `Cannot close — ${snapshot.date} is not the active business day. Your open business day is ${active.date}; close that one first.`,
    );
    err.status = 409;
    err.code = 'NOT_ACTIVE_BUSINESS_DATE';
    throw err;
  }
  if (snapshot.opening_setup_complete === false && !snapshot.has_previous_close) {
    const err = new Error('Complete Accounts → Overview → Opening Setup before day closing.');
    err.status = 409;
    err.code = 'OPENING_SETUP_INCOMPLETE';
    throw err;
  }
  if (snapshot.blockers.pending_invoices.length) {
    const err = new Error(
      `Cannot close — ${snapshot.blockers.pending_invoices.length} invoice(s) still pending/partial for ${snapshot.date}. Resolve them first.`,
    );
    err.status = 409;
    err.code = 'PENDING_INVOICES';
    err.pending_invoices = snapshot.blockers.pending_invoices;
    throw err;
  }
  if (snapshot.blockers.pending_drafts.length) {
    const err = new Error(
      `Cannot close — ${snapshot.blockers.pending_drafts.length} offline draft sale(s) are still open. Promote or discard them on the host first.`,
    );
    err.status = 409;
    err.code = 'PENDING_DRAFTS';
    err.pending_drafts = snapshot.blockers.pending_drafts;
    throw err;
  }
  if (!checklistComplete(checklist)) {
    const err = new Error('Cannot close — tick all checklist items before closing the day.');
    err.status = 400;
    err.code = 'CHECKLIST_INCOMPLETE';
    throw err;
  }
}

/**
 * Save go-live drawer opening cash immediately — locks after first save; feeds ERP Statement opening.
 */
export async function saveTillOpeningCash(amount, { shopId, userId, transaction } = {}) {
  const run = async (t) => {
    const resolvedShopId = shopId || await getDefaultShopId({ transaction: t });
    const n = toMoneyNumber(amount);
    if (Number.isNaN(n) || n < 0) {
      throw Object.assign(new Error('Opening cash cannot be negative'), { status: 400 });
    }
    if (n <= 0) {
      throw Object.assign(new Error('Enter the cash amount already in your drawer'), { status: 400 });
    }

    const todayStr = localTodayStr();
    const chained = await hasPriorClosedDay(resolvedShopId, todayStr, t);
    if (chained) {
      throw Object.assign(
        new Error('Opening cash is locked — taken from your last closed day'),
        { status: 409 },
      );
    }

    const existing = await loadTillOpeningFloat(resolvedShopId, t);
    if (existing != null) {
      throw Object.assign(
        new Error('Opening cash is already set and locked for go-live'),
        { status: 409, amount: existing },
      );
    }

    await persistTillOpeningFloat(resolvedShopId, n, { transaction: t, userId });

    const todayDraft = await DailyClosing.findOne({
      where: { shop_id: resolvedShopId, date: todayStr, status: 'draft' },
      transaction: t,
    });
    if (todayDraft) {
      await todayDraft.update({ opening_cash: n }, { transaction: t });
    }

    return { amount: n, locked: true, set_at: new Date().toISOString() };
  };

  if (transaction) return run(transaction);
  return sequelize.transaction(run);
}

/**
 * Create or update a daily closing (draft or closed) inside a transaction.
 */
export async function saveDailyClosing({
  date,
  opening_cash,
  closing_cash,
  cash_received,
  upi_received,
  card_received,
  bank_received,
  notes,
  checklist,
  final_check: countedFinals = null,
  status = 'draft',
  userId = null,
  forceSystemTotals = true,
  includeHidden = false,
  autoClose = false,
  transaction,
}) {
  if (!transaction) throw new Error('saveDailyClosing requires a transaction');
  if (!date) {
    const err = new Error('date is required');
    err.status = 400;
    throw err;
  }

  const shopId = await getDefaultShopId({ transaction });
  const snapshot = await buildDaySnapshot(date, { shopId, transaction, includeHidden });
  const existing = snapshot.daily_closing
    ? await DailyClosing.findByPk(snapshot.daily_closing.id, { transaction })
    : null;

  if (existing?.status === 'closed') {
    const err = new Error(`Daily closing for ${date} is already closed and cannot be edited`);
    err.status = 409;
    err.code = 'ALREADY_CLOSED';
    throw err;
  }

  const nextStatus = status === 'closed' ? 'closed' : 'draft';

  const checklistJson = checklist != null
    ? checklist
    : (existing?.checklist_json || snapshot.checklist || {});

  if (nextStatus === 'closed' && !autoClose) {
    if ((await getAutoDayCloseMode(transaction)).enabled) {
      const err = new Error('Close Day is turned off — days are closed automatically after midnight.');
      err.status = 409;
      err.code = 'AUTO_DAY_CLOSE_ON';
      throw err;
    }
    await assertCanFinalize(snapshot, checklistJson, { shopId, transaction });
  }

  const pb = snapshot.payment_breakdown;
  const totals = snapshot.totals;

  const chained = await hasPriorClosedDay(shopId, date, transaction);
  const opening = await resolveOpeningCash({
    shopId,
    dateStr: date,
    closing: existing,
    requestedOpening: opening_cash,
    transaction,
  });

  if (!chained && opening > 0) {
    const existingFloat = await loadTillOpeningFloat(shopId, transaction);
    if (existingFloat == null) {
      await persistTillOpeningFloat(shopId, opening, { transaction, userId });
    }
  }
  const posCashIn = toMoneyNumber(snapshot.cash_summary?.cash_sales);
  const cashIn = forceSystemTotals
    ? posCashIn
    : (cash_received != null ? toMoneyNumber(cash_received) : posCashIn);
  const upiIn = forceSystemTotals
    ? toMoneyNumber(pb.upi)
    : (upi_received != null ? toMoneyNumber(upi_received) : toMoneyNumber(pb.upi));
  const cardIn = forceSystemTotals
    ? toMoneyNumber(pb.card)
    : (card_received != null ? toMoneyNumber(card_received) : toMoneyNumber(pb.card));
  const bankIn = forceSystemTotals
    ? toMoneyNumber(pb.bank)
    : (bank_received != null ? toMoneyNumber(bank_received) : toMoneyNumber(pb.bank));

  const expected = toMoneyNumber(
    opening + cashIn + toMoneyNumber(totals.cash_schemes)
    + totals.cash_income - totals.cash_expenses - totals.cash_purchases
    + toMoneyNumber(totals.cash_transfers_in ?? snapshot.cash_summary?.cash_transfers_in)
    - toMoneyNumber(totals.cash_transfers_out ?? snapshot.cash_summary?.cash_transfers_out)
    - toMoneyNumber(totals.cash_refunded ?? snapshot.cash_summary?.cash_refunded),
  );
  const counted = closing_cash != null ? toMoneyNumber(closing_cash) : expected;
  const variance = toMoneyNumber(counted - expected);

  const liveFinal = snapshot.final_check || {};
  const countedMap = countedFinals && typeof countedFinals === 'object' ? countedFinals : {};
  const final_check = {
    cash: buildPocket(
      liveFinal.cash?.opening ?? opening,
      liveFinal.cash?.in ?? 0,
      liveFinal.cash?.out ?? 0,
      countedMap.cash != null && countedMap.cash !== '' ? countedMap.cash : counted,
    ),
    upi: buildPocket(
      liveFinal.upi?.opening ?? 0,
      liveFinal.upi?.in ?? 0,
      liveFinal.upi?.out ?? 0,
      countedMap.upi != null && countedMap.upi !== '' ? countedMap.upi : liveFinal.upi?.counted,
    ),
    bank: buildPocket(
      liveFinal.bank?.opening ?? 0,
      liveFinal.bank?.in ?? 0,
      liveFinal.bank?.out ?? 0,
      countedMap.bank != null && countedMap.bank !== '' ? countedMap.bank : liveFinal.bank?.counted,
    ),
    cheque: buildPocket(
      liveFinal.cheque?.opening ?? 0,
      liveFinal.cheque?.in ?? 0,
      liveFinal.cheque?.out ?? 0,
      countedMap.cheque != null && countedMap.cheque !== '' ? countedMap.cheque : liveFinal.cheque?.counted,
    ),
  };

  const snapshotToFreeze = {
    metals: snapshot.metals,
    scheme: snapshot.scheme,
    old_gold: snapshot.old_gold,
    old_silver: snapshot.old_silver,
    advances: snapshot.advances,
    returns: snapshot.returns,
    discounts: snapshot.discounts,
    gst: snapshot.gst,
    expense_list: snapshot.expense_list,
    income_list: snapshot.income_list,
    purchase_payments: snapshot.purchase_payments,
    payment_ledger: snapshot.payment_ledger,
    user_activity: snapshot.user_activity,
    stock: snapshot.stock,
    rates: snapshot.rates,
    pending: snapshot.pending,
    payment_breakdown: pb,
    totals,
    final_check,
    checklist: checklistJson,
    frozen_at: new Date().toISOString(),
  };

  const payload = {
    shop_id: shopId,
    date,
    opening_cash: opening,
    closing_cash: counted,
    total_sales: totals.sales,
    total_expenses: totals.expenses,
    total_income: totals.income,
    cash_received: cashIn,
    upi_received: upiIn,
    card_received: cardIn,
    bank_received: bankIn,
    expected_cash: expected,
    variance,
    cash_expenses: totals.cash_expenses,
    cash_income: totals.cash_income,
    cash_purchases: totals.cash_purchases,
    invoice_count: totals.invoice_count,
    expense_count: totals.expense_count,
    income_count: totals.income_count,
    notes: notes != null ? notes : (existing?.notes || null),
    checklist_json: checklistJson,
    snapshot_json: nextStatus === 'closed'
      ? snapshotToFreeze
      : { ...(readClosingSnapshot(existing) || snapshotToFreeze), final_check },
    status: nextStatus,
    closed_by: nextStatus === 'closed' ? (userId || null) : (existing?.closed_by || null),
    closed_at: nextStatus === 'closed' ? new Date() : null,
    origin_device_id: branchConfig.device_id || null,
  };

  let closing;
  let operation;
  if (existing) {
    await existing.update(payload, { transaction });
    closing = existing;
    operation = 'update';
  } else {
    closing = await DailyClosing.create({ id: newId(), ...payload }, { transaction });
    operation = 'create';
  }

  const row = closing.toJSON();
  const opId = newId();

  await appendEventLog({
    eventType: 'DAILY_CLOSING_UPSERTED',
    entityType: 'daily_closing',
    entityId: row.id,
    operationId: opId,
    originDeviceId: branchConfig.device_id,
    userId: userId || null,
    critical: nextStatus === 'closed',
    payload: { daily_closing: row, date, status: nextStatus },
    transaction,
  });

  await recordOperation({
    operationId: opId,
    operationType: `daily_closing.${operation}`,
    entityType: 'daily_closing',
    entityId: row.id,
    result: { date, status: nextStatus, variance },
    deviceId: branchConfig.device_id,
    userId: userId || null,
    transaction,
  }).catch(() => {});

  await appendAuditEvent({
    eventType: 'DAILY_CLOSING_UPSERTED',
    action: `daily_closing.${operation}`,
    entityType: 'daily_closing',
    entityId: row.id,
    userId: userId || null,
    deviceId: branchConfig.device_id,
    newValue: { date, status: nextStatus, closing_cash: counted, variance },
    transaction,
  }).catch(() => {});

  if (nextStatus === 'closed') {
    await Notification.create({
      id: newId(),
      type: 'daily_closing',
      title: autoClose ? `Day auto-closed — ${date}` : `Day closed — ${date}`,
      message: `Sales ${formatINR(totals.sales)}, expenses ${formatINR(totals.expenses)}, cash variance ${formatINR(variance)}`,
      data: { date, closing_id: row.id, variance },
      is_read: false,
      user_id: userId || null,
      shop_id: shopId,
    }, { transaction }).catch(() => {});

    await advanceActiveBillingDate({ shopId, closedDate: date, transaction });
  }

  return {
    closing: row,
    snapshot: await buildDaySnapshot(date, { shopId, transaction }),
  };
}
