import { Op } from 'sequelize';

/** Hidden POS numbers use `{prefix}-H-` (e.g. SSJ-H-1/0001). */
export function isHiddenInvoiceNo(invoiceNo) {
  return /-H-/i.test(String(invoiceNo || ''));
}

/** SQLite stores BOOLEAN as 0/1 — `is_hidden: false` alone can miss integer 1 rows. */
export const HIDDEN_INVOICE = {
  [Op.or]: [
    { is_hidden: true },
    { is_hidden: 1 },
    { invoice_no: { [Op.like]: '%-H-%' } },
  ],
};

/** Exclude owner-only hidden bills from books / reports / dashboard until unlocked. */
export const NOT_HIDDEN_INVOICE = {
  [Op.and]: [
    {
      [Op.or]: [
        { is_hidden: false },
        { is_hidden: 0 },
        { is_hidden: null },
      ],
    },
    {
      [Op.or]: [
        { invoice_no: { [Op.is]: null } },
        { invoice_no: { [Op.notLike]: '%-H-%' } },
      ],
    },
  ],
};

/**
 * Invoice statuses that must NOT count toward sales / GST / employee performance.
 * Full returns are excluded (credit notes cover the reversal). Partial returns stay
 * on the invoice so remaining sold value is still reported; CN nets GST/EOD.
 */
export const VOID_OR_FULL_RETURN_STATUSES = Object.freeze([
  'cancelled',
  'canceled',
  'void',
  'voided',
  'returned',
]);

/** Sequelize where fragment: active sale invoices only. */
export const NOT_VOID_OR_RETURNED = {
  [Op.notIn]: [...VOID_OR_FULL_RETURN_STATUSES],
};

export function isVoidOrFullyReturnedStatus(status) {
  return VOID_OR_FULL_RETURN_STATUSES.includes(String(status || '').toLowerCase());
}

/** Merge a where clause with the not-hidden constraint. */
export function withNotHidden(where = {}) {
  const keys = Object.keys(where || {});
  if (!keys.length) return { ...NOT_HIDDEN_INVOICE };
  return { [Op.and]: [where, NOT_HIDDEN_INVOICE] };
}

/** True only for owner-only hidden bills — not cancelled POS invoices. */
export function isHiddenBill(inv) {
  if (!inv) return false;
  if (isHiddenInvoiceNo(inv.invoice_no || inv.invoiceNo)) return true;
  const v = inv.is_hidden ?? inv.isHidden;
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

const HIDDEN_BILL_ACCESS_ROLES = new Set(['shop_owner', 'owner', 'super_admin']);

/**
 * True only when the caller's role may see hidden bills AND explicitly asked to
 * include them (via `include_hidden` on the query, plus `_role` carrying the
 * authenticated user's role — callers must set both before trusting this).
 */
export function wantsHiddenBills(query = {}) {
  const role = String(query._role || '').toLowerCase();
  const wants = ['1', 1, true, 'true'].includes(query.include_hidden);
  return wants && HIDDEN_BILL_ACCESS_ROLES.has(role);
}

/** Invoice ids marked hidden for this shop — used to hide linked old-gold receipts/sales. */
export async function loadHiddenInvoiceIds(shopId, { transaction } = {}) {
  const { Invoice } = await import('../models/index.js');
  const rows = await Invoice.findAll({
    where: {
      [Op.and]: [
        HIDDEN_INVOICE,
        shopId ? { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] } : {},
      ],
    },
    attributes: ['id'],
    transaction,
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * Parent invoices whose lines must not count as sold: cancelled/void,
 * PRE_ACCOUNTS practice bills, TEST- numbered bills, and (unless unlocked)
 * hidden bills.
 */
export async function loadUncountableInvoiceIds(shopId, { includeHidden = false, transaction } = {}) {
  const { Invoice } = await import('../models/index.js');
  const { FINANCIAL_MODE } = await import('../services/financialMode.js');
  const or = [
    { status: { [Op.in]: [...VOID_OR_FULL_RETURN_STATUSES] } },
    { cancelled_at: { [Op.ne]: null } },
    { financial_mode: FINANCIAL_MODE.PRE_ACCOUNTS },
    { invoice_no: { [Op.like]: 'TEST-%' } },
  ];
  if (!includeHidden) or.push(HIDDEN_INVOICE);
  const rows = await Invoice.findAll({
    where: {
      [Op.and]: [
        shopId ? { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] } : {},
        { [Op.or]: or },
      ],
    },
    attributes: ['id'],
    transaction,
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * `invoice_items` has no is_hidden / cancelled / financial_mode columns —
 * Sold / Fast Moving / Top Products must drop lines whose parent invoice is
 * hidden (until unlock), cancelled, or a TEST / PRE_ACCOUNTS practice bill.
 */
export async function withNotHiddenInvoiceItems(query = {}, extra = {}, { shopId, transaction } = {}) {
  const base = extra && typeof extra === 'object' ? extra : {};
  const excluded = await loadUncountableInvoiceIds(shopId, {
    includeHidden: wantsHiddenBills(query),
    transaction,
  });
  if (!excluded.size) return base;
  const notExcluded = { invoice_id: { [Op.notIn]: [...excluded] } };
  return Object.keys(base).length ? { [Op.and]: [base, notExcluded] } : notExcluded;
}

function saleReceiptIdList(sale) {
  let ids = sale?.receipt_ids;
  if (typeof ids === 'string') {
    try { ids = JSON.parse(ids); } catch { return []; }
  }
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

/**
 * Journal `source_id` values that must drop out of GL while hidden bills are
 * locked: the hidden invoices themselves, their old-gold receipts, and any
 * OldGoldSale/disposal whose lots came from those receipts (cash/UPI/bank
 * conversion of hidden gold).
 */
export async function expandHiddenLinkedSourceIds(shopId, hiddenInvoiceIds, { transaction } = {}) {
  const invoiceIds = [...new Set((hiddenInvoiceIds || []).filter(Boolean))];
  if (!invoiceIds.length) return [];
  const { OldGoldReceipt, OldGoldSale } = await import('../models/index.js');
  const receipts = await OldGoldReceipt.findAll({
    where: {
      invoice_id: { [Op.in]: invoiceIds },
      ...(shopId ? { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] } : {}),
    },
    attributes: ['id'],
    transaction,
  }).catch(() => []);
  const receiptIds = (receipts || []).map((r) => r.id).filter(Boolean);
  const receiptSet = new Set(receiptIds);
  const sales = receiptSet.size
    ? await OldGoldSale.findAll({
      where: shopId ? { [Op.or]: [{ shop_id: shopId }, { shop_id: null }] } : {},
      attributes: ['id', 'receipt_ids'],
      transaction,
    }).catch(() => [])
    : [];
  const saleIds = [];
  for (const s of sales || []) {
    if (saleReceiptIdList(s).some((id) => receiptSet.has(id))) saleIds.push(s.id);
  }
  return [...new Set([...invoiceIds, ...receiptIds, ...saleIds])];
}
