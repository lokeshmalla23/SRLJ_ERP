/**
 * Shop-specific LAN coordination secret (HMAC).
 * Generated once on the host; distributed only via authorized pairing/bootstrap.
 * Never logged in full.
 */
import crypto from 'crypto';
import { Setting } from '../models/index.js';
import { newId } from '../utils.js';
import { getDefaultShopId } from './defaultShop.js';

const SETTING_KEY = 'lan_coordination_secret';

export async function getLanSharedSecret(shopId = null) {
  const row = await Setting.findOne({ where: { key: SETTING_KEY } });
  const secret = row?.value?.secret;
  return typeof secret === 'string' && secret.length >= 32 ? secret : null;
}

/**
 * Ensure a cryptographically strong shop secret exists (host bootstrap / seed).
 */
export async function ensureLanSharedSecret(shopId = null) {
  const sid = shopId || (await getDefaultShopId().catch(() => null));
  const existing = await getLanSharedSecret(sid);
  if (existing) return existing;

  const secret = crypto.randomBytes(32).toString('hex');
  const row = await Setting.findOne({ where: { key: SETTING_KEY } });
  if (row) {
    await row.update({
      value: { secret, created_at: new Date().toISOString() },
      ...(sid ? { shop_id: sid } : {}),
    });
  } else {
    await Setting.create({
      id: newId(),
      key: SETTING_KEY,
      shop_id: sid || null,
      value: { secret, created_at: new Date().toISOString() },
    });
  }
  return secret;
}

/** Redacted fingerprint for diagnostics (never the raw secret). */
export function lanSecretFingerprint(secret) {
  if (!secret) return null;
  return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 12);
}
