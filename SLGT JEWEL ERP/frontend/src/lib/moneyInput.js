export function rawMoney(value) {
  if (value == null || value === "") return "";
  return String(value).replace(/[₹,\s]/g, "");
}

export function sanitizeMoneyDraft(value, {
  allowNegative = false,
  maximumFractionDigits = 2,
} = {}) {
  let raw = rawMoney(value).replace(/[^\d.-]/g, "");
  if (!allowNegative) raw = raw.replace(/-/g, "");
  else raw = `${raw.startsWith("-") ? "-" : ""}${raw.replace(/-/g, "")}`;

  const dot = raw.indexOf(".");
  if (dot >= 0) {
    raw = `${raw.slice(0, dot + 1)}${raw.slice(dot + 1).replace(/\./g, "")}`;
    const [whole, fraction = ""] = raw.split(".");
    raw = `${whole}.${fraction.slice(0, maximumFractionDigits)}`;
  }
  return raw;
}

export function cursorTokenCount(text, position) {
  return String(text).slice(0, position).replace(/[^\d.]/g, "").length;
}

export function cursorForTokenCount(text, count) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/[\d.]/.test(text[i])) seen += 1;
    if (seen >= count) return i + 1;
  }
  return text.length;
}
