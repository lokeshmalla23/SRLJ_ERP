/** Inventory domain constants — DB-agnostic */

export const INVENTORY_MODES = Object.freeze({
  QUANTITY: 'quantity',
  UNIQUE_TAG: 'unique_tag',
});

export const MOVEMENT_TYPES = Object.freeze({
  OPENING: 'OPENING',
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  SALE_RETURN: 'SALE_RETURN',
  ADJUSTMENT_ADD: 'ADJUSTMENT_ADD',
  ADJUSTMENT_REMOVE: 'ADJUSTMENT_REMOVE',
  DAMAGE: 'DAMAGE',
  REPAIR_IN: 'REPAIR_IN',
  REPAIR_OUT: 'REPAIR_OUT',
  BOOKING_RESERVE: 'BOOKING_RESERVE',
  BOOKING_RELEASE: 'BOOKING_RELEASE',
});

export const MOVEMENT_TYPE_META = Object.freeze({
  OPENING: { qtySign: '+', description: 'Ledger baseline / opening balance at migration or product create' },
  PURCHASE: { qtySign: '+', description: 'Stock received via purchase (finished goods)' },
  SALE: { qtySign: '-', description: 'Stock sold via invoice / unique item sold' },
  SALE_RETURN: { qtySign: '+', description: 'Sale return restoring stock / unique availability' },
  ADJUSTMENT_ADD: { qtySign: '+', description: 'Manual stock increase' },
  ADJUSTMENT_REMOVE: { qtySign: '-', description: 'Manual stock decrease' },
  DAMAGE: { qtySign: '-', description: 'Damaged / written-off stock' },
  REPAIR_IN: { qtySign: '+', description: 'Item returned from repair into stock (future)' },
  REPAIR_OUT: { qtySign: '-', description: 'Item sent out for repair (future)' },
  BOOKING_RESERVE: { qtySign: '-', description: 'Tray weight/pieces carved out for a booked estimation advance' },
  BOOKING_RELEASE: { qtySign: '+', description: 'Booked estimation cancelled/expired — reserved tray weight/pieces restored' },
});

export const UNIQUE_ITEM_STATUSES = Object.freeze({
  AVAILABLE: 'available',
  ON_DISPLAY: 'on_display',
  RESERVED: 'reserved',
  ESTIMATION: 'estimation',
  SOLD: 'sold',
  DAMAGED: 'damaged',
  DELETED: 'deleted',
  DELETED_P: 'deleted_p',
});

/** Shop-floor / tag-history labels. Hidden bills use Deleted P, not Sold. */
export const PRODUCT_STATUS_LABELS = Object.freeze({
  available: 'Available',
  on_display: 'On Display',
  reserved: 'Reserved',
  estimation: 'Estimation',
  sold: 'Sold out',
  damaged: 'Damaged',
  discontinued: 'Discontinued',
  deleted: 'Deleted',
  deleted_p: 'Deleted P',
});

export function productStatusLabel(status) {
  if (!status) return '—';
  return PRODUCT_STATUS_LABELS[status] || status;
}

/** Status after a live stock sale. Hidden POS must not look like a visible sold tag. */
export function saleOutcomeStatus(isHidden) {
  return isHidden ? UNIQUE_ITEM_STATUSES.DELETED_P : UNIQUE_ITEM_STATUSES.SOLD;
}

/** Tags that must not appear in live / in-stock inventory. */
export const NOT_IN_STOCK_STATUSES = Object.freeze([
  UNIQUE_ITEM_STATUSES.SOLD,
  'discontinued',
  UNIQUE_ITEM_STATUSES.DELETED,
  UNIQUE_ITEM_STATUSES.DELETED_P,
]);

export const RESTORABLE_SALE_STATUSES = Object.freeze([
  UNIQUE_ITEM_STATUSES.SOLD,
  UNIQUE_ITEM_STATUSES.DELETED_P,
]);

export const UNIQUE_STATUS_TRANSITIONS = Object.freeze({
  available: ['on_display', 'reserved', 'estimation', 'sold', 'damaged', 'deleted', 'deleted_p'],
  on_display: ['available', 'reserved', 'estimation', 'sold', 'damaged', 'deleted', 'deleted_p'],
  reserved: ['available', 'on_display', 'sold', 'damaged', 'deleted', 'deleted_p'],
  estimation: ['available', 'sold', 'deleted_p'],
  sold: ['available'],
  deleted_p: ['available'],
  deleted: [],
  damaged: [],
});

export const SELLABLE_UNIQUE_STATUSES = Object.freeze([
  UNIQUE_ITEM_STATUSES.AVAILABLE,
  UNIQUE_ITEM_STATUSES.ON_DISPLAY,
  UNIQUE_ITEM_STATUSES.RESERVED,
  UNIQUE_ITEM_STATUSES.ESTIMATION,
]);

/** Held for a booked estimation (advance taken) — still in the shop, not free to sell. */
export const POS_HELD_STATUSES = Object.freeze([
  UNIQUE_ITEM_STATUSES.RESERVED,
  UNIQUE_ITEM_STATUSES.ESTIMATION,
]);

export const INVENTORY_PROTECTED_FIELDS = Object.freeze([
  'stock_qty',
  'status',
  'inventory_mode',
]);
