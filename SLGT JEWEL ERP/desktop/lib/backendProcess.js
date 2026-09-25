'use strict';
/**
 * Manages the backend Express server as a child process.
 * Includes crash watchdog: bounded restart with exponential backoff.
 */
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const deskLog = require('./logger');
const { isDevMode, resolveBackendDir } = require('./runMode');

let backendProc = null;
let _port = 8080;
let _ready = false;
let _intentionalStop = false;
let _startOpts = null;
let _restartTimer = null;
let _restartCount = 0;
let _restartWindowStart = 0;
let _onEvent = null; // (event, payload) => void
let _onLog = null;
let _startInFlight = null;

const MAX_RESTARTS_PER_WINDOW = 5;
const RESTART_WINDOW_MS = 10 * 60 * 1000;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

function resolveNodeBin() {
  if (!require('./runMode').isPackagedApp()) return 'node';
  const bundled = path.join(process.resourcesPath || '', 'node', 'node.exe');
  if (fs.existsSync(bundled)) return bundled;
  return 'node';
}

function emit(event, payload = {}) {
  try {
    if (typeof _onEvent === 'function') _onEvent(event, payload);
  } catch { /* */ }
  console.log(`[backendProcess] event=${event}`, payload);
}

function pollHealth(port, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function attempt() {
      if (!backendProc || backendProc.killed || backendProc.exitCode != null) {
        return reject(new Error('Backend process exited before becoming ready'));
      }
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          if (res.statusCode === 200) return resolve(true);
          retry();
        });
      });
      req.on('error', retry);
      req.setTimeout(1500, () => { req.destroy(); retry(); });
    }
    function retry() {
      if (Date.now() >= deadline) return reject(new Error('Backend did not start in time'));
      setTimeout(attempt, 500);
    }
    attempt();
  });
}

function findListeningPids(port) {
  return new Promise((resolve) => {
    execFile('netstat', ['-ano'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve([]);
      const pids = new Set();
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const m = line.match(new RegExp(`[:.]${port}\\s+.*LISTENING\\s+(\\d+)`, 'i'));
        if (m && m[1] && m[1] !== '0') pids.add(m[1]);
      }
      resolve([...pids]);
    });
  });
}

function killPid(pid) {
  return new Promise((resolve) => {
    execFile('taskkill', ['/F', '/PID', String(pid)], { windowsHide: true, timeout: 5000 }, () => resolve());
  });
}

async function freePort(port) {
  const deadline = Date.now() + 8000;
  try {
    // Prefer stopping our own child cleanly before sweeping the port
    if (backendProc && backendProc.pid) {
      try {
        backendProc.kill('SIGTERM');
      } catch { /* */ }
      await new Promise((r) => setTimeout(r, 500));
    }

    let pids = await findListeningPids(port);
    for (const pid of pids) {
      if (Number(pid) === process.pid) continue;
      console.log(`[backendProcess] Killing PID ${pid} on :${port}`);
      await killPid(pid);
    }
    if (pids.length) await new Promise((r) => setTimeout(r, 600));

    // Wait until the OS actually releases the listen socket
    while (Date.now() < deadline) {
      const still = await findListeningPids(port);
      const foreign = still.filter((pid) => Number(pid) !== process.pid);
      if (!foreign.length) break;
      for (const pid of foreign) {
        console.log(`[backendProcess] Port :${port} still held by PID ${pid} — retry kill`);
        await killPid(pid);
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  } catch (err) {
    console.warn('[backendProcess] freePort error:', err.message);
  }
}

function buildEnv(opts) {
  const {
    port = 8080,
    shopId = null,
    sqlitePath = null,
    deviceNumber = 1,
    deviceId = null,
    branchRole = 'active_host',
  } = opts;

  const backendDir = resolveBackendDir();
  const env = {
    ...process.env,
    PORT: String(port),
    LISTEN_HOST: '0.0.0.0',
    APP_MODE: 'branch',
    ELECTRON_RUN: '1',
  };

  const envFile = path.join(backendDir, '.env');
  const skipEnvKeys = new Set(['DATABASE_URL', 'DB_SSL', 'PORT', 'LISTEN_HOST', 'APP_MODE']);
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!key || skipEnvKeys.has(key)) continue;
      if (!(key in env)) env[key] = val;
    }
  }

  if (shopId) env.SHOP_ID = shopId;
  if (sqlitePath) env.SQLITE_PATH = sqlitePath;
  if (deviceId) env.DEVICE_ID = deviceId;
  env.DEVICE_NUMBER = String(deviceNumber || 1);
  env.BRANCH_ROLE = branchRole === 'active_host' ? 'active_host' : 'client';
  try {
    const { app } = require('electron');
    env.ELECTRON_USERDATA = app.getPath('userData');
  } catch { /* */ }

  delete env.DATABASE_URL;
  delete env.DB_SSL;
  delete env.NEON_DATABASE_URL;
  delete env.CLOUD_ENDPOINT;
  delete env.CLOUD_API_URL;
  env.USE_CLOUD_DB = '0';
  env.LOG_LEVEL = env.LOG_LEVEL || 'debug';
  env.LOG_TO_FILE = env.LOG_TO_FILE || '1';
  env.LOG_SQL = env.LOG_SQL || '1';
  if (env.ELECTRON_USERDATA) {
    env.LOG_DIR = path.join(env.ELECTRON_USERDATA, 'logs');
    // Never write under Program Files (EPERM for normal users)
    env.TLS_CERT_DIR = env.TLS_CERT_DIR || path.join(env.ELECTRON_USERDATA, 'certs');
    env.BRANCH_CONFIG_PATH = env.BRANCH_CONFIG_PATH || path.join(env.ELECTRON_USERDATA, 'config', 'branch.json');
    env.BACKUP_DIR = env.BACKUP_DIR || path.join(env.ELECTRON_USERDATA, 'backups');
    env.RECOVERY_DIR = env.RECOVERY_DIR || path.join(env.ELECTRON_USERDATA, 'recovery');
  }

  if (!env.JWT_SECRET) {
    try {
      const { app } = require('electron');
      const secretFile = path.join(app.getPath('userData'), 'secure', 'jwt-secret.txt');
      const secretDir = path.dirname(secretFile);
      if (!fs.existsSync(secretDir)) fs.mkdirSync(secretDir, { recursive: true });
      if (fs.existsSync(secretFile)) {
        env.JWT_SECRET = fs.readFileSync(secretFile, 'utf8').trim();
      } else {
        const crypto = require('crypto');
        env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(secretFile, env.JWT_SECRET, { mode: 0o600 });
      }
    } catch {
      env.JWT_SECRET = 'local-dev-jwt-change-me';
    }
  }

  const nodePaths = [
    path.join(backendDir, 'node_modules'),
    path.join(path.dirname(backendDir), 'shared', 'node_modules'),
  ].filter((p) => fs.existsSync(p));
  if (nodePaths.length) {
    env.NODE_PATH = [env.NODE_PATH, ...nodePaths].filter(Boolean).join(path.delimiter);
  }
  return { env, backendDir };
}

