/**
 * Round grams using the 4th digit to the right of the decimal:
 * 0–4 keep the 3rd digit; 5–9 add 1 to the 3rd digit; then drop extras.
 */
export function roundWeight(value, decimals = 3) {
  const raw = String(value ?? "").trim().replace(/,/g, "");
  if (raw === "" || raw === "." || raw === "-" || raw === "-.") return 0;

  const neg = raw.startsWith("-");
  const unsigned = raw.replace(/^-/, "");
  const parts = unsigned.split(".");
  let whole = (parts[0] || "0").replace(/\D/g, "") || "0";
  const frac = (parts[1] || "").replace(/\D/g, "");

  if (frac.length <= decimals) {
    const n = Number(`${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`);
    return Number.isFinite(n) ? n : 0;
  }

  const keep = frac.slice(0, decimals).split("").map((d) => Number(d));
  const fourth = Number(frac[decimals]);
  if (fourth >= 5) {
    let i = keep.length - 1;
    keep[i] += 1;
    while (i >= 0 && keep[i] > 9) {
      keep[i] = 0;
      i -= 1;
      if (i >= 0) keep[i] += 1;
      else {
        whole = String(BigInt(whole) + 1n);
        break;
      }
    }
  }

  const n = Number(`${neg ? "-" : ""}${whole}.${keep.join("")}`);
  return Number.isFinite(n) ? n : 0;
}

/** Canonical 3-decimal gram number (kills IEEE leftovers like 7.2010000000000005). */
export function toWeightNumber(value, decimals = 3) {
  const n = roundWeight(value, decimals);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
