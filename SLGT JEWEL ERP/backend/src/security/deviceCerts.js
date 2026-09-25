/**
 * Per-device TLS certificates for mTLS LAN.
 * Certs/keys stored under ELECTRON_USERDATA/certs (packaged) or backend/.certs (dev).
 * Never commit private keys.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import branchConfig from '../config/branchConfig.js';
import { writablePath } from '../config/writablePaths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function certsDir() {
  if (process.env.TLS_CERT_DIR) return process.env.TLS_CERT_DIR;
  if (process.env.ELECTRON_USERDATA) return writablePath('certs');
  return path.resolve(__dirname, '../../.certs');
}

function selfSignedPem({ commonName, days = 825 }) {
  // Node 19+ has X509Certificate; generate via openssl-like self-signed using crypto
  // Use a minimal RSA self-signed cert without external deps.
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  // Without full X.509 builder in older Node, we rely on TLS_CERT_PATH / TLS_KEY_PATH when provided.
  // Fallback: generate key + CSR-like material and instruct openssl, OR use @peculiar if available.
  // Practical approach for V1: create PEM private key and a self-signed cert using crypto.X509Certificate
  // if available; else write key and skip auto-cert (HTTPS disabled until openssl run).

  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  // Try experimental self-signed via openssl CLI if present
  return { keyPem, publicKey, commonName, days };
}

/**
 * Ensure device has a keypair on disk. Full X.509 may require openssl once.
 * Must never throw in HTTP bootstrap mode — cert dir may be unavailable.
 */
export function ensureDeviceKeyMaterial() {
  const dir = certsDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.warn(`[security] certs dir unavailable (${dir}): ${err.message}`);
    return {
      keyPath: null,
      certPath: null,
      caPath: null,
      device_id: branchConfig.device_id || 'device',
      note: `Certs skipped: ${err.message}`,
    };
  }
  const id = branchConfig.device_id || 'device';
  const keyPath = path.join(dir, `${id}.key.pem`);
  const certPath = path.join(dir, `${id}.cert.pem`);
  const caPath = path.join(dir, 'shop-ca.cert.pem');

  if (!fs.existsSync(keyPath)) {
    try {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      fs.writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    } catch (err) {
      console.warn(`[security] could not write device key: ${err.message}`);
      return {
        keyPath: null,
        certPath: null,
        caPath: null,
        device_id: id,
        note: `Key write skipped: ${err.message}`,
      };
    }
  }

  return {
    keyPath,
    certPath: fs.existsSync(certPath) ? certPath : null,
    caPath: fs.existsSync(caPath) ? caPath : null,
    device_id: id,
    note: fs.existsSync(certPath)
      ? 'Device certificate present'
      : 'Private key generated. Provide TLS_CERT_PATH/TLS_KEY_PATH or run scripts/generate-shop-certs to issue X.509 for mTLS.',
  };
}

export function loadTlsOptions() {
  const keyPath = process.env.TLS_KEY_PATH;
  const certPath = process.env.TLS_CERT_PATH;
  const caPath = process.env.TLS_CA_PATH;
  const requestCert = process.env.TLS_MTLS === 'true' || process.env.TLS_MTLS === '1';

  if (keyPath && certPath && fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const opts = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
      requestCert,
      rejectUnauthorized: requestCert,
    };
    if (caPath && fs.existsSync(caPath)) {
      opts.ca = fs.readFileSync(caPath);
    }
    return opts;
  }

  // Dev/fallback: no TLS unless explicitly configured
  return null;
}