function scheduleRestart(code, signal) {
  if (_intentionalStop || !_startOpts) return;

  const now = Date.now();
  if (!_restartWindowStart || now - _restartWindowStart > RESTART_WINDOW_MS) {
    _restartWindowStart = now;
    _restartCount = 0;
  }
  _restartCount += 1;

  if (_restartCount > MAX_RESTARTS_PER_WINDOW) {
    emit('backend:failed', {
      reason: 'restart_limit',
      restarts: _restartCount,
      code,
      signal,
    });
    console.error(`[backendProcess] Restart limit exceeded — giving up`);
    return;
  }

  const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * (2 ** (_restartCount - 1)));
  emit('backend:restarting', { attempt: _restartCount, delayMs: delay, code, signal });
  console.warn(`[backendProcess] Unexpected exit — restarting in ${delay}ms (attempt ${_restartCount}/${MAX_RESTARTS_PER_WINDOW})`);

  if (_restartTimer) clearTimeout(_restartTimer);
  _restartTimer = setTimeout(async () => {
    _restartTimer = null;
    if (_intentionalStop) return;
    try {
      await start({ ..._startOpts, onLog: _onLog, onEvent: _onEvent, _fromWatchdog: true });
      emit('backend:ready', { port: _port, recovered: true });
    } catch (err) {
      console.error('[backendProcess] Watchdog restart failed:', err.message);
      scheduleRestart(null, 'restart_failed');
    }
  }, delay);
}

async function start(opts = {}) {
  // Only one backend child may exist — coalesce concurrent start() calls.
  if (backendProc) return { port: _port };
  if (_startInFlight) return _startInFlight;

  _startInFlight = startExclusive(opts).finally(() => {
    _startInFlight = null;
  });
  return _startInFlight;
}

