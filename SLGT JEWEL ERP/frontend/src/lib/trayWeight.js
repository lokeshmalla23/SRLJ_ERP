/** Tray unit: gross/net weight fields aren't collected per-piece — the tray's
 * own remaining weight (already reduced by every sale) is the real figure. */
export const isTrayProduct = (p) =>
  p?.unit_code === "tray" || p?.unitCode === "tray"
  || (Number(p?.tray_total_weight ?? p?.trayTotalWeight) > 0 && !p?.unit_code && !p?.unitCode);

function pickWeight(p, snake, camel) {
  const raw = p?.[snake] ?? p?.[camel];
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
}

/** Weights printed on the jewellery barcode tag after create or edit. */
export function trayLabelWeights(p) {
  const stone = pickWeight(p, "stone_weight", "stoneWeight");
  if (isTrayProduct(p)) {
    const tray = pickWeight(p, "tray_total_weight", "trayTotalWeight");
    if (tray > 0) {
      return { gross: tray, net: tray, stone: stone > 0 ? stone : 0 };
    }
  }
  return {
    gross: pickWeight(p, "gross_weight", "grossWeight"),
    net: pickWeight(p, "net_weight", "netWeight"),
    stone: stone > 0 ? stone : 0,
  };
}

/** Weight to count toward gross/net totals — tray's pooled weight as-is, else per-piece × qty. */
export const weightContribution = (p, field) => {
  if (isTrayProduct(p)) return Number(p.tray_total_weight ?? p.trayTotalWeight) || 0;
  return (Number(p[field]) || 0) * (Number(p.stock_qty) || 0);
};
