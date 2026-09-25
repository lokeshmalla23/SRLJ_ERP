/**
 * Phase 1 LAN stability/security tests.
 * Run: node backend/tests/lanPhase1.test.js
 */
import 'dotenv/config';
import { createRequire } from 'module';
import { rateLimit, _resetRateLimitBucketsForTests } from '../src/middleware/rateLimit.js';
import { consumeBootstrapToken } from '../src/controllers/devices.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const require = createRequire(import.meta.url);

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

function runMiddleware(mw, req) {
  return new Promise((resolve) => {
    let status = 200;
    let body = null;
    const res = {
      setHeader() {},
      status(c) { status = c; return this; },
      json(b) { body = b; resolve({ status, body }); return this; },
    };
    mw(req, res, () => resolve({ status, body }));
  });
}

async function testRateLimit() {
  console.log('TEST rate limit → 429');
  _resetRateLimitBucketsForTests();
  const mw = rateLimit({ windowMs: 60_000, max: 3, keySuffix: 't-login' });
  const req = { ip: '10.0.0.9', path: '/login' };
  for (let i = 0; i < 3; i += 1) {
    const r = await runMiddleware(mw, req);
    assert(r.status === 200, `attempt ${i + 1} should pass`);
  }
  const blocked = await runMiddleware(mw, req);
  assert(blocked.status === 429, `expected 429 got ${blocked.status}`);
  assert(blocked.body?.code === 'RATE_LIMITED', 'RATE_LIMITED code');
  assert(/Too many attempts/i.test(blocked.body?.detail || ''), 'generic detail');
  console.log('  OK');
}

async function testBootstrapConsume() {
  console.log('TEST bootstrap token consume (one-time)');
  delete process.env.SQLITE_PATH;
  const storePath = path.join(process.cwd(), 'pairing-codes.json');
  const token = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(storePath, JSON.stringify({
    codes: {},
    tokens: {
      [token]: { shopId: 'shop-1', deviceId: 'dev-1', expiresAt: Date.now() + 60_000 },
    },
    devicePins: {},
  }), { mode: 0o600 });
  const first = consumeBootstrapToken(token);
  assert(first && first.deviceId === 'dev-1', 'first consume works');
  const second = consumeBootstrapToken(token);
  assert(second == null, 'second consume fails');
  try { fs.unlinkSync(storePath); } catch { /* */ }
  console.log('  OK');
}

async function testLanStatusNormalize() {
  console.log('TEST LAN status normalization');
  const CONNECTING = new Set(['cold_start', 'checking_last_known', 'discovering', 'verifying']);
  function norm(s, { isHostPc } = {}) {
    if (isHostPc) return 'HOST';
    const h = s?.host;
    if (h === 'connected') return 'CONNECTED';
    if (h === 'reconnecting') return 'RECONNECTING';
    if (h === 'not_found') return 'NOT_FOUND';
    if (CONNECTING.has(h)) return 'CONNECTING';
    return 'UNKNOWN';
  }
  function canWrite(st) {
    return st === 'HOST' || st === 'CONNECTED';
  }
  assert(norm({}, { isHostPc: true }) === 'HOST', 'host');
  assert(norm({ host: 'connected' }) === 'CONNECTED', 'connected');
  assert(norm({ host: 'reconnecting' }) === 'RECONNECTING', 'reconnecting');
  assert(norm({ host: 'not_found' }) === 'NOT_FOUND', 'not_found');
  assert(norm({ host: 'discovering' }) === 'CONNECTING', 'connecting');
  assert(!canWrite('NOT_FOUND'), 'block writes');
  assert(canWrite('CONNECTED'), 'allow writes');
  console.log('  OK');
}

async function testWatchdogExports() {
  console.log('TEST backendProcess watchdog exports');
  const bpCjs = require('../../desktop/lib/backendProcess.js');
  assert(typeof bpCjs.start === 'function', 'start');
  assert(typeof bpCjs.stop === 'function', 'stop');
  assert(typeof bpCjs.getWatchdogStatus === 'function', 'getWatchdogStatus');
  const st = bpCjs.getWatchdogStatus();
  assert(st.maxRestarts === 5, 'max restarts');
  console.log('  OK');
}

async function main() {
  await testRateLimit();
  await testBootstrapConsume();
  await testLanStatusNormalize();
  await testWatchdogExports();
  console.log('\nPhase 1 LAN tests passed.');
}

main().catch((err) => {
  console.error('\nFAILED:', err);
  process.exit(1);
});
