/**
 * Shared frontend permission helpers.
 * Canonical persisted shape: { [module]: { [action]: boolean } }
 * Also accepts legacy { [module]: string[] }.
 */

export function normalizePermissionsObject(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== "object") return {};
  const result = {};
  for (const [mod, val] of Object.entries(parsed)) {
    if (Array.isArray(val)) {
      result[mod] = {};
      for (const action of val) result[mod][action] = true;
    } else if (val && typeof val === "object") {
      result[mod] = { ...val };
    } else {
      result[mod] = {};
    }
  }
  return result;
}

/** UI editing form: module → allowed action names */
export function permissionsToActionArrays(raw) {
  const obj = normalizePermissionsObject(raw);
  const result = {};
  for (const [mod, actions] of Object.entries(obj)) {
    result[mod] = Object.entries(actions)
      .filter(([, v]) => Boolean(v))
      .map(([k]) => k);
  }
  return result;
}

/** Persist form: arrays → canonical object (boolean map) */
export function actionArraysToPermissionsObject(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const result = {};
  for (const [mod, val] of Object.entries(raw)) {
    if (Array.isArray(val)) {
      result[mod] = {};
      for (const action of val) result[mod][action] = true;
    } else if (val && typeof val === 'object') {
      result[mod] = { ...val };
    }
  }
  return result;
}

export function hasPermission(permissions, module, action) {
  if (!permissions) return false;
  const mod = permissions[module];
  if (!mod) return false;
  if (Array.isArray(mod)) return mod.includes(action);
  return Boolean(mod[action]);
}
