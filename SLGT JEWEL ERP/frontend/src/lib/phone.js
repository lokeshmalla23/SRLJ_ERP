// Indian mobile-number normalization — a single source of truth so every
// caller (Quotations WhatsApp share, future POS/Customers use) treats
// "9876543210", "+919876543210", "919876543210" identically and never
// produces a duplicated country code like "+91+919876543210".

/**
 * Normalizes a raw Indian mobile number to strict "91XXXXXXXXXX" (12 digits,
 * no "+", no spaces). Returns null if the input can't be resolved to a valid
 * 10-digit Indian mobile number (which start with 6-9).
 */
export function normalizeIndianMobile(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // Collapse any repeated/duplicated leading "91" country codes, e.g. an
  // accidental "+91+919876543210" or "91919876543210" paste.
  while (digits.length > 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }
  // Strip a leading domestic trunk "0" (e.g. "09876543210").
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  if (digits.length === 10) {
    digits = `91${digits}`;
  }

  if (digits.length !== 12 || !digits.startsWith("91")) return null;
  const local = digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(local)) return null;
  return digits;
}

/** Human-readable "+91 98765 43210" form for display, or the raw input if invalid. */
export function formatIndianMobileDisplay(raw) {
  const normalized = normalizeIndianMobile(raw);
  if (!normalized) return raw || "";
  return `+91 ${normalized.slice(2, 7)} ${normalized.slice(7)}`;
}

/** Plain 10-digit local number (matches how mobiles are stored on Customer records). */
export function toLocalIndianMobile(raw) {
  const normalized = normalizeIndianMobile(raw);
  return normalized ? normalized.slice(2) : null;
}
