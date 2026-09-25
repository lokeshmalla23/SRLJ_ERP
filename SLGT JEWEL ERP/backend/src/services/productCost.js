/**
 * Product purchase cost — the one place that knows the per-unit rules:
 *
 *  - Weight / Piece units: purchase_price is the cost of ONE piece, so
 *    stock value = purchase_price × stock_qty.
 *  - Tray unit: purchase_price is the total amount paid for the whole tray;
 *    purchase_cost_per_gram (fixed at create) = that ÷ tray weight, so
 *    stock value = purchase_cost_per_gram × remaining tray_total_weight and
 *    COGS = purchase_cost_per_gram × weight sold.
 *
 * Legacy trays saved before purchase_cost_per_gram existed have it null and
 * keep the old per-piece behavior.
 */

export function isWeightCostedTray(product) {
  return Number(product?.tray_total_weight) > 0 && Number(product?.purchase_cost_per_gram) > 0;
}

/** Total tray amount ÷ tray weight, 4 decimals; null when either is missing. */
export function trayCostPerGram(totalAmount, trayWeight) {
  const amount = Number(totalAmount);
  const weight = Number(trayWeight);
  if (!(amount > 0) || !(weight > 0)) return null;
  return Math.round((amount / weight) * 10000) / 10000;
}

/** Purchase value of the stock currently on hand for one product row. */
export function stockCostValue(product, qty = Number(product?.stock_qty) || 0) {
  if (isWeightCostedTray(product)) {
    return Number(product.purchase_cost_per_gram) * Number(product.tray_total_weight);
  }
  return (Number(product?.purchase_price) || 0) * qty;
}
