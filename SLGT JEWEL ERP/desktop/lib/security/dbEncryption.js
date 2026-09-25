/**
 * DB encryption key via Electron safeStorage (DPAPI on Windows).
 * Never store the key beside shop.db.
 *
 * Full SQLCipher requires a sqlcipher-enabled better-sqlite3 build.
 * Until then: key is provisioned for future PRAGMA key + BitLocker guidance.
 */
const { safeStorage, app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEY_FILE = 'db-key.enc';

function keyPath() {
  return path.join(app.getPath('userData'), 'secure', KEY_FILE);
}

function ensureDir() {
  const dir = path.dirname(keyPath());
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * @returns {Buffer} 32-byte key
 */
function getOrCreateDbKey() {
  ensureDir();
  const kp = keyPath();
  if (fs.existsSync(kp)) {
    const raw = fs.readFileSync(kp);
    if (safeStorage.isEncryptionAvailable()) {
      const b64 = safeStorage.decryptString(raw.toString('utf8'));
      return Buffer.from(b64, 'base64');
    }
    // Dev fallback — still not beside DB; under secure/
    return Buffer.from(raw.toString('utf8'), 'base64');
  }

  const key = crypto.randomBytes(32);
  const b64 = key.toString('base64');
  if (safeStorage.isEncryptionAvailable()) {
    const sealed = safeStorage.encryptString(b64);
    fs.writeFileSync(kp, sealed, { mode: 0o600 });
  } else {
    console.warn('[dbEncryption] safeStorage unavailable — storing key under userData/secure (enable BitLocker)');
    fs.writeFileSync(kp, b64, { mode: 0o600 });
  }
  return key;
}

/**
 * Apply encryption pragmas when SQLCipher build is present.
 * @param {import('better-sqlite3').Database} db
 */
function applyDbKey(db) {
  const key = getOrCreateDbKey();
  try {
    const hex = key.toString('hex');
    db.pragma(`key = "x'${hex}'"`);
    db.pragma('cipher_compatibility = 4');
    return { encrypted: true, via: 'sqlcipher' };
  } catch (err) {
    console.warn(
      '[dbEncryption] SQLCipher not available in this better-sqlite3 build. Rely on BitLocker + encrypted backups. Detail:',
      err.message
    );
    return { encrypted: false, via: 'none', keyProvisioned: true };
  }
}

module.exports = { getOrCreateDbKey, applyDbKey };