async function startExclusive(opts = {}) {
  const {
    port = 8080,
    onLog = null,
    onEvent = null,
    _fromWatchdog = false,
  } = opts;

  if (onEvent) _onEvent = onEvent;
  if (onLog) _onLog = onLog;

  if (!_fromWatchdog) {
    _intentionalStop = false;
    _startOpts = { ...opts };
    delete _startOpts._fromWatchdog;
    delete _startOpts.onLog;
    delete _startOpts.onEvent;
  }

  if (backendProc) return { port: _port };
  _port = port;
  _ready = false;

  console.log(`[backendProcess] Freeing port ${port}…`);
  await freePort(port);
  await new Promise((r) => setTimeout(r, 400));

  const branchRole = opts.branchRole || _startOpts?.branchRole || 'active_host';
  console.log(`[backendProcess] Spawning backend on :${port} role=${branchRole}`);

  const mergeOpts = { ...(_startOpts || {}), ...opts, port };
  const { env, backendDir } = buildEnv(mergeOpts);
  const nodeBin = resolveNodeBin();
  const entryPoint = path.join(backendDir, 'src', 'index.js');
  if (!fs.existsSync(entryPoint)) {
    throw new Error(`Backend entry not found: ${entryPoint}`);
  }

  backendProc = spawn(nodeBin, isDevMode() ? ['--watch', 'src/index.js'] : ['src/index.js'], {
    cwd: backendDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let sawListening = false;
  let lastOutputAt = Date.now();
  backendProc.stdout.on('data', (data) => {
    lastOutputAt = Date.now();
    const line = data.toString().trim();
    if (line.includes('API listening')) sawListening = true;
    deskLog.info('backend', line);
    if (_onLog) _onLog(line);
    else console.log('[backend]', line);
  });

  backendProc.stderr.on('data', (data) => {
    lastOutputAt = Date.now();
    const line = data.toString().trim();
    deskLog.error('backend', line);
    if (_onLog) _onLog('[ERR] ' + line);
    else console.error('[backend]', line);
  });

  backendProc.on('exit', (code, signal) => {
    deskLog.warn('backend', 'process exited', { code, signal, intentional: _intentionalStop });
    console.log(`[backendProcess] exited code=${code} signal=${signal} intentional=${_intentionalStop}`);
    backendProc = null;
    _ready = false;
    if (!_intentionalStop) scheduleRestart(code, signal);
  });

  try {
    const BOOT_STALL_MS = 90000;
    const BOOT_MAX_MS = 180000;
    const bootStarted = Date.now();
    while (!sawListening) {
      if (!backendProc || backendProc.exitCode != null) {
        throw new Error('Backend process exited before listening');
      }
      const now = Date.now();
      if (now - lastOutputAt > BOOT_STALL_MS) {
        throw new Error('Backend did not start in time (no output)');
      }
      if (now - bootStarted > BOOT_MAX_MS) {
        throw new Error('Backend did not start in time');
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    await pollHealth(port, 120000);
    _ready = true;
    console.log(`[backendProcess] ready on :${port}`);
    if (!_fromWatchdog) emit('backend:ready', { port });
  } catch (err) {
    // Do not SIGTERM a child that is still booting — that is what caused the
    // restart loop (health timed out → kill → watchdog spawn → timeout).
    if (backendProc && backendProc.exitCode == null) {
      deskLog.warn('backend', 'ready check timed out — keeping process, polling in background', {
        error: err.message,
      });
      console.warn(`[backendProcess] ${err.message} — process still running, waiting in background`);
      pollHealth(port, 180000).then(() => {
        _ready = true;
        console.log(`[backendProcess] ready on :${port} (delayed)`);
        emit('backend:ready', { port, delayed: true });
      }).catch((e) => {
        deskLog.error('backend', 'background ready check failed', { error: e.message });
        emit('backend:failed', { reason: 'start_timeout', error: e.message });
      });
      return { port, pending: true };
    }
    _intentionalStop = true;
    await stop();
    throw err;
  }

  return { port };
}

/**
 * Stop the backend child process and resolve once it has actually exited
 * (bounded by a hard cap) rather than guessing with a fixed delay — callers
 * that need the SQLite file handle released (factory reset, DB replace)
 * must know the process is really gone, not just "probably gone by now".
 */
function stop() {
  _intentionalStop = true;
  _startInFlight = null;
  if (_restartTimer) {
    clearTimeout(_restartTimer);
    _restartTimer = null;
  }
  if (!backendProc) {
    _ready = false;
    return Promise.resolve();
  }
  const proc = backendProc;
  const pid = proc.pid;
  backendProc = null;
  _ready = false;
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    proc.once('exit', finish);
    try {
      proc.kill('SIGTERM');
    } catch (_) { /* */ }
    // Windows: kill the whole process tree (node + children) so Task Manager
    // does not keep orphan JewelleryCRM/node processes after close.
    if (process.platform === 'win32' && pid) {
      execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 5000 }, () => {});
    }
    setTimeout(() => {
      try {
        if (proc.exitCode == null && !proc.killed) proc.kill('SIGKILL');
      } catch (_) { /* */ }
      if (process.platform === 'win32' && pid) {
        execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 5000 }, () => {});
      }
    }, 1500);
    setTimeout(finish, 4000);
  });
}

function isReady() { return _ready; }
function getPort() { return _port; }
function getWatchdogStatus() {
  return {
    ready: _ready,
    intentionalStop: _intentionalStop,
    restartCount: _restartCount,
    maxRestarts: MAX_RESTARTS_PER_WINDOW,
  };
}

module.exports = { start, stop, isReady, getPort, getWatchdogStatus };
