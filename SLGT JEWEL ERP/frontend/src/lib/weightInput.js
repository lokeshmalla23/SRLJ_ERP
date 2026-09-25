import { sanitizeMoneyDraft } from "./moneyInput.js";

/** Grams throughout the ERP — never more than 3 decimal places. */
export const WEIGHT_DECIMALS = 3;

/**
 * Round using the 4th digit to the right of the decimal:
 * 0–4 keep the 3rd digit; 5–9 add 1 to the 3rd digit; then drop extras.
 * Digit-string math so 1.2356 → 1.236 and 1.2354 → 1.235.
 */
export function roundWeightByFourthDigit(value, decimals = WEIGHT_DECIMALS) {
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

export function roundWeight(value, decimals = WEIGHT_DECIMALS) {
  return roundWeightByFourthDigit(value, decimals);
}

function formatWeightDraft(n) {
  if (!Number.isFinite(n)) return "0";
  const neg = n < 0;
  const abs = Math.abs(n);
  const [whole, frac = ""] = abs.toFixed(WEIGHT_DECIMALS).split(".");
  const trimmed = frac.replace(/0+$/, "");
  const body = trimmed ? `${Number(whole)}.${trimmed}` : String(Number(whole));
  return `${neg ? "-" : ""}${body}`;
}

/** Display grams with at most 3 decimals — never IEEE leftovers like 7.2010000000000005. */
export function formatWeight(value) {
  if (value == null || value === "") return "";
  const n = roundWeight(value);
  if (!Number.isFinite(n)) return "";
  return formatWeightDraft(n);
}

export function sanitizeWeightDraft(value, { allowNegative = false } = {}) {
  const raw = sanitizeMoneyDraft(value, {
    allowNegative,
    maximumFractionDigits: 12,
  });
  const dot = raw.indexOf(".");
  if (dot < 0) return raw;
  const fraction = raw.slice(dot + 1);
  if (fraction.length <= WEIGHT_DECIMALS) return raw;
  return formatWeightDraft(roundWeightByFourthDigit(raw));
}

export function parseWeightInput(value, fallback = 0) {
  const raw = String(value ?? "").trim();
  if (raw === "" || raw === "." || raw === "-") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
