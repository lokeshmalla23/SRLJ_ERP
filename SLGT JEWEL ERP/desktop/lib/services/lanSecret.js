'use strict';
/**
 * Shop-specific LAN HMAC secret — generated on host, stored via Electron safeStorage.
 * Never falls back to a hardcoded default.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');

function secretPath(userDataPath) {
  return path.join(userDataPath, 'secure', 'lan-shared-key.enc');
}

function encrypt(plain) {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(String(plain)).toString('base64');
  }
  // Fallback when OS encryption unavailable (dev VMs): still not a shared default
  return Buffer.from(String(plain), 'utf8').toString('base64');
}

function decrypt(encoded) {
  const buf = Buffer.from(String(encoded), 'base64');
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.decryptString(buf);
  }
  return buf.toString('utf8');
}

function loadLanSharedKey(userDataPath) {
  try {
    const p = secretPath(userDataPath);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return null;
    const secret = decrypt(raw);
    return secret && secret.length >= 32 ? secret : null;
  } catch {
    return null;
  }
}

function saveLanSharedKey(userDataPath, secret) {
  if (!secret || String(secret).length < 32) {
    throw new Error('LAN shared key must be at least 32 characters');
  }
  const dir = path.dirname(secretPath(userDataPath));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(secretPath(userDataPath), encrypt(secret), { mode: 0o600 });
  return secret;
}

/** Host: load or generate a new shop secret. */
function ensureLanSharedKey(userDataPath, preferred = null) {
  const existing = loadLanSharedKey(userDataPath);
  if (existing) return existing;
  if (preferred && String(preferred).length >= 32) {
    return saveLanSharedKey(userDataPath, preferred);
  }
  const generated = crypto.randomBytes(32).toString('hex');
  return saveLanSharedKey(userDataPath, generated);
}

/** Client: store secret received from authorized pairing/bootstrap. */
function adoptLanSharedKey(userDataPath, secret) {
  if (!secret) return null;
  return saveLanSharedKey(userDataPath, secret);
}

function fingerprint(secret) {
  if (!secret) return null;
  return crypto.createHash('sha256').update(String(secret)).digest('hex').slice(0, 12);
}

module.exports = {
  loadLanSharedKey,
  saveLanSharedKey,
  ensureLanSharedKey,
  adoptLanSharedKey,
  fingerprint,
};
