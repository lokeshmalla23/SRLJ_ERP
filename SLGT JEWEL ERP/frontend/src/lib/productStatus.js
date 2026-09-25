/** Shop-floor / tag-history labels. Hidden bills use Deleted P, not Sold. */
export const PRODUCT_STATUS_LABELS = {
  available: "Available",
  on_display: "On Display",
  reserved: "Reserved",
  estimation: "Estimation",
  sold: "Sold out",
  damaged: "Damaged",
  discontinued: "Discontinued",
  deleted: "Deleted",
  deleted_p: "Deleted P",
};

export function productStatusLabel(status) {
  if (!status) return "—";
  return PRODUCT_STATUS_LABELS[status] || status;
}

export const NOT_IN_STOCK_STATUSES = ["sold", "discontinued", "deleted", "deleted_p"];

export function isOutOfStockProduct(p) {
  return Number(p?.stock_qty ?? 0) <= 0
    || NOT_IN_STOCK_STATUSES.includes(p?.status);
}
