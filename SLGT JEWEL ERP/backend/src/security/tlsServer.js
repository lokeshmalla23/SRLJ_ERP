/**
 * Start HTTPS (TLS / optional mTLS) when certs configured; else HTTP.
 * Host must not be exposed to the public internet — bind LAN + OS firewall.
 */
import http from 'http';
import https from 'https';
import { loadTlsOptions, ensureDeviceKeyMaterial } from './deviceCerts.js';

export function createServer(app) {
  const tls = loadTlsOptions();
  let material = { note: 'skipped' };
  try {
    material = ensureDeviceKeyMaterial();
  } catch (err) {
    // HTTP mode must still boot when Program Files is not writable
    console.warn('[security] ensureDeviceKeyMaterial failed (continuing HTTP):', err.message);
  }

  if (tls) {
    const server = https.createServer(tls, app);
    return {
      server,
      protocol: 'https',
      mtls: Boolean(tls.requestCert),
      certs: material,
    };
  }

  if (process.env.TLS_REQUIRED === 'true' || process.env.TLS_REQUIRED === '1') {
    throw new Error('TLS_REQUIRED=true but TLS_CERT_PATH / TLS_KEY_PATH not configured');
  }

  console.warn(
    '[security] LAN TLS not configured — set TLS_CERT_PATH + TLS_KEY_PATH (and TLS_MTLS=true for mTLS). HTTP allowed for local bootstrap only.'
  );
  return {
    server: http.createServer(app),
    protocol: 'http',
    mtls: false,
    certs: material,
  };
}

/** Middleware: when mTLS enabled, require authenticated client cert. */
export function requireClientCert(req, res, next) {
  if (process.env.TLS_MTLS !== 'true' && process.env.TLS_MTLS !== '1') return next();
  const cert = req.socket?.getPeerCertificate?.();
  if (!cert || !cert.subject) {
    return res.status(401).json({
      detail: 'Client certificate required (mTLS)',
      code: 'MTLS_REQUIRED',
    });
  }
  req.deviceCert = cert;
  return next();
}
