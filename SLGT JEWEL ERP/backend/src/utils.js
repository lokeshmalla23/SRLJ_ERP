import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import 'dotenv/config';

let argon2 = null;
try {
  argon2 = await import('argon2');
} catch {
  console.warn('[security] argon2 not installed — falling back to bcrypt for password hashing');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export const newId = () => uuidv4();

export const nowIso = () => new Date().toISOString();

/** Next per-shop running number for models with a `serial_no` column (e.g. customers, schemes). */
export async function nextShopSerial(Model, shopId, transaction) {
  const last = await Model.max('serial_no', { where: { shop_id: shopId }, transaction });
  return (Number(last) || 0) + 1;
}

/** Prefer Argon2id; bcrypt for environments without the native module. */
export const hashPassword = async (pw) => {
  if (argon2?.hash) {
    return argon2.hash(pw, { type: argon2.argon2id });
  }
  return bcrypt.hash(pw, 12);
};

export const verifyPassword = async (pw, hash) => {
  if (pw == null || hash == null || hash === '') return false;
  if (typeof hash === 'string' && hash.startsWith('$argon2') && argon2?.verify) {
    try {
      return await argon2.verify(hash, pw);
    } catch {
      return false;
    }
  }
  return bcrypt.compare(pw, hash);
};

/** Parse JSONB fields that SQLite may return as TEXT strings. */
export function parseJsonField(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * A filter query param may arrive as a single id, a comma-separated list of
 * ids (multi-select filters send `"1,2,3"`), or an array (`field[]=1&field[]=2`
 * style). Normalizes all three to an array, or null if nothing was sent.
 */
export function parseMultiParam(raw) {
  if (raw == null || raw === '') return null;
  const arr = Array.isArray(raw) ? raw : String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : null;
}

export function normalizeJsonFields(row, spec) {
  if (!row) return row;
  const out = { ...row };
  for (const [key, fallback] of Object.entries(spec)) {
    out[key] = parseJsonField(out[key], fallback);
  }
  return out;
}

export const createToken = (userId, email, { deviceId = null } = {}) => {
  const payload = { sub: userId, email, type: 'access' };
  if (deviceId) payload.device_id = String(deviceId);
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });
};

export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

// Re-export constants for backward compatibility with any remaining imports
export { ROLES, MODULES, ACTIONS, defaultPermissionsForRole } from './constants.js';
