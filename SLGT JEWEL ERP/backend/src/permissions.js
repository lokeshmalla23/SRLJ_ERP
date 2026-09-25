/**
 * Canonical RBAC permission shape (persisted):
 *   { [module]: { [action]: boolean } }
 *
 * Accepts legacy shapes on read:
 *   { [module]: string[] }  — UI/array form
 *   { [module]: { [action]: boolean } }
 */

import { MODULES, ACTIONS, POS_MODE_ACTIONS } from './constants.js';

function knownActionsForModule(mod) {
  return mod === 'pos' ? [...ACTIONS, ...POS_MODE_ACTIONS] : ACTIONS;
}

/** Normalize any stored/API permissions into canonical object form. */
export function normalizePermissionsObject(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }

  const result = {};
  for (const mod of MODULES) {
    result[mod] = {};
    for (const action of knownActionsForModule(mod)) {
      result[mod][action] = false;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;

  for (const [mod, val] of Object.entries(parsed)) {
    const known = knownActionsForModule(mod);
    if (!result[mod]) {
      result[mod] = {};
      for (const action of known) result[mod][action] = false;
    }
    if (Array.isArray(val)) {
      for (const action of val) {
        if (known.includes(action)) result[mod][action] = true;
      }
    } else if (val && typeof val === 'object') {
      for (const action of known) {
        result[mod][action] = Boolean(val[action]);
      }
    }
  }

  // Legacy: pos.view users without explicit mode flags keep both billing modes
  const rawPos = parsed.pos;
  const hadExplicitModes = Array.isArray(rawPos)
    ? rawPos.some((a) => POS_MODE_ACTIONS.includes(a))
    : Boolean(rawPos && typeof rawPos === 'object' && POS_MODE_ACTIONS.some((a) => a in rawPos));
  if (result.pos?.view && !hadExplicitModes) {
    for (const action of POS_MODE_ACTIONS) result.pos[action] = true;
  }

  return result;
}

/** Convert canonical object → array form for Settings UI editing. */
export function permissionsToActionArrays(raw) {
  const obj = normalizePermissionsObject(raw);
  const result = {};
  for (const [mod, actions] of Object.entries(obj)) {
    const known = knownActionsForModule(mod);
    result[mod] = known.filter((a) => actions[a]);
  }
  return result;
}

/**
 * True if module.action is allowed.
 * Accepts either a permissions map or a user-like object ({ role, permissions }).
 * shop_owner / owner always allowed.
 */
export function hasPermission(permissionsOrUser, module, action) {
  if (permissionsOrUser && typeof permissionsOrUser === 'object' && !Array.isArray(permissionsOrUser)) {
    const role = String(permissionsOrUser.role || '').toLowerCase();
    if (role === 'shop_owner' || role === 'owner' || role === 'super_admin') return true;
    if (permissionsOrUser.permissions != null && typeof permissionsOrUser.permissions === 'object') {
      const obj = normalizePermissionsObject(permissionsOrUser.permissions);
      return Boolean(obj[module]?.[action]);
    }
  }
  const obj = normalizePermissionsObject(permissionsOrUser);
  return Boolean(obj[module]?.[action]);
}

/** Detect whether raw already matches canonical object shape for all known modules. */
export function isCanonicalPermissions(raw) {
  if (!raw || typeof raw !== 'object') return false;
  for (const mod of MODULES) {
    const val = raw[mod];
    if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
    for (const action of ACTIONS) {
      if (typeof val[action] !== 'boolean') return false;
    }
  }
  return true;
}
