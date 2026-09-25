/**
 * SQLite often returns JSON columns as strings.
 * Use these helpers before .map / .reduce / object spread.
 */

export function asObject(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  return fallback;
}

export function asArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch { /* ignore */ }
  }
  return fallback;
}
