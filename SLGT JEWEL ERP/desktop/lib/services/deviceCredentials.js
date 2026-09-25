/**
 * Device pairing credentials — OS-protected storage.
 *
 * Stores proof that this device was Host-approved for a shop, separate
 * from any employee session token. Uses Electron safeStorage (Windows DPAPI /
 * macOS Keychain) so the credential is machine-bound and not readable by other
 * processes or users.
 *
 * Stored fields: { shop_id, device_id, device_identifier, device_number, paired_at, device_token? }
 */

const { safeStorage, app } = require('electron');
const path = require('path');
const fs = require('fs');

const CRED_FILE = 'device-pairing.enc';

function credPath() {
  return path.join(app.getPath('userData'), CRED_FILE);
}

/**
 * Persist device approval proof to OS-protected storage.
 * @param {{ shop_id: string, device_id: string, device_identifier?: string, device_number?: number, paired_at?: string, device_token?: string }} data
 */
function save(data) {
  try {
    const existing = load() || {};
    const identifier = data.device_identifier || existing.device_identifier || data.device_id || existing.device_id;
    const json = JSON.stringify({
      shop_id: data.shop_id || existing.shop_id,
      device_id: data.device_id || existing.device_id,
      device_identifier: identifier,
      device_number: data.device_number || existing.device_number || 1,
      paired_at: data.paired_at || existing.paired_at || new Date().toISOString(),
      device_token: data.device_token || existing.device_token || null,
    });

    let stored;
    if (safeStorage.isEncryptionAvailable()) {
      stored = safeStorage.encryptString(json);
    } else {
      console.warn('[deviceCredentials] safeStorage unavailable — using base64 fallback');
      stored = Buffer.from(json, 'utf8').toString('base64');
    }

    fs.writeFileSync(credPath(), stored, { mode: 0o600 });
    console.log('[deviceCredentials] pairing credential saved');
  } catch (err) {
    console.error('[deviceCredentials] save failed:', err.message);
  }
}

/**
 * Load device approval proof from OS-protected storage.
 * @returns {{ shop_id, device_id, device_number, paired_at, device_token? } | null}
 */
function load() {
  try {
    const p = credPath();
    if (!fs.existsSync(p)) return null;

    const raw = fs.readFileSync(p);
    let json;

    if (safeStorage.isEncryptionAvailable()) {
      json = safeStorage.decryptString(raw);
    } else {
      json = Buffer.from(raw.toString('utf8'), 'base64').toString('utf8');
    }

    const parsed = JSON.parse(json);
    if (!parsed.shop_id || !(parsed.device_identifier || parsed.device_id)) return null;
    parsed.device_identifier = parsed.device_identifier || parsed.device_id;
    return parsed;
  } catch (err) {
    console.warn('[deviceCredentials] load failed (may be first run):', err.message);
    return null;
  }
}

/**
 * Remove device approval proof (factory reset / revoke).
 */
function clear() {
  try {
    const p = credPath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
    console.log('[deviceCredentials] pairing credential cleared');
  } catch (err) {
    console.warn('[deviceCredentials] clear failed:', err.message);
  }
}

module.exports = { save, load, clear };
