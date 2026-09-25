/**
 * Bind the HTTP port before the rest of the backend finishes loading.
 * Electron health-checks this immediately; SQLite authenticate/sync can take
 * tens of seconds and must not delay "API listening".
 */
import express from 'express';
import { createServer } from './security/tlsServer.js';
import { logger } from './utils/logger.js';

export const app = express();

let bootReady = false;

export function isBootReady() {
  return bootReady;
}

export function markBootReady() {
  bootReady = true;
}

app.get('/api/health', (req, res, next) => {
  if (bootReady) return next();
  return res.status(503).json({
    status: 'starting',
    ready: false,
    timestamp: new Date().toISOString(),
  });
});

export const PORT = Number(process.env.PORT || 8080);
export const LISTEN_HOST = process.env.LISTEN_HOST || '0.0.0.0';

const created = createServer(app);
export const server = created.server;
export const protocol = created.protocol;
export const mtls = created.mtls;
export const certs = created.certs;

let addrInUseRetries = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    addrInUseRetries += 1;
    if (addrInUseRetries > 5) {
      console.error(`[ERR] Port ${PORT} still in use after ${addrInUseRetries} retries — giving up.`);
      process.exit(1);
    }
    console.error(`[ERR] Port ${PORT} already in use. Retry ${addrInUseRetries}/5 in 2s…`);
    setTimeout(() => {
      try {
        server.listen(PORT, LISTEN_HOST);
      } catch (e) {
        console.error('[ERR] listen retry failed:', e.message);
        process.exit(1);
      }
    }, 2000);
    return;
  }
  console.error('Server error:', err);
  process.exit(1);
});

server.listen(PORT, LISTEN_HOST, () => {
  logger.info('boot', 'API listening', {
    url: `${protocol}://${LISTEN_HOST}:${PORT}`,
    mode: 'starting',
    mtls,
    log_dir: logger.getLogDir(),
  });
  console.log(`API listening on ${protocol}://${LISTEN_HOST}:${PORT}`);
  if (certs?.note) console.log(`[security] ${certs.note}`);
  if (LISTEN_HOST === '0.0.0.0') {
    console.warn('[security] Listening on 0.0.0.0 — use OS firewall; do NOT expose ERP port to the public internet.');
  }
});
