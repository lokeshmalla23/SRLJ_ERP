'use strict';
/**
 * Device Identity — Phase 15
 *
 * Each JewelleryCRM installation gets a stable, shop-scoped device identity:
 *   - device_id:     UUID generated on first run, stored in config
 *   - key_pair:      ECDH P-256 key pair, private key encrypted with Electron safeStorage
 *                    (Windows: DPAPI; macOS: Keychain; Linux: libsecret / fallback)
 *
 * The public key is registered with the cloud device registry so the cloud can verify
 * device-signed messages. The private key never leaves the machine.
 *
 * LAN shared key: derived from the shop_id and a cloud-provisioned shared secret.
 * Stored encrypted via safeStorage.
 *
 * Usage:
 *   const identity = await deviceIdentity.ensureIdentity(userDataPath, config);
 *   // identity: { deviceId, publicKeyPem, hasPrivateKey, deviceName }
 */

const { randomUUID, generateKeyPairSync, createSign, createVerify } = require('crypto');
const { safeStorage }  = require('electron');
const path             = require('path');
const fs               = require('fs');

const KEY_FILE_NAME = 'device-identity.enc';

function keyFilePath(userDataPath) {
  return path.join(userDataPath, KEY_FILE_NAME);
}

/**
 * Generate a new ECDH P-256 key pair.
 */
function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding:  { type: 'spki',  format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/**
 * Encrypt private key PEM using Electron safeStorage (OS keychain).
 * Falls back to base64-only storage if safeStorage is unavailable (dev/test).
 */
function encryptPrivateKey(pem) {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(pem).toString('base64');
  }
  // Fallback: store as base64 without OS encryption (dev mode warning)
  console.warn('[deviceIdentity] safeStorage unavailable — private key stored unencrypted');
  return Buffer.from(pem).toString('base64');
}

function decryptPrivateKey(encrypted) {
  try {
    const buf = Buffer.from(encrypted, 'base64');
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buf);
    }
    return buf.toString('utf8');
  } catch (err) {
    console.error('[deviceIdentity] Failed to decrypt private key:', err.message);
    return null;
  }
}

/**
 * Load or create device identity.
 * Saves encrypted key material to userDataPath/device-identity.enc.
 * Device ID is stored in the app config (loadConfig/saveConfig).
 *
 * @param {string} userDataPath
 * @param {{ device_id?, device_name?, shop_id? }} cfg  — current app config
 * @param {function} saveConfig  — saves config patches
 * @returns {{ deviceId, publicKeyPem, deviceName, shopId }}
 */
async function ensureIdentity(userDataPath, cfg, saveConfig) {
  const filePath = keyFilePath(userDataPath);

  let deviceId    = cfg.device_id   || null;
  let deviceName  = cfg.device_name || `Device-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  let publicKeyPem;
  let encryptedPriv;

  if (fs.existsSync(filePath)) {
    // Load existing key material
    try {
      const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      publicKeyPem  = stored.publicKeyPem;
      encryptedPriv = stored.encryptedPrivateKey;
      // Verify we can decrypt (smoke test)
      const priv = decryptPrivateKey(encryptedPriv);
      if (!priv) throw new Error('Decryption returned null');
    } catch (err) {
      console.warn('[deviceIdentity] Key file corrupt — regenerating:', err.message);
      fs.unlinkSync(filePath);
      publicKeyPem  = null;
      encryptedPriv = null;
    }
  }

  if (!publicKeyPem || !encryptedPriv) {
    // Generate fresh key pair
    const { privateKeyPem, publicKeyPem: pub } = generateKeyPair();
    publicKeyPem  = pub;
    encryptedPriv = encryptPrivateKey(privateKeyPem);

    fs.writeFileSync(filePath, JSON.stringify({
      publicKeyPem,
      encryptedPrivateKey: encryptedPriv,
      generatedAt: new Date().toISOString(),
    }), 'utf8');
  }

  // Ensure device_id in config
  if (!deviceId) {
    deviceId = randomUUID();
    await saveConfig({ device_id: deviceId, device_name: deviceName });
  }

  return { deviceId, publicKeyPem, deviceName, shopId: cfg.shop_id || null };
}

/**
 * Sign a message with this device's private key (for cloud registration / device auth).
 * @param {string} userDataPath
 * @param {string} message
 * @returns {string} base64 signature
 */
function signMessage(userDataPath, message) {
  try {
    const filePath = keyFilePath(userDataPath);
    if (!fs.existsSync(filePath)) return null;
    const stored  = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const privPem = decryptPrivateKey(stored.encryptedPrivateKey);
    if (!privPem) return null;
    const sign = createSign('SHA256');
    sign.update(message);
    return sign.sign({ key: privPem, format: 'pem', type: 'pkcs8' }, 'base64');
  } catch (err) {
    console.error('[deviceIdentity] signMessage failed:', err.message);
    return null;
  }
}

/**
 * Verify a message signed by another device using its public key PEM.
 */
function verifyMessage(message, signatureBase64, publicKeyPem) {
  try {
    const verify = createVerify('SHA256');
    verify.update(message);
    return verify.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

module.exports = { ensureIdentity, signMessage, verifyMessage };
