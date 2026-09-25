/**
 * Electron main process — Jewellery CRM desktop shell.
 * Security: contextIsolation=true, nodeIntegration=false, validated IPC only.
 */
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, globalShortcut, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');

// Allow the login-screen background music to autoplay with sound. Chromium
// normally blocks audio autoplay until the user interacts with the page;
// this app is a controlled shell (not an arbitrary website), so it's safe to
// lift that restriction. Must be set before app.whenReady().
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/** http(s) plus WhatsApp desktop protocol so Click-to-Chat can skip the browser interstitial. */
function parseAllowedExternalUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'whatsapp:') return u;
    return null;
  } catch {
    return null;
  }
}

// Packaged JewelleryCRM.exe otherwise uses AppData\Roaming\JewelleryCRM while
// `electron .` uses jewellery-crm-desktop — two SQLite files, so ERP Statement
// looks empty in the .exe. Pin both to the folder that already has shop data.
(function pinStableUserData() {
  const appData = app.getPath('appData');
  const candidates = [
    path.join(appData, 'jewellery-crm-desktop'),
    path.join(appData, 'JewelleryCRM'),
    path.join(appData, 'Jewellery CRM'),
  ];
  const dbFile = (root) => path.join(root, 'data', 'jewellery-crm.sqlite');
  const bytes = (p) => {
    try { return fs.statSync(p).size; } catch { return 0; }
  };
  let chosen = candidates[0];
  let best = -1;
  for (const root of candidates) {
    const n = bytes(dbFile(root));
    if (n > best) {
      best = n;
      chosen = root;
    }
  }
  try { fs.mkdirSync(chosen, { recursive: true }); } catch { /* */ }
  app.setName('jewellery-crm-desktop');
  app.setPath('userData', chosen);
  console.log('[main] userData', chosen);
})();

// Hard single-instance: any second .exe / shortcut / Ctrl+Shift+J launch must
// exit immediately. The primary instance focuses its existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.warn('[main] Another JewelleryCRM instance is already running — exiting this one.');
  app.quit();
  process.exit(0);
}

/** Filled in after createWindow exists — used by second-instance + hotkey. */
let focusPrimaryInstance = () => {};

// Register immediately so no second launch is missed during module load.
app.on('second-instance', () => {
  console.log('[main] Second instance attempted — focusing existing window only');
  focusPrimaryInstance();
});

const APP_WINDOW_TITLE = 'SLGT Marketing .Jewellery ERP';

const { loadConfig, saveConfig, defaultConfig } = require('./lib/config');
const backendProcess = require('./lib/backendProcess');
const runMode = require('./lib/runMode');
const {
  initLocalDb,
  shutdownLocalDb,
  backupLocalDb,
  getLocalDbStatus,
} = require('./lib/db');
const { authorityState, STATES } = require('./lib/services/authorityState');
const audit       = require('./lib/services/auditService');
const offlineAuth      = require('./lib/services/offlineAuthService');
const authorityClient  = require('./lib/services/authorityClient');
const lanCoordinator   = require('./lib/services/lanCoordinator');
const udpDiscovery     = require('./lib/services/udpDiscovery');
const deviceIdentity   = require('./lib/services/deviceIdentity');
const { LanReplicaSync } = require('./lib/services/lanReplicaSync');
const lanReplicaSync = new LanReplicaSync();
const { HostConnector } = require('./lib/services/hostConnector');
const deviceCredentials  = require('./lib/services/deviceCredentials');
const hostConnector = new HostConnector({ loadConfig, saveConfig, deviceCredentials });

// Local-only: never load cloud database URLs into the Electron process.
(function loadDesktopEnv() {
  const skipKeys = new Set([
    'DATABASE_URL',
    'NEON_DATABASE_URL',
    'DB_SSL',
    'CLOUD_ENDPOINT',
    'CLOUD_API_URL',
    'ENABLE_NEON_SYNC',
    'ENABLE_CLOUD_DB',
    'USE_CLOUD_DB',
  ]);
  const candidates = [
    path.join(__dirname, '.env'),
    typeof process.resourcesPath === 'string'
      ? path.join(process.resourcesPath, 'backend', '.env')
      : null,
  ].filter(Boolean);

  for (const envFile of candidates) {
    if (!fs.existsSync(envFile)) continue;
    try {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const idx = t.indexOf('=');
        if (idx === -1) continue;
        const key = t.slice(0, idx).trim();
        const val = t.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (!key || skipKeys.has(key)) continue;
        if (process.env[key] == null) process.env[key] = val;
      }
    } catch { /* non-fatal */ }
  }

  for (const k of skipKeys) delete process.env[k];
})();

const isDev = process.argv.includes('--dev') || process.env.ELECTRON_DEV === '1';
let mainWindow = null;
let tray = null;
let appIsQuitting = false;
let quitCleanupStarted = false;
let windowCreating = false;
/** Hidden BrowserWindow used only for HTML→image/PDF print rendering. */
let sharedPrintWindow = null;

function destroySharedPrintWindow() {
  const win = sharedPrintWindow;
  sharedPrintWindow = null;
  if (win && !win.isDestroyed()) {
    try { win.destroy(); } catch { /* */ }
  }
}

function createSharedPrintWindow() {
  sharedPrintWindow = new BrowserWindow({
    show: false,
    width: 800,
    height: 900,
    title: 'Print',
    autoHideMenuBar: true,
    skipTaskbar: true,
    focusable: false,
    frame: false,
    // backgroundThrottling off: this window is always hidden, and a throttled
    // hidden window may never repaint after the 3× oversample zoom — capture
    // then gets the stale 1× frame (see isStaleOversampleCapture).
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  try { sharedPrintWindow.setMenuBarVisibility(false); } catch { /* */ }
  sharedPrintWindow.on('closed', () => { sharedPrintWindow = null; });
  sharedPrintWindow.on('show', () => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    } catch { /* */ }
  });
  return sharedPrintWindow;
}

/**
 * Hidden print helper. Pass `{ fresh: true }` so this job cannot inherit
 * leftover 3× zoom / oversized bounds from the previous capture (that is
 * what printed a full A5 on the first POS bill after launch, then a tiny
 * stamp on every bill after that).
 */
function getSharedPrintWindow({ fresh = false } = {}) {
  if (fresh) destroySharedPrintWindow();
  if (sharedPrintWindow && !sharedPrintWindow.isDestroyed()) return sharedPrintWindow;
  return createSharedPrintWindow();
}

async function waitForZoomFactor(webContents, target, timeoutMs = 400) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let z = 0;
    try { z = Number(webContents.getZoomFactor()) || 0; } catch { return false; }
    if (Math.abs(z - target) <= 0.05) return true;
    await new Promise((r) => setTimeout(r, 30));
  }
  return false;
}

/**
 * True when an oversampled capture still holds the previous 1× frame: all
 * painted (non-white) pixels sit inside the left 1/oversample of the image,
 * or nothing is painted at all. A real invoice page always spans nearly the
 * full width (items table / letterhead), so this never trips on a good capture.
 */
function isStaleOversampleCapture(image, oversample) {
  try {
    const { width, height } = image.getSize();
    if (!(width > 2 && height > 2)) return false;
    const buf = image.toBitmap();
    const stride = 3;
    let maxX = -1;
    for (let y = 0; y < height; y += stride) {
      const row = y * width * 4;
      // Scan right-to-left; only columns past the current max can move it.
      for (let x = width - 1; x > maxX; x -= stride) {
        const o = row + x * 4;
        const a = buf[o + 3];
        if (a > 16 && (buf[o] < 235 || buf[o + 1] < 235 || buf[o + 2] < 235)) {
          maxX = x;
          break;
        }
      }
    }
    if (maxX < 0) return true;
    return maxX < width * (1 / oversample + 0.06);
  } catch {
    return false;
  }
}

// All print:html / pdf:saveFromHtml / pdf:generateFromHtml IPC handlers share
// one hidden BrowserWindow (getSharedPrintWindow above). Two of those handlers
// fire back-to-back for the same job (e.g. an invoice print immediately
// followed by a label print at checkout, or a print right after a PDF
// preview) — without serializing them, a second call's win.loadFile()/resize
// can navigate the shared webContents out from under a first call's
// still-in-flight capturePage()/printToPDF, producing a corrupted capture
// (tiny content on an otherwise blank page) that then lingers until the app
// restarts. Route every use of the shared window through this so only one
// job ever touches it at a time.
let printQueueTail = Promise.resolve();
function withPrintLock(task) {
  const run = printQueueTail.then(task, task);
  printQueueTail = run.then(() => {}, () => {});
  return run;
}

/** Hide print helper and return keyboard/mouse focus to the main ERP window.
 *  Pass `{ force: true }` after print jobs. Idle calls are no-ops so typing stays snappy.
 */
function forceMainWindowFocus(printWin = sharedPrintWindow, { force = false } = {}) {
  const helper = printWin && !printWin.isDestroyed?.() ? printWin : null;
  let helperNeedsCleanup = false;
  if (helper) {
    try {
      helperNeedsCleanup = helper.isVisible() || helper.isAlwaysOnTop();
    } catch {
      helperNeedsCleanup = false;
    }
  }

  if (helperNeedsCleanup) {
    try {
      try { helper.setAlwaysOnTop(false); } catch { /* */ }
      try { helper.setOpacity(0); } catch { /* */ }
      try { helper.setIgnoreMouseEvents(true); } catch { /* */ }
      try { if (helper.isVisible()) helper.hide(); } catch { /* */ }
      try { helper.blur(); } catch { /* */ }
    } catch { /* */ }
  }

  if (!force && !helperNeedsCleanup) return;

  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show();
      if (mainWindow.isMinimized()) mainWindow.restore();
      try { mainWindow.setIgnoreMouseEvents(false); } catch { /* */ }
      if (!mainWindow.isFocused()) mainWindow.focus();
    }
  } catch { /* */ }
}
let localDbReady = false;

// 16×16 gold square PNG — embedded so no external file dependency
const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAMAAAAoLQ9TAAAAIVBMVEUAAADBkEPElUvIml' +
  'DFl03GmE7EmErDk0jCkka/jkL///+lJ4/ZAAAABXRSTlMAFh8oVWL3h98AAAAcSURBVBjTY2Ag' +
  'ARAECiAAgA0GMAY2DFACBAABRQABmrQJOwAAAABJRU5ErkJggg==';

function buildTrayIcon() {
  const icoPath = path.join(__dirname, 'build', 'icon.png');
  if (fs.existsSync(icoPath)) return icoPath;
  const trayPath = path.join(__dirname, 'build', 'tray.png');
  if (fs.existsSync(trayPath)) return trayPath;
  return nativeImage.createFromDataURL('data:image/png;base64,' + TRAY_ICON_B64);
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip(APP_WINDOW_TITLE);

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Jewellery ERP',
      click: () => focusMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        appIsQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);

  // Single click on tray icon → show/focus window
  tray.on('click', () => focusMainWindow());
}
let localDbError = null;

// Neon / pg disconnects must never crash the whole CRM window
process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  console.warn('[main] unhandledRejection:', msg);
});
process.on('uncaughtException', (err) => {
  console.error('[main] uncaughtException:', err?.message || err);
});

function frontendEntry() {
  const entry = runMode.resolveFrontendEntry();
  console.log('[main] frontend', entry.source, entry.type === 'url' ? entry.value : entry.value);
  return { type: entry.type, value: entry.value };
}

function resolveAppIcon() {
  const ico = path.join(__dirname, 'build', 'icon.png');
  return fs.existsSync(ico) ? ico : undefined;
}

function focusMainWindow() {
  if (quitCleanupStarted || appIsQuitting) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
  try { app.focus({ steal: true }); } catch { /* older Electron */ }
}
focusPrimaryInstance = focusMainWindow;

function createWindow() {
  if (quitCleanupStarted || appIsQuitting) return null;
  // Never open a second main window in the same process.
  if (mainWindow && !mainWindow.isDestroyed()) {
    focusMainWindow();
    return mainWindow;
  }
  if (windowCreating) return mainWindow;
  windowCreating = true;

  console.log('[main] Creating window…');
  const appIcon = resolveAppIcon();
  try {
    mainWindow = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      show: true, // show immediately — ready-to-show can hang if the page never paints
      title: APP_WINDOW_TITLE,
      ...(appIcon ? { icon: appIcon } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // Enables Chromium's built-in PDF viewer for <iframe>/<embed> content —
        // used to preview generated reports as a real, paginated PDF inline
        // in the app instead of opening an external viewer.
        plugins: true,
      },
    });
  } catch (err) {
    windowCreating = false;
    throw err;
  }
  windowCreating = false;
  focusPrimaryInstance = focusMainWindow;

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[main] Window failed to load (${code}): ${desc} — ${url}`);
  });
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] Window finished loading');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(APP_WINDOW_TITLE);
  });
  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(APP_WINDOW_TITLE);
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const cfg = loadConfig();
  // Always open the Sign In UI (Create Shop / Join live on that page — no separate first-launch).
  const entry = frontendEntry();
  console.log(`[main] Loading frontend: ${entry.type} ${entry.value}`, {
    setup_complete: cfg.setup_complete,
    shop_name: cfg.shop_name || null,
  });
  if (entry.type === 'url') {
    mainWindow.loadURL(entry.value);
  } else {
    mainWindow.loadFile(entry.value);
  }

  // X / Alt+F4 must fully quit — do not hide to tray (that left backend +
  // session alive, caused Task Manager duplicates, and restored the old page).
  mainWindow.on('close', () => {
    appIsQuitting = true;
    if (sharedPrintWindow && !sharedPrintWindow.isDestroyed()) {
      destroySharedPrintWindow();
    }
    if (tray) {
      try { tray.destroy(); } catch { /* */ }
      tray = null;
    }
  });

  // Deny unexpected navigations / window windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const allowed = parseAllowedExternalUrl(url);
    if (allowed) shell.openExternal(allowed.toString());
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'file://',
    ];
    if (!allowed.some((p) => url.startsWith(p))) {
      event.preventDefault();
    }
  });

  // Do NOT hook focus/show/restore → forceMainWindowFocus.
  // That re-ran on every input click and made typing feel stuck/laggy.
  // Focus is restored only after print (see print:html finally).
  return mainWindow;
}

function assertIpcSender(event) {
  const wc = event.sender;
  if (!wc || wc.isDestroyed()) throw new Error('Invalid IPC sender');
}

function registerIpc() {
  ipcMain.handle('config:get', (event) => {
    assertIpcSender(event);
    const cfg = loadConfig();
    const localUrl = backendProcess.isReady()
      ? `http://127.0.0.1:${backendProcess.getPort()}`
      : (cfg.local_api_url || 'http://127.0.0.1:8080');
    const isJoin = cfg.mode === 'join' || cfg.role === 'replica' || cfg.role === 'client';
    // Join: UI talks to remote HOST for billing. Host: UI talks to local embedded API.
    const apiUrl = isJoin
      ? (cfg.host_api_url || cfg.branch_api_url || cfg.last_known_host_url || localUrl)
      : localUrl;
    return {
      setup_complete: Boolean(cfg.setup_complete),
      mode: cfg.mode || 'host',
      role: cfg.role || (isJoin ? 'replica' : 'active_host'),
      branch_api_url: apiUrl,
      host_api_url: cfg.host_api_url || null,
      local_api_url: localUrl,
      shop_name: cfg.shop_name || null,
      shop_id: cfg.shop_id || null,
      device_name: cfg.device_name || null,
      device_number: cfg.device_number || 1,
      event_watermark: cfg.event_watermark || 0,
      printer_prefs: cfg.printer_prefs || {},
    };
  });

  ipcMain.handle('config:set', (event, patch) => {
    assertIpcSender(event);
    if (!patch || typeof patch !== 'object') throw new Error('Invalid config');
    const allowed = [
      'setup_complete', 'mode', 'role', 'branch_api_url', 'host_api_url', 'local_api_url',
      'last_known_host_url', 'last_known_host_device_id', 'last_known_host_term',
      'shop_name', 'device_name', 'device_number', 'shop_id', 'device_id', 'event_watermark', 'printer_prefs',
    ];
    const next = {};
    for (const key of allowed) {
      if (patch[key] !== undefined) next[key] = patch[key];
    }
    for (const urlKey of ['branch_api_url', 'host_api_url', 'local_api_url']) {
      if (next[urlKey]) {
        let u;
        try { u = new URL(String(next[urlKey])); } catch {
          throw new Error(`Invalid ${urlKey}`);
        }
        if (!['http:', 'https:'].includes(u.protocol)) {
          throw new Error(`${urlKey} must be http(s)`);
        }
        next[urlKey] = u.origin;
      }
    }
    return saveConfig(next);
  });

  // ── Windows startup (open at login) ──────────────────────────────────────
  ipcMain.handle('app:getLoginItem', (event) => {
    assertIpcSender(event);
    return app.getLoginItemSettings();
  });

  ipcMain.handle('app:setLoginItem', (event, { openAtLogin }) => {
    assertIpcSender(event);
    app.setLoginItemSettings({ openAtLogin: Boolean(openAtLogin), openAsHidden: false });
    return app.getLoginItemSettings();
  });

  // ── Host connector IPC ────────────────────────────────────────────────────
  ipcMain.handle('host:getState', (event) => {
    assertIpcSender(event);
    return hostConnector.getState();
  });

  ipcMain.handle('host:retry', async (event) => {
    assertIpcSender(event);
    await hostConnector.retry();
    return hostConnector.getState();
  });

  ipcMain.handle('host:pairingComplete', (event, data) => {
    assertIpcSender(event);
    if (data?.shop_id && (data?.device_id || data?.device_identifier)) {
      hostConnector.onPairingComplete(data);
      const identifier = data.device_identifier || data.device_id;
      saveConfig({
        shop_id: data.shop_id,
        device_id: identifier,
        device_number: data.device_number || 1,
      });
    }
    if (data?.lan_shared_key) {
      try {
        const lanSecret = require('./lib/services/lanSecret');
        lanSecret.adoptLanSharedKey(app.getPath('userData'), data.lan_shared_key);
        lanCoordinator.setSharedKey(data.lan_shared_key);
        console.log('[main] Adopted shop LAN coordination key (fp=%s)', lanSecret.fingerprint(data.lan_shared_key));
      } catch (err) {
        console.warn('[main] Failed to adopt LAN key:', err.message);
      }
    }
    return true;
  });

  ipcMain.handle('host:employeeSignedIn', (event) => {
    assertIpcSender(event);
    hostConnector.onEmployeeSignedIn();
    return true;
  });

  ipcMain.handle('host:employeeSignedOut', (event) => {
    assertIpcSender(event);
    hostConnector.onEmployeeSignedOut();
    return true;
  });

  // Forward connector state changes to the renderer
  hostConnector.on('state', (state) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('host:stateChanged', state);
    }
  });

  ipcMain.handle('connectivity:ping', async (event, url) => {
    assertIpcSender(event);
    const target = String(url || loadConfig().branch_api_url || defaultConfig.branch_api_url);
    try {
      const u = new URL(target);
      if (!['http:', 'https:'].includes(u.protocol)) {
        return { ok: false, error: 'invalid protocol' };
      }
      const res = await fetch(`${u.origin}/api/health`, { signal: AbortSignal.timeout(4000) });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, health: data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('app:getLocalIp', (event) => {
    assertIpcSender(event);
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const ips = [];
    for (const iface of Object.values(nets)) {
      for (const net of iface) {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      }
    }
    return { ips, port: backendProcess.isReady() ? backendProcess.getPort() : 8080 };
  });

  ipcMain.handle('app:getInfo', (event) => {
    assertIpcSender(event);
    const deskLog = require('./lib/logger');
    const run = runMode.getRunInfo();
    return {
      version: app.getVersion(),
      platform: process.platform,
      isDev,
      run,
      localDb: getLocalDbStatus(),
      localDbError,
      logDir: deskLog.getLogDir(),
    };
  });

  ipcMain.handle('app:openLogsFolder', async (event) => {
    assertIpcSender(event);
    const deskLog = require('./lib/logger');
    const dir = deskLog.getLogDir();
    fs.mkdirSync(dir, { recursive: true });
    await shell.openPath(dir);
    return { logDir: dir };
  });

  ipcMain.handle('db:status', (event) => {
    assertIpcSender(event);
    const deskLog = require('./lib/logger');
    const status = getLocalDbStatus();
    let fileSizeBytes = null;
    if (status.dbPath) {
      try { fileSizeBytes = fs.statSync(status.dbPath).size; } catch { /* non-fatal */ }
    }
    return {
      ...status,
      error: localDbError,
      ready: localDbReady,
      fileSizeBytes,
      logDir: deskLog.getLogDir(),
    };
  });

  ipcMain.handle('db:backup', (event) => {
    assertIpcSender(event);
    if (!localDbReady) throw new Error('Local database not ready');
    return backupLocalDb();
  });

  /**
   * Copy a consistent shop database backup to a user-chosen folder
   * (USB / pendrive / external drive / network share).
   */
  ipcMain.handle('backup:exportToFolder', async (event, opts = {}) => {
    assertIpcSender(event);
    if (!localDbReady) throw new Error('Local database not ready');

    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win || undefined, {
      title: 'Choose USB drive or folder for backup',
      buttonLabel: 'Save backup here',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { canceled: true };
    }

    const root = picked.filePaths[0];
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const destDir = path.join(root, `JewelleryCRM-Backup-${stamp}`);
    fs.mkdirSync(destDir, { recursive: true });

    const files = [];

    // Consistent SQLite snapshot (Backup API — safe while app is running)
    const bak = await backupLocalDb();
    if (!bak?.ok || !bak.path || !fs.existsSync(bak.path)) {
      throw new Error(bak?.error || 'Could not create database backup');
    }
    const sqliteName = `jewellery-crm-${stamp}.sqlite`;
    const sqliteDest = path.join(destDir, sqliteName);
    fs.copyFileSync(bak.path, sqliteDest);
    files.push({ name: sqliteName, bytes: fs.statSync(sqliteDest).size, kind: 'sqlite' });

    // Optional encrypted archive from backend (path must be local & readable)
    const encPath = opts?.encPath ? String(opts.encPath) : '';
    if (encPath && fs.existsSync(encPath) && encPath.toLowerCase().endsWith('.enc')) {
      const encName = path.basename(encPath);
      const encDest = path.join(destDir, encName);
      fs.copyFileSync(encPath, encDest);
      files.push({ name: encName, bytes: fs.statSync(encDest).size, kind: 'encrypted' });
    }

    // Optional date-range / CSV exports written by renderer (UTF-8 text)
    const textFiles = Array.isArray(opts?.textFiles) ? opts.textFiles : [];
    if (textFiles.length) {
      const csvDir = path.join(destDir, 'csv');
      fs.mkdirSync(csvDir, { recursive: true });
      for (const item of textFiles) {
        const rawName = String(item?.name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
        if (!rawName || !/\.(csv|txt)$/i.test(rawName)) continue;
        const body = item?.contentBase64
          ? Buffer.from(String(item.contentBase64), 'base64')
          : Buffer.from(String(item?.text || ''), 'utf8');
        const out = path.join(csvDir, rawName);
        fs.writeFileSync(out, body);
        files.push({ name: `csv/${rawName}`, bytes: body.length, kind: 'csv' });
      }
    }

    const rangeNote = opts?.dateFrom && opts?.dateTo
      ? `Date-range CSVs: ${opts.dateFrom} → ${opts.dateTo}`
      : 'Date-range CSVs: (none included)';

    const readme = [
      'Jewellery CRM — Shop Backup',
      '===========================',
      `Created: ${new Date().toISOString()}`,
      `Folder:  ${destDir}`,
      rangeNote,
      '',
      'Contents:',
      ...files.map((f) => `  - ${f.name} (${f.bytes} bytes) [${f.kind}]`),
      '',
      'How to use:',
      '  • Keep this folder on a USB drive or safe external disk.',
      '  • The .sqlite file is a full shop database snapshot (all dates).',
      '  • csv/ folder has Excel-friendly exports for the selected date range.',
      '  • The .enc file (if present) is an encrypted archive — store the',
      '    shop recovery key offline; do not share it with the USB.',
      '  • To restore, use Settings → Backup in the desktop app, or ask support.',
      '',
      'Do not edit these files. Do not delete partial files from this folder.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(destDir, 'README.txt'), readme, 'utf8');

    try {
      await shell.openPath(destDir);
    } catch { /* optional */ }

    console.log('[main] backup:exportToFolder →', destDir, files.map((f) => f.name).join(', '));
    return { canceled: false, folder: destDir, files };
  });

  ipcMain.handle('shell:openExternal', async (event, url) => {
    assertIpcSender(event);
    const u = parseAllowedExternalUrl(url);
    if (!u) {
      throw new Error('Only http(s) and WhatsApp links are allowed');
    }
    await shell.openExternal(u.toString());
    return true;
  });

  // ── Offline ownership transfer ──────────────────────────────────────────────

  ipcMain.handle('db:saveExportFile', async (event, { buffer, fileName }) => {
    assertIpcSender(event);
    const userData = app.getPath('userData');
    const tempDir = path.join(userData, 'data', 'transfers');
    fs.mkdirSync(tempDir, { recursive: true });
    const tempPath = path.join(tempDir, fileName || `transfer-${Date.now()}.sqlite.tmp`);
    fs.writeFileSync(tempPath, Buffer.from(buffer));
    const size = fs.statSync(tempPath).size;
    console.log(`[main] db:saveExportFile saved ${size} bytes → ${tempPath}`);
    return { tempPath, size };
  });

  ipcMain.handle('db:replace-and-restart', async (event, { tempFilePath }) => {
    assertIpcSender(event);
    if (!tempFilePath || !fs.existsSync(tempFilePath)) {
      throw new Error('Transfer file not found: ' + tempFilePath);
    }
    const status = getLocalDbStatus();
    const dbPath = status.dbPath;
    if (!dbPath) throw new Error('Local database path unknown — DB may not be initialised');

    console.log('[main] db:replace-and-restart — stopping backend…');
    backendProcess.stop();
    await new Promise(r => setTimeout(r, 2500));

    console.log('[main] db:replace-and-restart — closing SQLite…');
    shutdownLocalDb();

    // Keep a safety backup of the old DB
    const backupPath = dbPath + '.pre-transfer.bak';
    try { if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, backupPath); } catch {}

    // Delete stale WAL / SHM so the imported DB starts clean
    for (const ext of ['-wal', '-shm']) {
      try { if (fs.existsSync(dbPath + ext)) fs.unlinkSync(dbPath + ext); } catch {}
    }

    // Swap in the transfer file
    fs.copyFileSync(tempFilePath, dbPath);
    try { fs.unlinkSync(tempFilePath); } catch {}
    console.log('[main] db:replace-and-restart — database replaced');

    // Reinitialise SQLite with the new file
    const userData = app.getPath('userData');
    await initLocalDb(userData);
    localDbReady = true;

    // Restart backend pointing at new DB
    const cfg = loadConfig();
    const { resolveDbPath } = require('./lib/db/sqlite');
    const newDbPath = resolveDbPath(userData);
    console.log('[main] db:replace-and-restart — restarting backend…');
    await backendProcess.start({
      port: 8080,
      shopId: cfg.shop_id,
      sqlitePath: newDbPath,
      deviceNumber: cfg.device_number || 1,
      deviceId: cfg.device_id || null,
      branchRole: cfg.role === 'replica' || cfg.mode === 'join' ? 'replica' : 'active_host',
    });
    console.log('[main] db:replace-and-restart — complete');
    return { ok: true };
  });

  // ── Manual backup import / restore ──────────────────────────────────────────

  /** Native "choose a file" dialog for a locally-saved backup (.sqlite or .enc). */
  ipcMain.handle('backup:pickImportFile', async (event) => {
    assertIpcSender(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    const picked = await dialog.showOpenDialog(win || undefined, {
      title: 'Select a backup file to restore',
      buttonLabel: 'Select',
      properties: ['openFile'],
      filters: [
        { name: 'Backup files', extensions: ['sqlite', 'db', 'enc'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePaths?.[0]) return { canceled: true };
    const filePath = picked.filePaths[0];
    return { canceled: false, path: filePath, name: path.basename(filePath) };
  });

  /**
   * Swap a previously-picked plain SQLite file into place as the live database,
   * then restart the backend and reload the window — same safe sequence as
   * db:replace-and-restart (pre-swap backup, clean WAL/SHM, reinit), except the
   * source file is the user's own backup and is kept intact unless it's an
   * app-generated decrypted temp copy (deleteSource: true).
   */
  ipcMain.handle('backup:importRestore', async (event, { filePath, deleteSource = false } = {}) => {
    assertIpcSender(event);
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Backup file not found: ' + filePath);
    }

    // Validate before touching the running app — fail fast on a bad file.
    try {
      const Database = require('better-sqlite3');
      const check = new Database(filePath, { readonly: true, fileMustExist: true });
      try {
        const row = check.pragma('integrity_check');
        const ok = Array.isArray(row) && row.length === 1 && row[0].integrity_check === 'ok';
        if (!ok) throw new Error('integrity_check failed');
      } finally {
        check.close();
      }
    } catch (err) {
      throw new Error(`Selected file is not a valid backup database: ${err.message}`);
    }

    const status = getLocalDbStatus();
    const dbPath = status.dbPath;
    if (!dbPath) throw new Error('Local database path unknown — DB may not be initialised');

    console.log('[main] backup:importRestore — stopping backend…');
    backendProcess.stop();
    await new Promise((r) => setTimeout(r, 2500));

    console.log('[main] backup:importRestore — closing SQLite…');
    shutdownLocalDb();

    // Keep a safety backup of the current DB before swapping.
    const backupPath = `${dbPath}.pre-import-${Date.now()}.bak`;
    try { if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, backupPath); } catch { /* non-fatal */ }

    // Delete stale WAL / SHM so the restored DB starts clean.
    for (const ext of ['-wal', '-shm']) {
      try { if (fs.existsSync(dbPath + ext)) fs.unlinkSync(dbPath + ext); } catch { /* */ }
    }

    fs.copyFileSync(filePath, dbPath);
    if (deleteSource) {
      try { fs.unlinkSync(filePath); } catch { /* */ }
    }
    console.log('[main] backup:importRestore — database replaced, pre-restore copy at', backupPath);

    const userData = app.getPath('userData');
    await initLocalDb(userData);
    localDbReady = true;

    const cfg = loadConfig();
    const { resolveDbPath } = require('./lib/db/sqlite');
    const newDbPath = resolveDbPath(userData);
    console.log('[main] backup:importRestore — restarting backend…');
    await backendProcess.start({
      port: 8080,
      shopId: cfg.shop_id,
      sqlitePath: newDbPath,
      deviceNumber: cfg.device_number || 1,
      deviceId: cfg.device_id || null,
      branchRole: cfg.role === 'replica' || cfg.mode === 'join' ? 'replica' : 'active_host',
    });

    if (mainWindow && !mainWindow.isDestroyed()) {
      const entry = frontendEntry();
      if (entry.type === 'url') mainWindow.loadURL(entry.value);
      else mainWindow.loadFile(entry.value);
    }

    console.log('[main] backup:importRestore — complete');
    return { ok: true, pre_restore_backup: backupPath };
  });

  ipcMain.handle('setup:completeAndReload', async (event) => {
    assertIpcSender(event);
    saveConfig({ setup_complete: true });
    // Import pending join snapshot into local SQLite before showing CRM
    try {
      const p = path.join(app.getPath('userData'), 'pending-snapshot.json');
      if (fs.existsSync(p) && backendProcess.isReady()) {
        const snapshot = JSON.parse(fs.readFileSync(p, 'utf8'));
        const flag = path.join(app.getPath('userData'), 'allow-snapshot-import');
        fs.writeFileSync(flag, '1', { mode: 0o600 });
        try {
          const port = backendProcess.getPort() || 8080;
          const res = await fetch(`http://127.0.0.1:${port}/api/cluster/snapshot/import-local`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Local-Import': '1' },
            body: JSON.stringify({ snapshot }),
          });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            try { fs.unlinkSync(p); } catch { /* */ }
            if (data.watermark != null) saveConfig({ event_watermark: data.watermark });
            console.log('[main] Imported join snapshot, watermark=', data.watermark);
          }
        } finally {
          try { fs.unlinkSync(flag); } catch { /* */ }
        }
      }
    } catch (err) {
      console.warn('[main] snapshot import on setup:', err.message);
    }
    if (!mainWindow) return false;
    const entry = frontendEntry();
    if (entry.type === 'url') mainWindow.loadURL(entry.value);
    else mainWindow.loadFile(entry.value);
    return true;
  });

  ipcMain.handle('cluster:stashSnapshot', (event, snapshot) => {
    assertIpcSender(event);
    const p = path.join(app.getPath('userData'), 'pending-snapshot.json');
    fs.writeFileSync(p, JSON.stringify(snapshot), { mode: 0o600 });
    return { ok: true };
  });

  ipcMain.handle('db:factory-reset', async (event) => {
    assertIpcSender(event);
    console.log('[main] Factory reset requested — wiping all data…');

    // 1. Stop embedded backend — wait for the real process exit (not a guess)
    //    so its SQLite file handle is actually released before we delete it.
    await backendProcess.stop();

    // 2. Close SQLite
    shutdownLocalDb();
    localDbReady = false;

    // 3. Delete SQLite file + WAL/SHM. This is what makes tag/barcode counters
    // (and every other sequence table) restart from scratch — they live in
    // this same file, not in SQLite AUTOINCREMENT/sqlite_sequence, so once the
    // file is gone they're gone. Log (don't silently ignore) any failure: a
    // locked file here means the reset silently continues on stale data.
    const userData = app.getPath('userData');
    const dbPath = path.join(userData, 'data', 'jewellery-crm.sqlite');
    let deleteFailed = false;
    for (const ext of ['', '-wal', '-shm']) {
      const target = dbPath + ext;
      try {
        if (fs.existsSync(target)) fs.unlinkSync(target);
      } catch (err) {
        deleteFailed = true;
        console.error(`[main] Factory reset: failed to delete ${target}:`, err.message);
      }
    }

    // 4. Delete pending snapshots and LAN key
    for (const f of [
      path.join(userData, 'pending-snapshot.json'),
      path.join(userData, 'lan-shared-key.bin'),
      path.join(userData, 'lan-shared-key.json'),
    ]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* non-fatal */ }
    }

    // 5. Reset config (preserve device_id + device_name so identity keypair survives)
    const current = loadConfig();
    saveConfig({
      setup_complete: false,
      mode: 'host',
      role: 'active_host',
      branch_api_url: 'http://127.0.0.1:8080',
      host_api_url: null,
      local_api_url: 'http://127.0.0.1:8080',
      last_known_host_url: null,
      last_known_host_device_id: null,
      last_known_host_term: 0,
      shop_name: null,
      shop_id: null,
      device_name: current.device_name || null,
      device_number: 1,
      event_watermark: 0,
      printer_prefs: {},
    });

    // 6. Re-init local SQLite (creates a fresh empty DB)
    try {
      const info = await initLocalDb(userData);
      localDbReady = true;
      console.log('[main] Fresh SQLite ready v' + info.schemaVersion);

      // Safety net: if step 3 above failed to delete the file (e.g. a
      // lingering Windows file lock), initLocalDb() just reopened the old
      // database and its counter tables would otherwise survive with their
      // old high-water mark. Explicitly clear the app's own sequence tables
      // (barcode_sequences, product_code_sequences — never SQLite's
      // AUTOINCREMENT/sqlite_sequence, this project doesn't use that) so tag
      // numbers are guaranteed to restart at their base value either way.
      // No-op on the normal fresh-file path since these tables won't exist yet.
      if (deleteFailed) {
        const freshDb = require('./lib/db').getLocalDb?.();
        if (freshDb) {
          const resetSequenceTables = freshDb.transaction(() => {
            for (const table of ['barcode_sequences', 'product_code_sequences']) {
              const exists = freshDb
                .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
                .get(table);
              if (exists) freshDb.prepare(`DELETE FROM ${table}`).run();
            }
          });
          resetSequenceTables();
          console.warn('[main] Factory reset: file delete failed earlier — explicitly cleared sequence tables instead.');
        }
      }
    } catch (err) {
      localDbError = err.message;
      console.error('[main] Fresh SQLite init failed:', err.message);
    }

    // 7. Restart backend (seed will recreate owner login automatically)
    const freshCfg = loadConfig();
    try {
      await backendProcess.start({
        port: 8080,
        shopId: null,
        sqlitePath: dbPath,
        deviceNumber: 1,
        deviceId: freshCfg.device_id || null,
        branchRole: 'active_host',
        onLog: (line) => console.log('[backend]', line),
        onEvent: (ev, payload) => {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ev, payload);
        },
      });
      // Auto-complete setup from fresh seed
      try {
        const healthRes = await fetch('http://127.0.0.1:8080/api/health').then((r) => r.json()).catch(() => null);
        const shopId = healthRes?.shop_id || null;
        if (shopId) {
          saveConfig({
            mode: 'host', role: 'active_host',
            branch_api_url: 'http://127.0.0.1:8080',
            local_api_url: 'http://127.0.0.1:8080',
            shop_id: shopId,
            device_id: healthRes?.device_id || freshCfg.device_id || null,
            device_name: healthRes?.device_name || freshCfg.device_name || null,
            setup_complete: true,
          });
        }
      } catch { /* non-fatal */ }
      console.log('[main] Backend restarted after factory reset');
    } catch (err) {
      console.error('[main] Backend restart after reset failed:', err.message);
    }

    // 8. Reload the window — shows sign-in with fresh data
    if (mainWindow && !mainWindow.isDestroyed()) {
      const entry = frontendEntry();
      if (entry.type === 'url') mainWindow.loadURL(entry.value);
      else mainWindow.loadFile(entry.value);
    }

    console.log('[main] Factory reset complete');
    return { ok: true };
  });

  ipcMain.handle('cluster:importStashedSnapshot', async (event) => {
    assertIpcSender(event);
    const p = path.join(app.getPath('userData'), 'pending-snapshot.json');
    if (!fs.existsSync(p)) return { ok: false, reason: 'no_snapshot' };
    const snapshot = JSON.parse(fs.readFileSync(p, 'utf8'));
    // Wait for local backend
    for (let i = 0; i < 30; i++) {
      if (backendProcess.isReady()) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const port = backendProcess.getPort() || 8080;
    // Local import endpoint requires auth — use internal bootstrap via file flag
    const flag = path.join(app.getPath('userData'), 'allow-snapshot-import');
    fs.writeFileSync(flag, '1', { mode: 0o600 });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/cluster/snapshot/import-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Local-Import': '1' },
        body: JSON.stringify({ snapshot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, detail: data.detail || res.status };
      try { fs.unlinkSync(p); } catch { /* */ }
      if (data.watermark != null) saveConfig({ event_watermark: data.watermark });
      return { ok: true, ...data };
    } finally {
      try { fs.unlinkSync(flag); } catch { /* */ }
    }
  });

  ipcMain.handle('setup:resetAndShowFirstLaunch', (event) => {
    assertIpcSender(event);
    // Force Create / Join again (logout / reset). Keep device_id and shop_id for local DB.
    saveConfig({ setup_complete: false, shop_name: null });
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const firstLaunch = path.join(__dirname, 'first-launch.html');
    mainWindow.loadFile(firstLaunch);
    return true;
  });

  function isVirtualPrinterName(name) {
    return /print to pdf|microsoft print to pdf|xps document writer|onenote|fax/i.test(String(name || ''));
  }

  let printerLiveCache = { at: 0, byName: new Map() };

  /**
   * Fast live probe. Electron alone still shows green after USB unplug.
   * Uses System.Printing PrintQueue + USB PnP. Soft timeout 3s; cache 8s.
   */
  async function probeWindowsPrinterLive(force = false) {
    const now = Date.now();
    if (!force && now - printerLiveCache.at < 8_000 && printerLiveCache.byName.size) {
      return printerLiveCache.byName;
    }
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const psClean = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Printing -ErrorAction SilentlyContinue | Out-Null
$server = $null
try { $server = New-Object System.Printing.LocalPrintServer } catch {}
$pnpDevices = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object {
  $_.Class -eq 'Printer' -or $_.InstanceId -like 'USBPRINT*' -or $_.InstanceId -like 'USB\\VID*'
})
$pnpOk = @($pnpDevices | Where-Object { $_.Status -eq 'OK' } | ForEach-Object { [string]$_.FriendlyName })
$usbPrintOk = @($pnpDevices | Where-Object { $_.InstanceId -like 'USBPRINT*' -and $_.Status -eq 'OK' } | ForEach-Object { [string]$_.FriendlyName })
$out = @()
Get-CimInstance Win32_Printer | ForEach-Object {
  $name = [string]$_.Name
  $err = [int]$_.DetectedErrorState
  $st = [int]$_.PrinterStatus
  $off = [bool]$_.WorkOffline
  $port = [string]$_.PortName
  $online = (-not $off) -and ($st -ne 7) -and ($err -ne 7)
  if ($server) {
    try {
      $q = $server.GetPrintQueue($name)
      $q.Refresh()
      if ($q.IsOffline -or $q.IsNotAvailable) { $online = $false }
      $qs = [int]$q.QueueStatus
      if (($qs -band 128) -ne 0 -or ($qs -band 4096) -ne 0) { $online = $false }
    } catch {}
  }
  if ($online -and $port -match '^USB' -and $pnpDevices.Count -gt 0) {
    # Match on ANY word (>=3 chars) shared between the printer's queue name and
    # the PnP FriendlyName, not just the first word — generic/cheap USB
    # printers (thermal receipt printers especially) often report a driver
    # name that only overlaps on a model number or a later word, and a
    # first-word-only match was flagging real, connected printers as offline.
    $words = @($name -split '\\s+' | Where-Object { $_.Length -ge 3 })
    $present = $false
    foreach ($n in $pnpOk) {
      if ($n -eq $name) { $present = $true; break }
      foreach ($w in $words) {
        if ($n -like ("*" + $w + "*") -or $name -like ("*" + $n + "*")) { $present = $true; break }
      }
      if ($present) { break }
    }
    if (-not $present) {
      foreach ($n in $usbPrintOk) {
        foreach ($w in $words) {
          if ($n -like ("*" + $w + "*") -or $name -like ("*" + $n + "*")) { $present = $true; break }
        }
        if ($present) { break }
      }
    }
    # Only let a failed name-match downgrade an otherwise-healthy printer to
    # Offline when PnP actually enumerated other printer-class devices to
    # compare against (i.e. we have real signal it's genuinely absent) —
    # not when this run's PnP scan came back thin/empty for unrelated reasons.
    if (-not $present -and ($pnpOk.Count -gt 0 -or $usbPrintOk.Count -gt 0)) { $online = $false }
  }
  $out += [pscustomobject]@{ Name=$name; Online=$online; WorkOffline=$off; PrinterStatus=$st; PortName=$port }
}
$out | ConvertTo-Json -Compress
`;
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', psClean],
        { windowsHide: true, timeout: 3_500, encoding: 'utf8' },
      );
      const raw = JSON.parse(String(stdout || '').trim() || '[]');
      const rows = Array.isArray(raw) ? raw : (raw ? [raw] : []);
      const byName = new Map();
      for (const r of rows) {
        if (r?.Name) byName.set(r.Name, r);
      }
      printerLiveCache = { at: now, byName };
      return byName;
    } catch (err) {
      console.warn('[print] live probe failed/timed out:', err.message);
      return printerLiveCache.byName.size ? printerLiveCache.byName : new Map();
    }
  }

  function mapElectronPrinters(printers, liveByName) {
    const hasLive = liveByName && liveByName.size > 0;
    return (printers || []).map((p) => {
      const virtual = isVirtualPrinterName(p.name);
      const live = liveByName?.get(p.name);
      let connected = !virtual && Number(p.status) !== 2;
      if (!virtual && hasLive) {
        // Prefer Windows live status (fixes green-dot after USB unplug)
        connected = live ? Boolean(live.Online) && Number(p.status) !== 2 : false;
      }
      return {
        name: p.name,
        displayName: p.displayName || p.name,
        description: p.description || '',
        status: p.status,
        statusText: virtual ? 'Virtual' : (connected ? 'Ready' : 'Offline'),
        portName: live?.PortName || '',
        driverName: '',
        isDefault: Boolean(p.isDefault),
        isVirtual: virtual,
        connected,
        workOffline: Boolean(live?.WorkOffline),
      };
    }).filter((p) => !p.isVirtual);
  }

  /**
   * Fast print-time check — Electron list + optional short Windows live probe.
   * Do NOT run a long PowerShell probe on every print (that alone was ~3–8s on USB).
   * Deep/live probe belongs in Settings Refresh, but a capped deep check is needed
   * so we don't toast "Printed" when the USB cable is unplugged.
   */
  async function checkPrinterConnected(printerName, { deep = false } = {}) {
    if (!printerName || isVirtualPrinterName(printerName)) {
      return { connected: false, reason: 'no_printer', detail: 'No physical printer selected' };
    }

    // Prefer recent Settings live cache when available
    if (printerLiveCache?.byName?.size && (Date.now() - (printerLiveCache.at || 0)) < 90_000) {
      const cached = printerLiveCache.byName.get(printerName);
      if (cached && (cached.Online === false || cached.WorkOffline)) {
        return {
          connected: false,
          reason: 'no_printer',
          detail: `Printer "${printerName}" is not connected. Plug it in and click Refresh in Settings.`,
        };
      }
    }

    // Cap getPrintersAsync — never stall print for a slow Windows spooler query
    let electronList = [];
    try {
      electronList = await Promise.race([
        listPrintersFromMain(),
        new Promise((resolve) => setTimeout(() => resolve(null), 500)),
      ]);
    } catch {
      electronList = null;
    }
    // Timeout / failure → only optimistic when not doing a deep check
    if (electronList == null && !deep) {
      return { connected: true, reason: null, detail: null, optimistic: true };
    }
    if (electronList != null) {
      const eHit = electronList.find((p) => p.name === printerName);
      if (!eHit) {
        return {
          connected: false,
          reason: 'no_printer',
          detail: `Printer "${printerName}" is not connected. Plug it in and click Refresh in Settings.`,
        };
      }
      if (Number(eHit.status) === 2) {
        return {
          connected: false,
          reason: 'no_printer',
          detail: `Printer "${printerName}" is offline or not ready`,
        };
      }
    }

    if (deep) {
      try {
        const liveByName = await Promise.race([
          probeWindowsPrinterLive(false),
          new Promise((resolve) => setTimeout(() => resolve(null), 1000)),
        ]);
        if (liveByName && liveByName.size > 0) {
          const live = liveByName.get(printerName);
          if (!live || live.Online === false || live.WorkOffline) {
            return {
              connected: false,
              reason: 'no_printer',
              detail: `Printer "${printerName}" is not connected. Plug it in and click Refresh in Settings.`,
            };
          }
        }
      } catch { /* fall through */ }
    }

    return { connected: true, reason: null, detail: null };
  }

  ipcMain.handle('devices:getPrinters', async (event) => {
    assertIpcSender(event);
    if (!mainWindow || mainWindow.isDestroyed()) return { printers: [], error: 'Main window unavailable' };
    try {
      const printers = await mainWindow.webContents.getPrintersAsync();
      // Always re-probe on Settings Refresh so unplug shows Offline immediately.
      // This outer guard must give the PowerShell probe strictly MORE time than
      // its own internal exec timeout (3.5s) — it previously cut off at 3.2s,
      // which meant a probe that was about to succeed got discarded and this
      // silently fell back to Electron's less-reliable status instead, on no
      // predictable pattern (whichever finished first that particular run).
      // That race, not the printer itself, was the "flickers between connected
      // and disconnected on repeated refreshes" behavior.
      let liveByName = new Map();
      try {
        liveByName = await Promise.race([
          probeWindowsPrinterLive(true),
          new Promise((resolve) => setTimeout(() => resolve(new Map()), 4500)),
        ]);
      } catch { /* use empty */ }
      const physical = mapElectronPrinters(printers, liveByName);
      const cfg = loadConfig();
      const preferredName = cfg.printer_prefs?.invoice || cfg.printer_prefs?.default || null;
      const preferred = preferredName
        ? physical.find((p) => p.name === preferredName) || null
        : null;
      const defaultPrinter = physical.find((p) => p.isDefault) || null;
      return {
        printers: physical,
        connectedPrinters: physical.filter((p) => p.connected),
        defaultPrinter,
        preferredPrinter: preferred,
        preferredName,
        hasPhysicalPrinter: physical.length > 0,
        defaultIsVirtual: false,
      };
    } catch (err) {
      return { printers: [], error: err.message };
    }
  });

  // ── Printer assignments ────────────────────────────────────────────────────
  ipcMain.handle('printers:getAssignments', (event) => {
    assertIpcSender(event);
    const cfg = loadConfig();
    return cfg.printer_prefs || { invoice: null, label: null, estimation: null };
  });

  ipcMain.handle('printers:setAssignments', (event, assignments) => {
    assertIpcSender(event);
    if (!assignments || typeof assignments !== 'object') return false;
    const cfg = loadConfig();
    const prev = cfg.printer_prefs || {};
    cfg.printer_prefs = {
      invoice:     Object.prototype.hasOwnProperty.call(assignments, 'invoice') ? (assignments.invoice || null) : (prev.invoice || null),
      label:       Object.prototype.hasOwnProperty.call(assignments, 'label') ? (assignments.label || null) : (prev.label || null),
      estimation:  Object.prototype.hasOwnProperty.call(assignments, 'estimation') ? (assignments.estimation || null) : (prev.estimation || null),
    };
    saveConfig(cfg);
    return true;
  });

  ipcMain.handle('print:page', async (event) => {
    assertIpcSender(event);
    if (!mainWindow) return false;
    return new Promise((resolve) => {
      mainWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        resolve({ success, failureReason: failureReason || null });
        if (!mainWindow.isDestroyed()) mainWindow.focus();
      });
    });
  });

  async function listPrintersFromMain() {
    if (!mainWindow || mainWindow.isDestroyed()) return [];
    try {
      return await mainWindow.webContents.getPrintersAsync();
    } catch (err) {
      console.warn('[print] main getPrintersAsync failed:', err.message);
      return [];
    }
  }

  /** Prefer saved Canon setting immediately — skip slow PowerShell Get-Printer. */
  async function resolvePrintTargetFast() {
    const cfg = loadConfig();
    const preferred = cfg.printer_prefs?.invoice || cfg.printer_prefs?.default || null;
    if (preferred && !isVirtualPrinterName(preferred)) return preferred;

    const mainPrinters = await listPrintersFromMain();
    const physical = (mainPrinters || []).filter((p) => !isVirtualPrinterName(p.name));
    const defPhys = physical.find((p) => p.isDefault);
    if (defPhys) return defPhys.name;
    if (physical[0]) return physical[0].name;
    return null;
  }

  function runWebContentsPrint(webContents, options, timeoutMs = 20_000) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ success: false, failureReason: 'Print timed out — check printer and try again' });
      }, timeoutMs);
      try {
        webContents.print(options, (success, failureReason) => {
          clearTimeout(timer);
          resolve({ success: Boolean(success), failureReason: failureReason || null });
        });
      } catch (err) {
        clearTimeout(timer);
        resolve({ success: false, failureReason: err.message || 'Print failed' });
      }
    });
  }

  /**
   * Snapshot Windows print-queue health for a named printer.
   * Used to confirm jobs were accepted and to surface paper/offline/error states.
   */
  async function getPrintQueueStatus(printerName) {
    if (!printerName || isVirtualPrinterName(printerName)) {
      return { ok: false, jobCount: 0, hasError: true, errorDetail: 'No physical printer selected' };
    }
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    const safe = String(printerName).replace(/'/g, "''");
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Printing -ErrorAction SilentlyContinue | Out-Null
$name = '${safe}'
$jobCount = 0
$hasError = $false
$detail = $null
$online = $true
try {
  $p = Get-CimInstance Win32_Printer -Filter "Name='$name'"
  if (-not $p) {
    @{ ok=$false; jobCount=0; hasError=$true; errorDetail="Printer not found"; online=$false } | ConvertTo-Json -Compress
    return
  }
  if ([bool]$p.WorkOffline -or [int]$p.PrinterStatus -eq 7 -or [int]$p.DetectedErrorState -eq 7) {
    $online = $false; $hasError = $true; $detail = 'Printer is offline'
  }
  $jobs = @(Get-CimInstance Win32_PrintJob -ErrorAction SilentlyContinue | Where-Object {
    ([string]$_.Name).StartsWith($name + ',') -or ([string]$_.Name) -eq $name -or ([string]$_.Name).StartsWith($name + ' ')
  })
  $jobCount = $jobs.Count
  foreach ($j in $jobs) {
    $st = [string]$j.Status
    if ($st -match 'Error|Paper|Offline|Deleted|User Intervention|Blocked') {
      $hasError = $true
      if (-not $detail) { $detail = "Print job error: $st" }
    }
  }
  if ($server = New-Object System.Printing.LocalPrintServer) {
    try {
      $q = $server.GetPrintQueue($name)
      $q.Refresh()
      $jobCount = [Math]::Max($jobCount, [int]$q.NumberOfJobs)
      $qs = [int]$q.QueueStatus
      # Offline=128, Error=2, PaperOut=8, PaperProblem=64, NotAvailable=4096, UserIntervention=524288
      if (($qs -band 128) -ne 0 -or ($qs -band 4096) -ne 0) { $online = $false; $hasError = $true; if (-not $detail) { $detail = 'Printer offline or unavailable' } }
      if (($qs -band 2) -ne 0) { $hasError = $true; if (-not $detail) { $detail = 'Printer reported an error' } }
      if (($qs -band 8) -ne 0) { $hasError = $true; if (-not $detail) { $detail = 'Printer is out of paper' } }
      if (($qs -band 64) -ne 0) { $hasError = $true; if (-not $detail) { $detail = 'Printer paper problem' } }
      if (($qs -band 524288) -ne 0) { $hasError = $true; if (-not $detail) { $detail = 'Printer needs attention' } }
      if ($q.IsInError) { $hasError = $true; if (-not $detail) { $detail = 'Printer is in error state' } }
      if ($q.IsOutOfPaper) { $hasError = $true; if (-not $detail) { $detail = 'Printer is out of paper' } }
      if ($q.IsOffline -or $q.IsNotAvailable) { $online = $false; $hasError = $true; if (-not $detail) { $detail = 'Printer offline or unavailable' } }
    } catch {}
  }
} catch {
  $hasError = $true
  $detail = $_.Exception.Message
  $online = $false
}
@{ ok=(-not $hasError -and $online); jobCount=$jobCount; hasError=$hasError; errorDetail=$detail; online=$online } | ConvertTo-Json -Compress
`;
    try {
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
        { windowsHide: true, timeout: 4_000, encoding: 'utf8' },
      );
      const raw = JSON.parse(String(stdout || '').trim() || '{}');
      return {
        ok: Boolean(raw.ok),
        jobCount: Number(raw.jobCount) || 0,
        hasError: Boolean(raw.hasError),
        errorDetail: raw.errorDetail || null,
        online: raw.online !== false,
      };
    } catch (err) {
      console.warn('[print] queue status failed:', err.message);
      return { ok: true, jobCount: 0, hasError: false, errorDetail: null, online: true, probeFailed: true };
    }
  }

  /**
   * After submitting a job, require the spooler to actually receive it.
   * Never treat "printer looks fine" alone as success — that caused false
   * "Printed successfully" toasts with Canon CAPT + Electron silent print.
   */
  async function confirmSpoolerAccepted(printerName, beforeJobCount, { settleMs = 8_000, requireJob = true } = {}) {
    const deadline = Date.now() + settleMs;
    let last = null;
    let sawJob = false;
    let peakJobs = beforeJobCount;

    while (Date.now() < deadline) {
      last = await getPrintQueueStatus(printerName);
      if (last.hasError || last.online === false) {
        return {
          success: false,
          failureReason: 'printer_error',
          detail: last.errorDetail || `Printer "${printerName}" reported an error`,
        };
      }
      if (last.jobCount > beforeJobCount) {
        sawJob = true;
        peakJobs = Math.max(peakJobs, last.jobCount);
      }
      // Job appeared and then left the queue → printed / finished spooling
      if (sawJob && last.jobCount < peakJobs) {
        return { success: true, failureReason: null, detail: null };
      }
      // Job still sitting with no error near end of window → accepted by spooler
      if (sawJob && Date.now() >= deadline - 400) {
        return { success: true, failureReason: null, detail: null };
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    last = last || await getPrintQueueStatus(printerName);
    if (last.hasError || last.online === false) {
      return {
        success: false,
        failureReason: 'printer_error',
        detail: last.errorDetail || `Printer "${printerName}" reported an error`,
      };
    }
    if (sawJob || last.jobCount > beforeJobCount) {
      return { success: true, failureReason: null, detail: null };
    }
    if (requireJob) {
      return {
        success: false,
        failureReason: 'Print failed',
        detail: `No print job reached "${printerName}". The printer works in Windows, but the ERP job was not accepted — check the driver / USB connection, or try Test Print in Settings.`,
      };
    }
    return { success: true, failureReason: null, detail: null };
  }

  /**
   * Wait for Electron's real print callback + require spooler job when possible.
   * Prefer Windows file PrintTo for invoices (Canon CAPT); this is mainly for labels.
   */
  async function runWebContentsPrintVerified(webContents, options, printerName, timeoutMs = 15_000) {
    const before = await getPrintQueueStatus(printerName);
    if (before.hasError || before.online === false) {
      return {
        success: false,
        failureReason: 'printer_error',
        detail: before.errorDetail || `Printer "${printerName}" is not ready`,
      };
    }

    const printResult = await runWebContentsPrint(webContents, options, timeoutMs);

    if (!printResult.success) {
      if (/timed out/i.test(printResult.failureReason || '')) {
        const confirm = await confirmSpoolerAccepted(printerName, before.jobCount, {
          settleMs: 2_000,
          requireJob: true,
        });
        if (confirm.success) {
          return { success: true, failureReason: null, detail: null, modeHint: 'spooler-confirmed' };
        }
        return {
          success: false,
          failureReason: 'Print timed out — check printer and try again',
          detail: confirm.detail || 'Could not confirm the print job was accepted',
        };
      }
      const afterFail = await getPrintQueueStatus(printerName);
      return {
        success: false,
        failureReason: printResult.failureReason || 'Print failed',
        detail: afterFail.errorDetail || printResult.failureReason || 'Print failed',
      };
    }

    const confirm = await confirmSpoolerAccepted(printerName, before.jobCount, {
      settleMs: 4_000,
      requireJob: true,
    });
    if (!confirm.success) {
      return confirm;
    }
    return { success: true, failureReason: null, detail: null };
  }

  // Printer hard margins don't change between jobs — read once per
  // printer+paper (a PowerShell round-trip), then reuse. Falls back to 0.25in
  // (a safe value for typical lasers) when the driver can't report it.
  const hardMarginCache = new Map();
  async function getCachedHardMarginIn(printerName, paperName) {
    const key = `${printerName}|${paperName || ''}`;
    if (hardMarginCache.has(key)) return hardMarginCache.get(key);
    const { getPrinterHardMarginIn } = require('./lib/windowsPrint');
    const measured = await getPrinterHardMarginIn(printerName, paperName);
    const value = measured != null ? measured : 0.25;
    if (measured != null) hardMarginCache.set(key, value);
    return value;
  }

  async function printPdfViaWindows(pdfPath, printerName) {
    const { printFileToWindowsPrinter, trySumatraPrint } = require('./lib/windowsPrint');
    try {
      const usedSumatra = await trySumatraPrint(pdfPath, printerName);
      if (usedSumatra) return { method: 'sumatra' };
    } catch (err) {
      console.warn('[print] SumatraPDF failed:', err.message);
    }
    await printFileToWindowsPrinter(pdfPath, printerName, { timeoutMs: 15_000 });
    return { method: 'shell-printto' };
  }

  function isUncPrinterName(name) {
    return String(name || '').trim().startsWith('\\\\');
  }

  function isReplicaClientPc() {
    try {
      const cfg = loadConfig();
      return cfg.mode === 'join' || cfg.role === 'replica' || cfg.role === 'client';
    } catch {
      return false;
    }
  }

  function hostApiBaseUrl() {
    try {
      const cfg = loadConfig();
      if (isReplicaClientPc()) {
        return String(cfg.branch_api_url || cfg.host_api_url || '').replace(/\/$/, '');
      }
      return String(cfg.local_api_url || 'http://127.0.0.1:8080').replace(/\/$/, '');
    } catch {
      return 'http://127.0.0.1:8080';
    }
  }

  /** Read designed page size from print HTML (custom 5.7in A5, barcode mm, or named A4/A5). */
  function parsePrintPageMetrics(html) {
    const src = String(html || '');
    const wAttr = /data-page-w-in=["']([\d.]+)/i.exec(src);
    const hAttr = /data-page-h-in=["']([\d.]+)/i.exec(src);
    const paperAttr = /data-paper=["']([A-Za-z0-9]+)["']/i.exec(src);
    const paperWidthMmAttr = /data-paper-width-mm=["']([\d.]+)["']/i.exec(src);
    const named = /@page\s*\{[^}]*\bsize:\s*([A-Za-z][A-Za-z0-9]*)/i.exec(src);
    const inchSize = /@page\s*\{[^}]*\bsize:\s*([\d.]+)\s*in\s+([\d.]+)\s*in/i.exec(src);
    const mmSize = /@page\s*\{[^}]*\bsize:\s*([\d.]+)\s*mm\s+([\d.]+)\s*mm/i.exec(src);
    let pageWidthIn = wAttr ? Number(wAttr[1]) : 0;
    let pageHeightIn = hAttr ? Number(hAttr[1]) : 0;
    if (!(pageWidthIn > 0 && pageHeightIn > 0) && inchSize) {
      pageWidthIn = Number(inchSize[1]);
      pageHeightIn = Number(inchSize[2]);
    }
    if (!(pageWidthIn > 0 && pageHeightIn > 0) && mmSize) {
      pageWidthIn = Number(mmSize[1]) / 25.4;
      pageHeightIn = Number(mmSize[2]) / 25.4;
    }
    const paperSizeName = (paperAttr && paperAttr[1]) || (named && named[1]) || null;
    return {
      pageWidthIn: pageWidthIn > 0 ? pageWidthIn : null,
      pageHeightIn: pageHeightIn > 0 ? pageHeightIn : null,
      paperSizeName: paperSizeName ? String(paperSizeName).toUpperCase() : null,
      paperWidthMm: paperWidthMmAttr ? Number(paperWidthMmAttr[1]) : null,
    };
  }

  /**
   * Rasterize loaded HTML to an array of Electron NativeImages, one per
   * physical page (full-fidelity pixels, not yet lossy-encoded) — shared by
   * captureHtmlToPngBuffers (GDI/host-relay, JPEG-encodes each page below)
   * and the ESC/POS thermal path (needs raw pixels to threshold, never a
   * JPEG — compression artifacts would corrupt the black/white threshold;
   * thermal is undeclared-height so it always gets back exactly one page).
   * Capture the designed CSS page size — never pad to 600px or GDI will
   * print the wrong width. Keep the helper window hidden — showing it (even
   * off-screen) steals OS focus and can leave the ERP UI unable to focus
   * inputs until restart.
   */
  async function captureHtmlToNativeImage(webContents) {
    try {
      webContents.setZoomFactor(1);
      await waitForZoomFactor(webContents, 1, 400);
    } catch { /* */ }
    await webContents.executeJavaScript(`(async () => {
      const imgs = Array.from(document.images || []);
      await Promise.all(imgs.map((img) => {
        if (img.complete) return null;
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      }));
      // "load" only means the bytes arrived — a large letterhead can still be
      // mid-decode. decode() resolves once it is paint-ready.
      await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
    })()`).catch(() => {});
    const metrics = await webContents.executeJavaScript(`(() => {
      const html = document.documentElement;
      // Long bills are now split into genuinely separate .page elements
      // (see invoicePrint.js) — each one already the correct, uniform
      // per-page height with its own header/footer padding reserved, so the
      // real page count is just how many of them exist, not a height ratio.
      const pages = document.querySelectorAll('.page');
      const page = pages[0] || document.querySelector('.tag') || document.body;
      const wIn = parseFloat(html.getAttribute('data-page-w-in') || '0') || 0;
      const hIn = parseFloat(html.getAttribute('data-page-h-in') || '0') || 0;
      const w = Math.round(page?.offsetWidth || (wIn * 96) || 547);
      const h = Math.round(page?.offsetHeight || (hIn * 96) || 794);
      return { w, h, wIn, hIn, pageCount: pages.length || 1 };
    })()`).catch(() => ({ w: 547, h: 794, wIn: 5.7, hIn: 8.27, pageCount: 1 }));

    const width = Math.min(1400, Math.max(80, Number(metrics.w) || 547));
    // A5/invoice layouts declare a fixed data-page-h-in. Thermal receipts have
    // no fixed height (the roll just feeds to content length) and were being
    // clipped by the same 1400px cap — Chromium then rendered a real
    // scrollbar for the clipped overflow, which got captured and printed as
    // part of the receipt image. Give undeclared-height content (no
    // data-page-h-in) much more headroom, and treat it as always one shot —
    // a thermal roll has no page boundary to paginate against.
    const hasDeclaredHeight = Number(metrics.hIn) > 0;
    const heightCap = hasDeclaredHeight ? 2800 : 8000;
    const height = Math.min(heightCap, Math.max(40, Number(metrics.h) || 794));
    const pageWidthIn = Number(metrics.wIn) > 0 ? Number(metrics.wIn) : width / 96;
    const pageHeightIn = Number(metrics.hIn) > 0 ? Number(metrics.hIn) : height / 96;

    // Long declared-height invoices (many items/payment rows) can now split
    // into multiple .page elements instead of overwriting the footer's
    // reserved blank zone — capture one screenshot per real page instead of
    // one. Capped at 10 pages as a sanity bound. Undeclared-height (thermal)
    // content keeps the original single-shot behavior.
    const pagesNeeded = hasDeclaredHeight
      ? Math.max(1, Math.min(10, Number(metrics.pageCount) || 1))
      : 1;
    const captureHeight = hasDeclaredHeight ? Math.max(1, Math.round(pageHeightIn * 96)) : Math.min(height, heightCap);
    const totalRenderHeight = captureHeight * pagesNeeded;

    // Oversample: capture at OVERSAMPLE× the window size + page zoom, so the
    // bitmap handed to printImageGdi (windowsPrint.js) — which stretches it to
    // fill the physical page — has enough real pixel detail to look sharp on
    // a ~203dpi thermal head instead of soft/blurry. pageWidthIn/pageHeightIn
    // below still derive from the ORIGINAL width/captureHeight, so the
    // physical print size is unaffected — only pixel density goes up.
    //
    // The first attempt at this shrank the printed content into a corner
    // instead of sharpening it — the window resize + zoomFactor change were
    // fired together and captured after only a fixed, short delay, before the
    // zoom had actually finished applying in the renderer. This time we
    // actively poll window.innerWidth (which reflects the real post-zoom
    // layout viewport, not just the zoom value we asked for) until it settles
    // back to the pre-zoom logical width, instead of guessing a delay.
    const OVERSAMPLE = 3;
    const capWidth = Math.round(width * OVERSAMPLE);
    const capHeight = Math.round(totalRenderHeight * OVERSAMPLE);
    const targetInnerWidth = Math.round(width);

    const owner = BrowserWindow.fromWebContents(webContents);
    let zoomVerified = false;
    try {
      if (owner && !owner.isDestroyed()) {
        owner.setSize(capWidth, capHeight);
        webContents.setZoomFactor(OVERSAMPLE);
        try { owner.setIgnoreMouseEvents(true); } catch { /* */ }
        // Stay hidden — do NOT showInactive/show (focus steal on Windows)

        // Poll for the zoom to have actually visually applied (up to ~600ms) —
        // window.innerWidth reflects the real post-zoom layout viewport, not
        // just the zoom value we asked for, so this catches the exact race
        // that caused the earlier regression instead of guessing a delay.
        const deadline = Date.now() + 600;
        while (Date.now() < deadline) {
          let innerWidth = 0;
          try {
            innerWidth = await webContents.executeJavaScript('window.innerWidth');
          } catch { /* */ }
          if (Math.abs(Number(innerWidth) - targetInnerWidth) <= 2) { zoomVerified = true; break; }
          await new Promise((r) => setTimeout(r, 40));
        }
        // Never trust an unverified zoom — that's exactly how the earlier
        // regression happened (window resized, zoom not yet applied, captured
        // anyway → tiny content in a big blank capture). Fall back to the
        // known-good 1× capture instead of risking that again.
        if (!zoomVerified) {
          console.warn('[print] oversample zoom did not verify in time — falling back to 1x capture');
          try { webContents.setZoomFactor(1); } catch { /* */ }
          owner.setSize(Math.round(width), Math.round(totalRenderHeight));
          await new Promise((r) => setTimeout(r, 80));
        }
      }
    } catch { /* */ }

    let finalWidth = zoomVerified ? capWidth : Math.round(width);
    let finalCaptureHeight = zoomVerified ? Math.round(captureHeight * OVERSAMPLE) : Math.round(captureHeight);
    await new Promise((r) => setTimeout(r, 80));

    // One capturePage() per physical page, sliced by vertical offset out of
    // the single tall render above — page 1 unchanged (y:0) when content
    // fits on one page (pagesNeeded === 1, the overwhelmingly common case).
    //
    // `scale` corrects for a Windows display-scaling mismatch (e.g. a client
    // laptop running 125%/150% scaling, common and often different from the
    // host PC) that this window's own resize/zoom above doesn't account for.
    // capturePage's rect is expected to behave in DIPs regardless of display
    // scale, but that hasn't held up in testing on at least one client PC —
    // rather than guess a fixed correction, detect it directly from the
    // first page's actual returned size and compensate for the rest of this
    // job, or fail loudly instead of silently printing a cropped page.
    const images = [];
    let scale = 1;
    try {
    for (let i = 0; i < pagesNeeded; i += 1) {
      let captureRect = {
        x: 0,
        y: Math.round(i * finalCaptureHeight * scale),
        width: Math.round(finalWidth * scale),
        height: Math.round(finalCaptureHeight * scale),
      };
      let image = await webContents.capturePage(captureRect);
      // If capture is empty while hidden (rare GPU driver case), briefly paint off-screen then hide.
      if (!image || image.isEmpty?.() || image.getSize().width < 2) {
        try {
          if (owner && !owner.isDestroyed()) {
            owner.setPosition(-10000, -10000);
            owner.setOpacity(0);
            owner.showInactive();
            await new Promise((r) => setTimeout(r, 100));
            image = await webContents.capturePage(captureRect);
            owner.hide();
            owner.setOpacity(1);
          }
        } catch { /* */ }
        forceMainWindowFocus(owner, { force: true });
      }
      if (!image || image.isEmpty?.()) {
        throw new Error(`Invoice capture was empty (page ${i + 1} of ${pagesNeeded}) — cannot print`);
      }

      // Detect + correct a short capture once, on the first page — the same
      // scale then applies to every remaining page of this job (one window,
      // one display).
      if (i === 0 && scale === 1) {
        const gotSize = image.getSize();
        const shortfall = captureRect.width / Math.max(1, gotSize.width);
        if (gotSize.width > 2 && shortfall > 1.03 && shortfall <= 4) {
          console.warn(
            '[print] capture width %dpx short of requested %dpx (~%sx) — retrying at compensated size',
            gotSize.width, captureRect.width, shortfall.toFixed(2),
          );
          scale = shortfall;
          try {
            if (owner && !owner.isDestroyed()) {
              owner.setSize(Math.round(finalWidth * scale), Math.round(finalCaptureHeight * scale * pagesNeeded));
              await new Promise((r) => setTimeout(r, 150));
              captureRect = { x: 0, y: 0, width: Math.round(finalWidth * scale), height: Math.round(finalCaptureHeight * scale) };
              image = await webContents.capturePage(captureRect);
            }
          } catch { /* keep the uncorrected capture rather than lose the page entirely */ }
        }
      }

      // Stale-frame guard (page 1 only — every page shares the same frame).
      // innerWidth confirms the 3× zoom was *laid out*, not that it was
      // *painted*: a heavy page (full-size letterhead image) can still hand
      // capturePage the previous 1× frame, which shows up as the whole bill
      // squeezed into the top-left third of an otherwise blank capture.
      // Retry until the painted content really spans the page; if it never
      // does, fall back to a plain 1× capture — slightly softer, but full size.
      if (i === 0 && zoomVerified && isStaleOversampleCapture(image, OVERSAMPLE)) {
        // 1) Cheap: ask the hidden window to repaint.
        const softDeadline = Date.now() + 600;
        while (Date.now() < softDeadline && isStaleOversampleCapture(image, OVERSAMPLE)) {
          try { webContents.invalidate(); } catch { /* */ }
          await new Promise((r) => setTimeout(r, 150));
          image = await webContents.capturePage(captureRect);
        }
        // 2) A hidden window may simply not paint on some PCs — briefly make it
        //    "visible" off-screen and fully transparent (same trick as the
        //    empty-capture case above) so Chromium produces a real 3× frame.
        if (isStaleOversampleCapture(image, OVERSAMPLE) && owner && !owner.isDestroyed()) {
          try {
            owner.setPosition(-10000, -10000);
            owner.setOpacity(0);
            owner.showInactive();
            const shownDeadline = Date.now() + 1500;
            do {
              try { webContents.invalidate(); } catch { /* */ }
              await new Promise((r) => setTimeout(r, 120));
              image = await webContents.capturePage(captureRect);
            } while (Date.now() < shownDeadline && isStaleOversampleCapture(image, OVERSAMPLE));
          } catch { /* */ } finally {
            try { owner.hide(); owner.setOpacity(1); } catch { /* */ }
            forceMainWindowFocus(owner, { force: true });
          }
        }
        // 3) Last resort: plain 1× capture (softer, but full size).
        if (isStaleOversampleCapture(image, OVERSAMPLE)) {
          console.warn('[print] oversample capture never repainted — falling back to 1x capture');
          zoomVerified = false;
          finalWidth = Math.round(width);
          finalCaptureHeight = Math.round(captureHeight);
          try {
            webContents.setZoomFactor(1);
            await waitForZoomFactor(webContents, 1, 400);
            if (owner && !owner.isDestroyed()) {
              owner.setSize(Math.round(finalWidth * scale), Math.round(finalCaptureHeight * scale * pagesNeeded));
            }
          } catch { /* */ }
          await new Promise((r) => setTimeout(r, 250));
          captureRect = { x: 0, y: 0, width: Math.round(finalWidth * scale), height: Math.round(finalCaptureHeight * scale) };
          image = await webContents.capturePage(captureRect);
        }
      }

      // Still short after a correction attempt (or correction wasn't
      // possible) — fail clearly instead of silently sending a cropped page
      // to the printer.
      const finalSize = image?.getSize?.() || { width: 0 };
      if (finalSize.width < captureRect.width - 4) {
        throw new Error(
          `Print capture came out narrower than expected on this PC (got ${finalSize.width}px, expected ${captureRect.width}px). `
          + 'Try setting this computer\'s display scaling to 100% in Windows Display Settings, or contact support.',
        );
      }

      images.push(image);
    }
    } finally {
      // Always restore zoom to 1 AND shrink the window back down — this
      // window/webContents is reused for the next print job (and briefly
      // shown for the "system print dialog" last-resort fallback). This used
      // to run only after the loop above completed successfully, so a
      // thrown capture error (either throw in the loop) skipped it entirely,
      // leaving the window oversampled/zoomed-in for whatever job ran next —
      // which then captured a tiny, correct-content-in-a-huge-canvas image
      // instead of failing loudly. A finally block means this always runs,
      // error or not.
      try { webContents.setZoomFactor(1); } catch { /* */ }
      try { await waitForZoomFactor(webContents, 1, 400); } catch { /* */ }
      try {
        if (owner && !owner.isDestroyed()) owner.setSize(Math.round(width), Math.round(totalRenderHeight));
      } catch { /* */ }
    }

    return { images, width: finalWidth, height: finalCaptureHeight, pageWidthIn, pageHeightIn, pageCount: pagesNeeded };
  }

  /** JPEG-encoded wrapper around captureHtmlToNativeImage, for the GDI/host-relay
   * path (unchanged behavior from before the ESC/POS split, now page-count-aware). */
  async function captureHtmlToPngBuffers(webContents) {
    const { images, width, height, pageWidthIn, pageHeightIn, pageCount } = await captureHtmlToNativeImage(webContents);
    const buffers = images.map((image) => {
      const jpeg = image?.toJPEG?.(85);
      if (jpeg && jpeg.length >= 500) {
        return { buffer: jpeg, mimeType: 'image/jpeg' };
      }
      const png = image?.toPNG?.();
      if (!png || png.length < 500) {
        throw new Error('Invoice capture was empty — cannot print');
      }
      return { buffer: png, mimeType: 'image/png' };
    });
    return { buffers, width, height, pageWidthIn, pageHeightIn, pageCount };
  }

  async function printHtmlAsImageViaWindows(webContents, printerName, tempPngPath, paperSizeName = null, pageSize = {}) {
    const { printFileToWindowsPrinter } = require('./lib/windowsPrint');
    const captured = await captureHtmlToPngBuffers(webContents);
    const pageWidthIn = captured.pageWidthIn || pageSize.pageWidthIn || null;
    const pageHeightIn = captured.pageHeightIn || pageSize.pageHeightIn || null;
    const outPaths = [];
    let totalBytes = 0;
    // Awaited in order (not Promise.all) — physical pages must come out of
    // the printer in the right sequence, page 1 before page 2.
    for (let i = 0; i < captured.buffers.length; i += 1) {
      const { buffer, mimeType } = captured.buffers[i];
      const ext = mimeType === 'image/jpeg' ? '.jpg' : '.png';
      const outPath = i === 0
        ? tempPngPath.replace(/\.png$/i, ext)
        : tempPngPath.replace(/\.png$/i, `.p${i + 1}${ext}`);
      fs.writeFileSync(outPath, buffer);
      await printFileToWindowsPrinter(outPath, printerName, {
        timeoutMs: 20_000,
        paperSizeName,
        pageWidthIn,
        pageHeightIn,
      });
      outPaths.push(outPath);
      totalBytes += buffer.length;
    }
    // PowerShell / GDI print can steal Windows focus — reclaim ERP UI immediately
    try { forceMainWindowFocus(null, { force: true }); } catch { /* */ }
    for (const outPath of outPaths) {
      if (outPath !== tempPngPath) {
        try { fs.unlinkSync(outPath); } catch { /* */ }
      }
    }
    return {
      pageWidthIn,
      pageHeightIn,
      pageCount: captured.pageCount,
      bytes: totalBytes,
      path: outPaths[0],
    };
  }

  /**
   * Client PC → POST a JSON print job to the host's LAN API and wait for the
   * host to actually print it. Shared by the image relay (invoices) and the
   * raw-bytes relay (labels/estimation) — only the path and body differ.
   */
  async function postPrintJobToHost(apiPath, jsonBody, { authToken, timeoutMs = 35_000 } = {}) {
    const base = hostApiBaseUrl();
    if (!base) {
      throw new Error('Host API URL not configured — reconnect this client to the main PC');
    }
    if (!authToken) {
      throw new Error('Not signed in — cannot send print job to main PC');
    }
    const https = base.startsWith('https');
    const lib = https ? require('https') : require('http');
    const url = new URL(`${base}${apiPath}`);
    const body = JSON.stringify(jsonBody);

    return new Promise((resolve, reject) => {
      const req = lib.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (https ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Authorization: `Bearer ${authToken}`,
          },
          timeout: timeoutMs,
        },
        (res) => {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            let parsed = null;
            try { parsed = data ? JSON.parse(data) : null; } catch { parsed = { detail: data }; }
            if (res.statusCode >= 200 && res.statusCode < 300 && parsed?.success) {
              resolve(parsed);
            } else {
              const msg = parsed?.detail || parsed?.message || `Host print failed (HTTP ${res.statusCode})`;
              const err = new Error(msg);
              err.status = res.statusCode;
              err.code = parsed?.code;
              reject(err);
            }
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Host print timed out — check LAN connection to main PC'));
      });
      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  }

  /**
   * Client PC → send one rendered page to host LAN API so the USB Canon on
   * the main PC prints it. Network \\HOST\Canon shares are unreliable with
   * CAPT (jobs vanish from both queues).
   */
  async function relayPrintImageToHostOnePage({ buffer, mimeType, preferredPrinter, authToken, paperSizeName, pageWidthIn, pageHeightIn, fillPaper = false, paperKind = 0 }) {
    return postPrintJobToHost('/api/system/print-image', {
      image_base64: buffer.toString('base64'),
      mime_type: mimeType || 'image/jpeg',
      preferred_printer: preferredPrinter || null,
      paper_size: paperSizeName || null,
      page_width_in: pageWidthIn || null,
      page_height_in: pageHeightIn || null,
      fill_page: Boolean(fillPaper),
      paper_kind: Number(paperKind) || 0,
    }, { authToken });
  }

  /**
   * Client PC → send raw printer bytes (TSPL bitmap / ESC-POS) to the host's
   * LAN API so a label/estimation printer physically attached only to the
   * host actually prints it — the raw-byte counterpart to
   * relayPrintImageToHostOnePage, for printers that use the RAW spooler
   * datatype instead of a rendered image (see sendRawToWindowsPrinter above:
   * that mechanism only works when the printer is local to the calling
   * machine, so a client PC must relay the bytes to the host instead of
   * writing them to the spooler itself).
   */
  async function relayRawBytesToHost({ bytes, preferredPrinter, authToken }) {
    return postPrintJobToHost('/api/system/print-raw', {
      bytes_base64: Buffer.from(bytes).toString('base64'),
      preferred_printer: preferredPrinter || null,
    }, { authToken });
  }

  /**
   * Client PC → relay every captured page to the host in order (page 1 fully
   * accepted before page 2 is sent), so a long letterhead invoice comes out
   * of the main PC's printer as correctly-ordered multi-page output instead
   * of just its first page.
   */
  async function relayPrintImageToHost({ buffers, preferredPrinter, authToken, paperSizeName, pageWidthIn, pageHeightIn, fillPaper = false, paperKind = 0 }) {
    let result = null;
    for (const { buffer, mimeType } of buffers) {
      result = await relayPrintImageToHostOnePage({
        buffer, mimeType, preferredPrinter, authToken, paperSizeName, pageWidthIn, pageHeightIn, fillPaper, paperKind,
      });
    }
    return result;
  }

  ipcMain.handle('print:html', (event, html, opts = {}) => {
    assertIpcSender(event);
    if (typeof html !== 'string' || html.length > 12_000_000) {
      return { success: false, failureReason: 'Invalid HTML' };
    }
    return withPrintLock(() => printHtmlHandler(event, html, opts));
  });

  async function printHtmlHandler(event, html, opts = {}) {
    const printerType = opts?.printerType || 'invoice'; // 'invoice' | 'label' | 'estimation' | 'report'
    const pageMetrics = parsePrintPageMetrics(html);
    const paperSizeName = pageMetrics.paperSizeName;
    const t0 = Date.now();
    const os = require('os');
    const stamp = Date.now();
    const tempHtmlPath = path.join(os.tmpdir(), `crm-print-${stamp}.html`);
    const tempPdfPath = path.join(os.tmpdir(), `crm-print-${stamp}.pdf`);
    const win = getSharedPrintWindow({ fresh: true });
    // Fresh window is zoom 1 / 800×900. Also pin the CSS page width before
    // load so Chromium does not lay the bill out in a leftover-wide viewport.
    try {
      const resetWidth = Math.max(80, Math.round((pageMetrics.pageWidthIn || 5.7) * 96));
      win.setSize(resetWidth, 900);
      win.webContents.setZoomFactor(1);
      await waitForZoomFactor(win.webContents, 1, 400);
    } catch { /* */ }

    const cleanupTemp = () => { try { fs.unlinkSync(tempHtmlPath); } catch { /* */ } };
    const cleanupPdfLater = () => { setTimeout(() => { try { fs.unlinkSync(tempPdfPath); } catch { /* */ } }, 60_000); };

    const restoreMainFocus = () => forceMainWindowFocus(win, { force: true });

    const loadPrintHtml = (filePath, timeoutMs = 12_000) => new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const onOk = () => { cleanup(); resolve(); };
      const onFail = (_e, code, desc) => { cleanup(); reject(new Error(`Page load failed (${code}): ${desc}`)); };
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        win.webContents.removeListener('did-finish-load', onOk);
        win.webContents.removeListener('did-fail-load', onFail);
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('Print preview load timed out'));
      }, timeoutMs);
      win.webContents.once('did-finish-load', onOk);
      win.webContents.once('did-fail-load', onFail);
      win.loadFile(filePath).catch((err) => { cleanup(); reject(err); });
    });

    // Resolve the correct printer for this job type
    async function resolveDeviceName() {
      const cfg = loadConfig();
      const prefs = cfg.printer_prefs || {};
      if (printerType === 'label') {
        // Unlike invoice ("Windows default (auto)") and estimation ("Same as
        // invoice printer"), Settings never offers a fallback for the label
        // printer — it only ever shows "Not assigned". Falling through to
        // resolvePrintTargetFast() below would silently print the barcode on
        // a completely different (invoice/default) printer and report
        // success, contradicting what Settings shows. Stop here instead, so
        // the "No label printer assigned" message further down actually
        // fires when nothing has been chosen.
        return (prefs.label && !isVirtualPrinterName(prefs.label)) ? prefs.label : null;
      }
      if (printerType === 'estimation' && prefs.estimation && !isVirtualPrinterName(prefs.estimation)) return prefs.estimation;
      if (printerType === 'estimation' && prefs.invoice && !isVirtualPrinterName(prefs.invoice)) return prefs.invoice;
      if (printerType === 'invoice' && prefs.invoice && !isVirtualPrinterName(prefs.invoice)) return prefs.invoice;
      if (printerType === 'report' && prefs.invoice && !isVirtualPrinterName(prefs.invoice)) return prefs.invoice;
      // Fallback: default physical printer (invoice/report/estimation only —
      // these fallbacks are visible, intentional choices shown in Settings).
      return resolvePrintTargetFast();
    }

    try {
      const deviceName = await resolveDeviceName();
      console.log('[print] type=%s target=%s resolveMs=%d', printerType, deviceName || '(none)', Date.now() - t0);

      // Client PC or \\HOST\Printer share → this job must be relayed to the
      // main PC to actually print (see relayPrintImageToHost /
      // relayRawBytesToHost below) — used by every print path, not just the
      // generic image one further down.
      const useHostRelay = isUncPrinterName(deviceName) || isReplicaClientPc();

      if (!deviceName) {
        return {
          success: false,
          failureReason: printerType === 'label'
            ? 'No label printer assigned. Go to Settings → Printers & Devices and select your label printer.'
            : printerType === 'estimation'
              ? 'No estimation printer assigned. Go to Settings → Printers & Devices and select your estimation printer.'
              : printerType === 'report'
                ? 'No printer assigned. Go to Settings → Printers & Devices and select your printer.'
                : 'No invoice printer assigned. Go to Settings → Printers & Devices and select your printer.',
        };
      }

      // Always verify connectivity before claiming print success (USB unplug still lists the printer).
      // Network \\HOST\Printer shares are checked lightly — they often look "online" while CAPT drops jobs.
      {
        const deep = !isUncPrinterName(deviceName);
        const live = await checkPrinterConnected(deviceName, { deep });
        if (!live.connected && !isUncPrinterName(deviceName)) {
          console.warn('[print] not connected: %s (%s)', deviceName, live.detail);
          return {
            success: false,
            failureReason: 'no_printer',
            detail: live.detail || `Printer "${deviceName}" is not connected`,
            deviceName,
          };
        }
      }

      // ── Reports: render a real PDF and open that, never the single-page
      // screenshot path and never raw HTML. Reports/statements can run to
      // many pages of rows — the screenshot-then-stretch-to-fit-one-page
      // approach used for invoices/receipts has no concept of "multiple
      // pages" at all, which is exactly why a long report was coming out as
      // everything squeezed onto one sheet.
      //
      // First attempt hosted Chromium's native print dialog inside the app's
      // own hidden background window — that window is deliberately
      // frameless/non-focusable (built to stay invisible for silent receipt
      // printing), and forcing it to act as an interactive dialog host
      // produced an unresponsive, uncloseable window.
      // Second attempt opened the raw HTML in the default browser — better,
      // but still a raw web page rather than an actual document, and jarring
      // to jump out of the app for.
      // A real PDF (the same generation Chromium already does correctly for
      // Download) opened via the OS's default PDF handler gives a proper
      // paginated document view with a normal, working print button — no
      // custom dialog code of ours involved at all.
      if (printerType === 'report') {
        fs.writeFileSync(tempHtmlPath, html, 'utf8');
        try {
          await loadPrintHtml(tempHtmlPath, 8_000);
          const pdfBuffer = await win.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true,
            margins: { marginType: 'default' },
          });
          fs.writeFileSync(tempPdfPath, pdfBuffer);
          cleanupTemp();
          await shell.openPath(tempPdfPath);
        } catch (err) {
          cleanupTemp();
          return {
            success: false,
            failureReason: 'Print failed',
            detail: err.message || 'Could not open the report',
            deviceName: null,
            mode: 'pdf-view',
          };
        }
        // Whatever opened the PDF needs the file to still exist while it's
        // open — clean up well after a reasonable review/print session
        // (cleanupPdfLater's 60s is tuned for quick invoice PDFs, not a
        // report someone may spend several minutes reviewing before printing).
        setTimeout(() => { try { fs.unlinkSync(tempPdfPath); } catch { /* */ } }, 30 * 60_000);
        console.log('[print] report PDF opened totalMs=%d', Date.now() - t0);
        return { success: true, failureReason: null, deviceName: null, mode: 'pdf-view' };
      }

      // ── Labels: wait for real print callback + spooler confirmation ──
      if (printerType === 'label') {
        const rawTsplBase64 = typeof opts?.rawTsplBase64 === 'string' ? opts.rawTsplBase64 : null;
        const rawTspl = typeof opts?.rawTspl === 'string' ? opts.rawTspl : null;
        // Prefer base64 BITMAP. Do not use rawTspl string when it looks like binary (corrupts over IPC).
        const hasBitmap = Boolean(rawTsplBase64 && rawTsplBase64.length > 80);
        const looksLikeTsc = /tsc|te24|te31|da21|mb24|label|barcode/i.test(deviceName);
        if (hasBitmap || (rawTspl && rawTspl.includes('BITMAP') && looksLikeTsc)) {
          const rawPayload = hasBitmap
            ? Buffer.from(rawTsplBase64, 'base64')
            : Buffer.from(rawTspl, 'binary');
          if (!rawPayload.length) {
            return {
              success: false,
              failureReason: 'Print failed',
              detail: 'Empty label print payload',
              deviceName,
              mode: 'label-raw',
            };
          }
          // Sanity: BITMAP jobs must contain TSPL BITMAP command (after SIZE/GAP header)
          const probe = rawPayload.subarray(0, Math.min(800, rawPayload.length)).toString('latin1');
          if (!/BITMAP\s/i.test(probe)) {
            console.warn('[print] label payload missing BITMAP — refusing text-only fallback');
            return {
              success: false,
              failureReason: 'Print failed',
              detail: 'Label payload is not a preview bitmap. Restart ERP and try Test print again.',
              deviceName,
              mode: 'label-raw',
            };
          }

          // Client PC → the label printer is only physically attached to the
          // host, and the RAW spooler datatype below only works on the
          // machine the printer is actually local to — relay the bytes
          // instead of writing to this machine's (non-existent) local queue.
          if (useHostRelay) {
            try {
              const hostResult = await relayRawBytesToHost({
                bytes: rawPayload,
                preferredPrinter: deviceName,
                authToken: opts?.authToken || null,
              });
              console.log('[print] label-raw host-relay ok → %s totalMs=%d bytes=%d', hostResult.deviceName || deviceName, Date.now() - t0, rawPayload.length);
              return { success: true, failureReason: null, deviceName: hostResult.deviceName || deviceName, mode: 'host-raw' };
            } catch (err) {
              console.warn('[print] label-raw host-relay failed:', err.message);
              return {
                success: false,
                failureReason: 'Print failed',
                detail: err.message || 'Could not print label via main PC. Check LAN, and that the label printer is connected to the main PC.',
                deviceName,
                mode: 'host-raw',
              };
            }
          }

          try {
            const beforeRaw = await getPrintQueueStatus(deviceName);
            if (beforeRaw.hasError || beforeRaw.online === false) {
              return {
                success: false,
                failureReason: 'printer_error',
                detail: beforeRaw.errorDetail || `Printer "${deviceName}" is not ready`,
                deviceName,
                mode: 'label-raw',
              };
            }
            const { sendRawToWindowsPrinter } = require('./lib/rawPrinter');
            await Promise.race([
              sendRawToWindowsPrinter(deviceName, rawPayload),
              new Promise((_, reject) => setTimeout(() => reject(new Error('TSPL timeout')), 8_000)),
            ]);
            const confirm = await confirmSpoolerAccepted(deviceName, beforeRaw.jobCount, {
              settleMs: 1_200,
              requireJob: false,
            });
            if (!confirm.success) {
              console.warn('[print] label-raw spooler error → %s', confirm.detail);
              return { ...confirm, deviceName, mode: 'label-raw' };
            }
            console.log('[print] label-raw ok → %s totalMs=%d bytes=%d', deviceName, Date.now() - t0, rawPayload.length);
            return { success: true, failureReason: null, deviceName, mode: 'label-raw' };
          } catch (err) {
            console.warn('[print] label-raw failed:', err.message);
            // Do NOT fall through to HTML silent print — TSC GDI path uses printer fonts
            // and will not match Live Preview (causes SSJ(22K)/monospace tags).
            return {
              success: false,
              failureReason: 'Print failed',
              detail: `Label bitmap print failed: ${err.message}. Restart the desktop ERP and retry Test print.`,
              deviceName,
              mode: 'label-raw',
            };
          }
        }

        // No bitmap payload — refuse HTML-to-TSC (never matches preview)
        if (looksLikeTsc) {
          return {
            success: false,
            failureReason: 'Print failed',
            detail: 'Missing label bitmap. Open Settings → Barcode Tag, click Save layout, then Test print sample.',
            deviceName,
            mode: 'label-raw',
          };
        }

        fs.writeFileSync(tempHtmlPath, html, 'utf8');
        await loadPrintHtml(tempHtmlPath);

        const result = await runWebContentsPrintVerified(win.webContents, {
          silent: true,
          printBackground: true,
          deviceName,
          preferCSSPageSize: true,
          margins: { marginType: 'none' },
        }, deviceName, 20_000);
        cleanupTemp();
        console.log('[print] label-html ok=%s → %s totalMs=%d', result.success, deviceName, Date.now() - t0);
        if (!result.success) {
          return {
            ...result,
            failureReason: result.failureReason || 'Print failed',
            detail: result.detail || 'Label printer did not accept the job. Check USB, driver, and Settings → Label Printer.',
            deviceName,
            mode: 'label-silent',
          };
        }
        return { success: true, failureReason: null, deviceName, mode: 'label-silent' };
      }

      // ── Thermal Estimation: ESC/POS raw raster print — the successor to the
      // native-driver-print attempt above (reverted: Chromium's silent print
      // reported success while no job reached the spooler on a real EPSON
      // TM-T82X-II). This instead sends raw ESC/POS bytes over the Windows
      // RAW datatype, the same proven mechanism TSC barcode labels already
      // use, bypassing both Chromium's print API and GDI/JPEG entirely — no
      // lossy compression, and no "page size" concept to mismatch against
      // (the printer just prints as many raster rows as sent and cuts).
      // A5 estimation and Invoice are untouched — they keep the GDI/JPEG
      // path below (Invoice for a real reason: Canon CAPT drivers silently
      // no-op'd on Chromium's silent print too).
      if (printerType === 'estimation' && paperSizeName === 'THERMAL') {
        try {
          const { nativeImageToMonoRaster, buildEscPosReceipt, widthDotsForRoll } = require('./lib/escposPrint');
          const { sendRawToWindowsPrinter } = require('./lib/rawPrinter');

          fs.writeFileSync(tempHtmlPath, html, 'utf8');
          await loadPrintHtml(tempHtmlPath);
          // Thermal receipts are always undeclared-height → captureHtmlToNativeImage
          // always returns exactly one page (a roll has no page boundary to split on).
          const { images } = await captureHtmlToNativeImage(win.webContents);
          const image = images[0];
          cleanupTemp();

          const widthDots = widthDotsForRoll(pageMetrics.paperWidthMm || 80);
          const raster = nativeImageToMonoRaster(image, widthDots);
          const escposBuffer = buildEscPosReceipt(raster);

          // Client PC → the thermal estimation printer is only physically
          // attached to the host; relay the raw ESC/POS bytes there instead
          // of writing to this machine's (non-existent) local queue.
          if (useHostRelay) {
            const hostResult = await relayRawBytesToHost({
              bytes: escposBuffer,
              preferredPrinter: deviceName,
              authToken: opts?.authToken || null,
            });
            console.log('[print] estimation-escpos host-relay ok → %s totalMs=%d bytes=%d', hostResult.deviceName || deviceName, Date.now() - t0, escposBuffer.length);
            return { success: true, failureReason: null, deviceName: hostResult.deviceName || deviceName, mode: 'host-raw' };
          }

          const before = await getPrintQueueStatus(deviceName);
          if (before.hasError || before.online === false) {
            return {
              success: false,
              failureReason: 'printer_error',
              detail: before.errorDetail || `Printer "${deviceName}" is not ready`,
              deviceName,
              mode: 'estimation-escpos',
            };
          }
          await sendRawToWindowsPrinter(deviceName, escposBuffer);
          const confirm = await confirmSpoolerAccepted(deviceName, before.jobCount, { settleMs: 4_000, requireJob: false });
          console.log('[print] estimation-escpos ok=%s → %s totalMs=%d bytes=%d', confirm.success !== false, deviceName, Date.now() - t0, escposBuffer.length);
          if (confirm.success === false) {
            return { ...confirm, deviceName, mode: 'estimation-escpos' };
          }
          return { success: true, failureReason: null, deviceName, mode: 'estimation-escpos' };
        } catch (err) {
          cleanupTemp();
          console.warn('[print] estimation-escpos failed:', err.message);
          return {
            success: false,
            failureReason: 'Print failed',
            detail: `ESC/POS print failed: ${err.message}`,
            deviceName,
            mode: 'estimation-escpos',
          };
        }
      }

      fs.writeFileSync(tempHtmlPath, html, 'utf8');
      await loadPrintHtml(tempHtmlPath, 8_000);
      console.log('[print] loadedMs=%d', Date.now() - t0);

      const tempPngPath = path.join(os.tmpdir(), `crm-print-${stamp}.png`);
      const cleanupPngLater = (p) => {
        setTimeout(() => { try { fs.unlinkSync(p || tempPngPath); } catch { /* */ } }, 60_000);
      };

      // Client PC or \\HOST\Canon share → render here, print on main PC USB (CAPT-safe).
      if (useHostRelay) {
        try {
          const captured = await captureHtmlToPngBuffers(win.webContents);
          cleanupTemp();
          const totalBytes = captured.buffers.reduce((s, b) => s + b.buffer.length, 0);
          console.log('[print] host-relay captureMs=%d bytes=%d pages=%d', Date.now() - t0, totalBytes, captured.pageCount);
          const hostResult = await relayPrintImageToHost({
            buffers: captured.buffers,
            preferredPrinter: deviceName,
            authToken: opts?.authToken || null,
            paperSizeName,
            pageWidthIn: captured.pageWidthIn || pageMetrics.pageWidthIn,
            pageHeightIn: captured.pageHeightIn || pageMetrics.pageHeightIn,
          });
          console.log('[print] host-relay ok → %s totalMs=%d', hostResult.deviceName || deviceName, Date.now() - t0);
          return {
            success: true,
            failureReason: null,
            deviceName: hostResult.deviceName || deviceName,
            mode: 'host-relay',
          };
        } catch (err) {
          cleanupTemp();
          console.warn('[print] host-relay failed:', err.message);
          return {
            success: false,
            failureReason: 'Print failed',
            detail: err.message
              || 'Could not print via main PC. Check LAN, and that Canon is connected to the main PC.',
            deviceName,
            mode: 'host-relay',
          };
        }
      }

      // Main PC + local USB printer: GDI image print (fast, CAPT-safe).
      const beforeJobs = await getPrintQueueStatus(deviceName);
      if (beforeJobs.hasError || beforeJobs.online === false) {
        cleanupTemp();
        return {
          success: false,
          failureReason: 'printer_error',
          detail: beforeJobs.errorDetail || `Printer "${deviceName}" is not ready`,
          deviceName,
          mode: 'windows-image',
        };
      }

      // Letterhead invoices: print straight through the printer driver
      // (vector text + the letterhead at its own resolution) instead of a
      // screenshot — the oversampled capture of a full-page letterhead image
      // came out soft. Normal bills keep the screenshot path below. If the
      // driver print fails, fall through to the screenshot path as before.
      const isLetterheadInvoice = printerType === 'invoice' && /class="letterhead-bg"/.test(html);
      if (isLetterheadInvoice && pageMetrics.pageWidthIn && pageMetrics.pageHeightIn) {
        try {
          // Pass the ISO paper by NAME, not as a micron size: a custom size
          // doesn't match the driver's own A5 form, so the driver silently
          // fell back to its default (A4) and the A5 bill landed ~1.7in lower
          // on the sheet with the footer cut off. The GDI image path matches
          // the driver paper by name for the same reason (windowsPrint.js).
          const namedPaper = ['A4', 'A5', 'A6'].includes(paperSizeName) ? paperSizeName : null;
          // margins:'none' draws to the paper edge, but lasers can't print the
          // outer few mm (~0.24in on an LBP2900) — every edge came out cropped.
          // Shrink each page uniformly around its centre to sit inside the
          // driver's printable area, like the GDI image path does.
          const hardMarginIn = await getCachedHardMarginIn(deviceName, namedPaper);
          const insetIn = hardMarginIn + 0.02;
          const fitScale = Math.min(
            (pageMetrics.pageWidthIn - 2 * insetIn) / pageMetrics.pageWidthIn,
            (pageMetrics.pageHeightIn - 2 * insetIn) / pageMetrics.pageHeightIn,
          );
          if (fitScale > 0.5 && fitScale < 1) {
            await win.webContents.insertCSS(
              `@media print { .page { transform: scale(${fitScale.toFixed(4)}); transform-origin: center center; } }`,
            );
          }
          const direct = await runWebContentsPrint(win.webContents, {
            silent: true,
            deviceName,
            printBackground: true,
            landscape: false,
            scaleFactor: 100,
            margins: { marginType: 'none' },
            pageSize: namedPaper || {
              width: Math.round(pageMetrics.pageWidthIn * 25400),
              height: Math.round(pageMetrics.pageHeightIn * 25400),
            },
          }, 30_000);
          if (direct.success) {
            cleanupTemp();
            const afterDirect = await confirmSpoolerAccepted(deviceName, beforeJobs.jobCount, {
              settleMs: 800,
              requireJob: false,
            });
            if (!afterDirect.success && afterDirect.failureReason === 'printer_error') {
              console.warn('[print] windows-direct printer error: %s', afterDirect.detail);
              return { ...afterDirect, deviceName, mode: 'windows-direct' };
            }
            console.log('[print] windows-direct ok → %s totalMs=%d', deviceName, Date.now() - t0);
            return { success: true, failureReason: null, deviceName, mode: 'windows-direct' };
          }
          console.warn('[print] windows-direct failed: %s — falling back to image print', direct.failureReason);
        } catch (err) {
          console.warn('[print] windows-direct failed:', err.message, '— falling back to image print');
        }
      }

      try {
        const printed = await printHtmlAsImageViaWindows(
          win.webContents,
          deviceName,
          tempPngPath,
          paperSizeName,
          pageMetrics,
        );
        cleanupTemp();
        cleanupPngLater(printed.path);
        const afterImg = await confirmSpoolerAccepted(deviceName, beforeJobs.jobCount, {
          settleMs: 800,
          requireJob: false,
        });
        if (!afterImg.success && afterImg.failureReason === 'printer_error') {
          console.warn('[print] windows-image printer error: %s', afterImg.detail);
          return { ...afterImg, deviceName, mode: 'windows-image' };
        }
        console.log('[print] windows-image ok → %s totalMs=%d', deviceName, Date.now() - t0);
        return { success: true, failureReason: null, deviceName, mode: 'windows-image' };
      } catch (err) {
        console.warn('[print] windows-image failed:', err.message);
        cleanupTemp();
      }

      // PDF fallback (multi-page / GDI failure) — only reached if the image
      // print above threw. Not used as primary for anything right now: it
      // depends on SumatraPDF being installed to print silently; without it,
      // Windows' default PDF handler (usually Edge) just opens a visible
      // viewer window instead of printing, which is worse than the blur.
      try {
        if (!fs.existsSync(tempHtmlPath)) {
          fs.writeFileSync(tempHtmlPath, html, 'utf8');
        }
        try {
          await loadPrintHtml(tempHtmlPath, 8_000);
        } catch { /* may already be loaded */ }

        const beforePdf = await getPrintQueueStatus(deviceName);
        if (beforePdf.hasError || beforePdf.online === false) {
          return {
            success: false,
            failureReason: 'printer_error',
            detail: beforePdf.errorDetail || `Printer "${deviceName}" is not ready`,
            deviceName,
            mode: 'windows-pdf',
          };
        }
        const pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          margins: { marginType: 'default' },
        });
        fs.writeFileSync(tempPdfPath, pdfBuffer);
        await printPdfViaWindows(tempPdfPath, deviceName);
        cleanupTemp();
        cleanupPdfLater();
        const confirmPdf = await confirmSpoolerAccepted(deviceName, beforePdf.jobCount, {
          settleMs: 5_000,
          requireJob: true,
        });
        if (confirmPdf.success) {
          console.log('[print] windows-pdf ok → %s totalMs=%d', deviceName, Date.now() - t0);
          return { success: true, failureReason: null, deviceName, mode: 'windows-pdf' };
        }
        console.warn('[print] windows-pdf no spooler job: %s', confirmPdf.detail);
        return {
          ...confirmPdf,
          deviceName,
          mode: 'windows-pdf',
        };
      } catch (err) {
        console.warn('[print] windows-pdf failed:', err.message);
      }

      // Last resort: system print dialog (must be focusable briefly)
      if (!win.isDestroyed()) {
        try { win.setFocusable(true); } catch { /* */ }
        try { win.setIgnoreMouseEvents(false); } catch { /* */ }
        try { win.setOpacity(1); } catch { /* */ }
        try { win.setAlwaysOnTop(true); } catch { /* */ }
        win.center();
        win.show();
        win.focus();
      }
      const dialogResult = await runWebContentsPrint(win.webContents, {
        silent: false,
        printBackground: true,
        preferCSSPageSize: true,
        margins: { marginType: 'printableArea' },
      }, 60_000);
      try { if (!win.isDestroyed()) win.setFocusable(false); } catch { /* */ }
      console.log('[print] dialog done totalMs=%d ok=%s', Date.now() - t0, dialogResult.success);
      if (!dialogResult.success) {
        return {
          success: false,
          failureReason: dialogResult.failureReason || 'Print failed',
          detail: dialogResult.failureReason || 'Print was cancelled or failed',
          deviceName: null,
          mode: 'dialog',
        };
      }
      return { success: true, failureReason: null, deviceName: null, mode: 'dialog' };
    } catch (err) {
      cleanupTemp();
      return { success: false, failureReason: err.message };
    } finally {
      // Always clear always-on-top print window and return keyboard focus to the app.
      restoreMainFocus();
      destroySharedPrintWindow();
    }
  }

  ipcMain.handle('dialog:pickFolder', async (event, opts = {}) => {
    assertIpcSender(event);
    const win = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
    const picked = await dialog.showOpenDialog(win, {
      title: String(opts.title || 'Choose folder'),
      buttonLabel: String(opts.buttonLabel || 'Select folder'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { canceled: true };
    }
    return { canceled: false, path: picked.filePaths[0] };
  });

  // ── Save invoice/estimation HTML as a real PDF file (native Save As dialog) ─
  ipcMain.handle('pdf:saveFromHtml', (event, html, opts = {}) => {
    assertIpcSender(event);
    if (typeof html !== 'string' || html.length > 12_000_000) {
      return { success: false, failureReason: 'Invalid HTML' };
    }
    return withPrintLock(() => pdfSaveFromHtmlHandler(event, html, opts));
  });

  async function pdfSaveFromHtmlHandler(event, html, opts = {}) {
    const os = require('os');
    const stamp = Date.now();
    const tempHtmlPath = path.join(os.tmpdir(), `crm-pdf-${stamp}.html`);
    const win = getSharedPrintWindow({ fresh: true });
    try {
      win.setSize(800, 900);
      win.webContents.setZoomFactor(1);
      await waitForZoomFactor(win.webContents, 1, 400);
    } catch { /* */ }
    const cleanupTemp = () => { try { fs.unlinkSync(tempHtmlPath); } catch { /* */ } };

    const loadPrintHtml = (filePath, timeoutMs = 12_000) => new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const onOk = () => { cleanup(); resolve(); };
      const onFail = (_e, code, desc) => { cleanup(); reject(new Error(`Page load failed (${code}): ${desc}`)); };
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        win.webContents.removeListener('did-finish-load', onOk);
        win.webContents.removeListener('did-fail-load', onFail);
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('PDF render load timed out'));
      }, timeoutMs);
      win.webContents.once('did-finish-load', onOk);
      win.webContents.once('did-fail-load', onFail);
      win.loadFile(filePath).catch((err) => { cleanup(); reject(err); });
    });

    try {
      fs.writeFileSync(tempHtmlPath, html, 'utf8');
      await loadPrintHtml(tempHtmlPath);

      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { marginType: 'none' },
      });
      cleanupTemp();

      const ownerWin = BrowserWindow.fromWebContents(event.sender) || mainWindow || undefined;
      const defaultName = String(opts?.fileName || 'invoice').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
      const saveDir = typeof opts?.saveDir === 'string' ? opts.saveDir.trim() : '';
      const skipDialog = Boolean(opts?.skipDialog) || Boolean(saveDir);
      let destPath;
      if (saveDir) {
        const dir = path.resolve(saveDir);
        if (!path.isAbsolute(dir)) {
          return { success: false, failureReason: 'PDF folder must be a full path (for example D:\\Bills)' };
        }
        fs.mkdirSync(dir, { recursive: true });
        destPath = path.join(dir, `${defaultName}.pdf`);
      } else if (skipDialog) {
        destPath = path.join(app.getPath('downloads'), `${defaultName}.pdf`);
      } else {
        const saveResult = await dialog.showSaveDialog(ownerWin, {
          title: 'Save as PDF',
          defaultPath: path.join(app.getPath('downloads'), `${defaultName}.pdf`),
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (saveResult.canceled || !saveResult.filePath) {
          return { success: false, canceled: true };
        }
        destPath = saveResult.filePath;
      }
      fs.writeFileSync(destPath, pdfBuffer);
      return { success: true, path: destPath };
    } catch (err) {
      cleanupTemp();
      return { success: false, failureReason: err.message };
    } finally {
      destroySharedPrintWindow();
    }
  }

  // ── Render HTML to a real PDF and hand back the bytes (base64) — no save
  // dialog, no external app. Used for the inline "show the actual PDF, not a
  // raw HTML render" report preview, displayed via mainWindow's built-in PDF
  // viewer (see the `plugins: true` webPreference on mainWindow).
  // WhatsApp share: render the bill to a high-resolution image and put it on
  // the clipboard, so staff can Ctrl+V it straight into a WhatsApp chat.
  ipcMain.handle('invoice:copyImage', (event, html) => {
    assertIpcSender(event);
    if (typeof html !== 'string' || html.length > 12_000_000) {
      return { success: false, failureReason: 'Invalid HTML' };
    }
    return copyInvoiceImageHandler(html);
  });

  /** Long side of one bill page in the clipboard image ("4K" = 3840px). */
  const CLIPBOARD_IMAGE_LONG_SIDE_PX = 3840;

  /**
   * Uses its own OFFSCREEN window rather than the shared print window: an
   * offscreen renderer is built to paint without being on screen (the hidden
   * print window often never repainted after zooming — see
   * isStaleOversampleCapture), and it always renders at device scale 1, so
   * Windows display scaling can't skew the capture size either.
   */
  async function copyInvoiceImageHandler(html) {
    const os = require('os');
    const metrics = parsePrintPageMetrics(html);
    const baseW = Math.round((metrics.pageWidthIn || 5.83) * 96);
    const baseH = Math.round((metrics.pageHeightIn || 8.27) * 96);
    const tempHtmlPath = path.join(os.tmpdir(), `crm-invimg-${Date.now()}.html`);
    const win = new BrowserWindow({
      show: false,
      width: baseW,
      height: baseH,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        offscreen: true,
        backgroundThrottling: false,
      },
    });
    try {
      try { win.webContents.setFrameRate(30); } catch { /* */ }
      fs.writeFileSync(tempHtmlPath, html, 'utf8');
      await win.loadFile(tempHtmlPath);
      const pageCount = await win.webContents.executeJavaScript(`(async () => {
        const imgs = Array.from(document.images || []);
        await Promise.all(imgs.map((img) => (img.complete ? null : new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        }))));
        await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : null)));
        return document.querySelectorAll('.page').length || 1;
      })()`).catch(() => 1);
      const pages = Math.max(1, Math.min(10, Number(pageCount) || 1));

      // capturePage returns device pixels, i.e. DIPs × Windows display scale
      // (tested: 125% scaling gave 4800px for a 3840px target) — divide it
      // out. Chromium caps zoom at 5×; also keep the whole (stacked) canvas
      // under the ~16k px texture limit for long multi-page bills.
      let dsf = 1;
      try { dsf = require('electron').screen.getPrimaryDisplay().scaleFactor || 1; } catch { /* */ }
      const zoom = Math.min(
        CLIPBOARD_IMAGE_LONG_SIDE_PX / (Math.max(baseW, baseH) * dsf),
        5,
        16000 / (baseH * pages * dsf),
      );
      const capW = Math.round(baseW * zoom);
      const capH = Math.round(baseH * zoom) * pages;
      win.setSize(capW, capH);
      win.webContents.setZoomFactor(zoom);

      // Wait for the zoomed layout (innerWidth back to one page's CSS width)…
      const layoutDeadline = Date.now() + 1500;
      while (Date.now() < layoutDeadline) {
        const innerWidth = await win.webContents.executeJavaScript('window.innerWidth').catch(() => 0);
        if (Math.abs(Number(innerWidth) - baseW) <= 2) break;
        await new Promise((r) => setTimeout(r, 40));
      }
      // …then for real zoomed pixels, retrying while the frame is still stale.
      const rect = { x: 0, y: 0, width: capW, height: capH };
      let image = null;
      const paintDeadline = Date.now() + 4000;
      do {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 400);
          win.webContents.once('paint', () => { clearTimeout(timer); setTimeout(resolve, 60); });
          try { win.webContents.invalidate(); } catch { /* */ }
        });
        image = await win.webContents.capturePage(rect);
      } while (Date.now() < paintDeadline && (!image || image.isEmpty() || isStaleOversampleCapture(image, zoom)));

      if (!image || image.isEmpty() || isStaleOversampleCapture(image, zoom)) {
        return { success: false, failureReason: 'Could not render the bill image — please try again' };
      }
      clipboard.writeImage(image);
      const size = image.getSize();
      console.log('[whatsapp] bill image copied %dx%d pages=%d', size.width, size.height, pages);
      return { success: true, width: size.width, height: size.height, pages };
    } catch (err) {
      console.warn('[whatsapp] copy bill image failed:', err.message);
      return { success: false, failureReason: err.message || 'Could not copy the bill image' };
    } finally {
      try { fs.unlinkSync(tempHtmlPath); } catch { /* */ }
      try { if (!win.isDestroyed()) win.destroy(); } catch { /* */ }
      forceMainWindowFocus(null, { force: true });
    }
  }

  ipcMain.handle('pdf:generateFromHtml', (event, html) => {
    assertIpcSender(event);
    if (typeof html !== 'string' || html.length > 12_000_000) {
      return { success: false, failureReason: 'Invalid HTML' };
    }
    return withPrintLock(() => pdfGenerateFromHtmlHandler(html));
  });

  async function pdfGenerateFromHtmlHandler(html) {
    const os = require('os');
    const stamp = Date.now();
    const tempHtmlPath = path.join(os.tmpdir(), `crm-pdfprev-${stamp}.html`);
    const win = getSharedPrintWindow({ fresh: true });
    try {
      win.setSize(800, 900);
      win.webContents.setZoomFactor(1);
      await waitForZoomFactor(win.webContents, 1, 400);
    } catch { /* */ }
    const cleanupTemp = () => { try { fs.unlinkSync(tempHtmlPath); } catch { /* */ } };

    const loadPrintHtml = (filePath, timeoutMs = 12_000) => new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const onOk = () => { cleanup(); resolve(); };
      const onFail = (_e, code, desc) => { cleanup(); reject(new Error(`Page load failed (${code}): ${desc}`)); };
      const cleanup = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        win.webContents.removeListener('did-finish-load', onOk);
        win.webContents.removeListener('did-fail-load', onFail);
      };
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('PDF render load timed out'));
      }, timeoutMs);
      win.webContents.once('did-finish-load', onOk);
      win.webContents.once('did-fail-load', onFail);
      win.loadFile(filePath).catch((err) => { cleanup(); reject(err); });
    });

    try {
      fs.writeFileSync(tempHtmlPath, html, 'utf8');
      await loadPrintHtml(tempHtmlPath);
      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { marginType: 'default' },
      });
      cleanupTemp();
      return { success: true, base64: pdfBuffer.toString('base64') };
    } catch (err) {
      cleanupTemp();
      return { success: false, failureReason: err.message };
    } finally {
      destroySharedPrintWindow();
    }
  }

  ipcMain.handle('auth:cacheCredential', (event, userObj) => {
    assertIpcSender(event);
    if (!localDbReady) return false;
    const db = require('./lib/db').getLocalDb?.();
    offlineAuth.cacheCredential(db, userObj);
    return true;
  });

  ipcMain.handle('auth:loginOffline', async (event, { email, password }) => {
    assertIpcSender(event);
    if (!localDbReady) return { ok: false, reason: 'Local database not ready' };
    const db = require('./lib/db').getLocalDb?.();
    const result = await offlineAuth.loginOffline(db, email, password);
    const db2 = require('./lib/db').getLocalDb?.();
    audit.log(db2, {
      action: result.ok ? 'auth.loginOffline.success' : 'auth.loginOffline.failed',
      userId: result.user?.id || null,
      meta: { email, reason: result.reason || null },
    });
    return result;
  });

  ipcMain.handle('authority:reserve', async (event, { entityType, entityId, requestId }) => {
    assertIpcSender(event);
    return authorityClient.acquire({ entityType, entityId, requestId });
  });

  ipcMain.handle('authority:commit', async (event, leaseId) => {
    assertIpcSender(event);
    await authorityClient.commit(leaseId);
    return true;
  });

  ipcMain.handle('authority:release', async (event, leaseId) => {
    assertIpcSender(event);
    await authorityClient.release(leaseId);
    return true;
  });

  ipcMain.handle('authority:getState', (event) => {
    assertIpcSender(event);
    return authorityState.getDetail();
  });

  ipcMain.handle('authority:canTransact', (event, txType) => {
    assertIpcSender(event);
    const type = typeof txType === 'string' ? txType : 'any';
    return authorityState.canTransact(type);
  });

  /**
   * LAN-aware HTTP bridge via Node — routes to any host on the LAN or localhost.
   * Node http.request() works regardless of navigator.onLine / internet status.
   * This means LAN ERP operation is NEVER blocked by internet availability.
   *
   * Accepts opts.baseUrl to reach a LAN Host (e.g. http://192.168.x.x:8000).
   * Falls back to 127.0.0.1:<port> for local backend calls.
   */
  ipcMain.handle('api:localRequest', async (event, opts = {}) => {
    assertIpcSender(event);
    const http = require('http');
    const deskLog = require('./lib/logger');
    const t0 = Date.now();

    // Resolve target host — opts.baseUrl overrides (e.g. LAN host IP)
    let hostname = '127.0.0.1';
    let port = backendProcess.isReady() ? backendProcess.getPort() : 8080;
    if (opts.baseUrl) {
      try {
        const parsed = new URL(String(opts.baseUrl));
        if (parsed.hostname) hostname = parsed.hostname;
        if (parsed.port)     port = parseInt(parsed.port, 10) || port;
      } catch { /* fall through to localhost */ }
    }
    // Stale desktop-config / localStorage still has :8000 — local backend is :8080.
    const isLoopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    if (isLoopback) {
      port = backendProcess.isReady() ? (backendProcess.getPort() || 8080) : 8080;
    }

    const method = String(opts.method || 'GET').toUpperCase();
    let reqPath = String(opts.path || '/');
    if (!reqPath.startsWith('/')) reqPath = `/${reqPath}`;
    const headers = { ...(opts.headers || {}) };
    delete headers.host;
    delete headers.Host;
    const body = opts.body == null ? null : (
      typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
    );
    if (body != null && !headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (body != null && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    deskLog.debug('ipc', 'localRequest start', {
      method,
      path: reqPath,
      host: `${hostname}:${port}`,
      backendReady: backendProcess.isReady(),
    });

    return new Promise((resolve) => {
      const req = http.request(
        {
          hostname,
          port,
          path: reqPath,
          method,
          headers,
          timeout: Number(opts.timeoutMs) || 60000,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            let data = raw;
            const ct = String(res.headers['content-type'] || '');
            if (ct.includes('application/json')) {
              try { data = JSON.parse(raw || 'null'); } catch { /* keep string */ }
            }
            const ms = Date.now() - t0;
            const status = res.statusCode;
            const payload = { method, path: reqPath, status, ms, host: `${hostname}:${port}` };
            if (status >= 500) deskLog.error('ipc', 'localRequest failed', { ...payload, detail: data?.detail });
            else if (status >= 400) deskLog.warn('ipc', 'localRequest rejected', { ...payload, detail: data?.detail });
            else if (!reqPath.includes('/api/health')) deskLog.info('ipc', 'localRequest ok', payload);
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              statusText: res.statusMessage || '',
              headers: res.headers,
              data,
            });
          });
        },
      );
      req.on('timeout', () => {
        req.destroy();
        deskLog.error('ipc', 'localRequest timeout', {
          method, path: reqPath, host: `${hostname}:${port}`, ms: Date.now() - t0,
        });
        resolve({ ok: false, status: 0, statusText: 'timeout', data: { detail: 'Local API timeout' } });
      });
      req.on('error', (err) => {
        deskLog.error('ipc', 'localRequest error', {
          method, path: reqPath, host: `${hostname}:${port}`, error: err.message, ms: Date.now() - t0,
        });
        resolve({ ok: false, status: 0, statusText: err.message, data: { detail: err.message } });
      });
      if (body != null) req.write(body);
      req.end();
    });
  });
}

app.whenReady().then(async () => {
  try {
    const deskLog = require('./lib/logger');
    deskLog.info('main', 'Electron ready', { logDir: deskLog.getLogDir(), run: runMode.getRunInfo() });
    const info = await initLocalDb(app.getPath('userData'));
    localDbReady = true;
    localDbError = null;
    deskLog.info('sqlite', 'local desktop DB ready', {
      schemaVersion: info.schemaVersion,
      dbPath: info.dbPath,
    });
    console.log(`Local SQLite ready v${info.schemaVersion} at ${info.dbPath}`);

    let cfg = loadConfig();

    // Auto-populate shop_id from SQLite if missing from config (e.g. after seed)
    if (!cfg.shop_id) {
      try {
        const shopRow = require('./lib/db').getLocalDb?.()
          ?.prepare(`SELECT id FROM shops WHERE status='active' ORDER BY created_at ASC LIMIT 1`)
          ?.get();
        if (shopRow?.id) {
          saveConfig({ shop_id: shopRow.id });
          cfg = loadConfig();
          console.log(`[main] Auto-set shop_id from SQLite: ${cfg.shop_id}`);
        }
      } catch (e) {
        console.warn('[main] Could not auto-detect shop_id:', e.message);
      }
    }

    // Ensure device identity (key pair + stable device_id)
    try {
      const identity = await deviceIdentity.ensureIdentity(
        app.getPath('userData'),
        cfg,
        saveConfig,
      );
      console.log(`[deviceIdentity] Device ID: ${identity.deviceId}`);
    } catch (err) {
      console.warn('[deviceIdentity] Identity init failed (non-fatal):', err.message);
    }

    // Initialise audit service
    audit.init({
      deviceId: cfg.device_id || null,
      shopId:   cfg.shop_id   || null,
    });
    authorityClient.init({
      cloudUrl: null,
      shopId:   cfg.shop_id   || null,
      deviceId: cfg.device_id || null,
    });

    // LAN coordinator — elects authority server among shop devices
    const db = require('./lib/db').getLocalDb?.();
    const lanSecret = require('./lib/services/lanSecret');
    const isHostPc = !(cfg.mode === 'join' || cfg.role === 'replica' || cfg.role === 'client');
    let sharedKey = process.env.LAN_SHARED_KEY || null;
    if (!sharedKey) {
      sharedKey = lanSecret.loadLanSharedKey(app.getPath('userData'));
    }
    if (!sharedKey && isHostPc) {
      // Host generates a shop-specific secret once (never the old default-lan-key)
      sharedKey = lanSecret.ensureLanSharedKey(app.getPath('userData'));
      console.log('[main] Host LAN key ready (fp=%s)', lanSecret.fingerprint(sharedKey));
    }
    lanCoordinator.init({
      deviceId: cfg.device_id || null,
      shopId:   cfg.shop_id   || null,
      sharedKey,
      db,
      onCoordinatorChange: ({ coordinator, amCoordinator, peers }) => {
        authorityState.updateLanPeers(
          peers.map((p) => ({ url: p.url, deviceId: p.deviceId }))
        );
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('lan:coordinatorChanged', {
            coordinator, amCoordinator, peerCount: peers.length,
          });
        }
      },
    });

    // Start UDP LAN discovery — feeds peers into lanCoordinator
    const freshCfg = loadConfig();
    if (freshCfg.device_id && freshCfg.shop_id) {
      udpDiscovery.start({
        deviceId:       freshCfg.device_id,
        shopId:         freshCfg.shop_id,
        lanCoordinator,
      });
    }

    // Initialise authority state machine — local Branch is source of truth for billing
    authorityState.init({
      db: require('./lib/db').getLocalDb?.(),
      localUrl: `http://127.0.0.1:8080`,
      // Optional remote cloud only — never use branch_api_url (that's local)
      cloudUrl: null,
      shopId:   cfg.shop_id   || null,
      deviceId: cfg.device_id || null,
    });

    // lanReplicaSync starts after embedded backend is ready (see app.whenReady)

    // Push state changes to renderer and audit transitions
    let _prevState = null;
    authorityState.on('stateChange', ({ state, detail }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('authority:stateChanged', { state, detail });
      }
      audit.log(require('./lib/db').getLocalDb?.(), {
        action: 'authority.stateChange',
        meta: { state, detail },
      });
      _prevState = state;
    });
  } catch (err) {
    localDbReady = false;
    localDbError = err.message;
    console.error('Local SQLite init failed:', err);
  }

  try {
    registerIpc();
  } catch (err) {
    console.error('[main] registerIpc failed:', err.message);
  }

  // Open the window immediately so the user sees the app right away.
  try {
    createWindow();
  } catch (err) {
    console.error('[main] createWindow failed:', err);
  }

  // No system tray — closing X must fully exit (tray historically kept orphans alive).
  tray = null;

  // While running: Ctrl+Shift+J focuses this window (never opens a second one).
  // After full quit: Windows .lnk Hotkey starts a fresh process → login page.
  const shortcutRegistered = globalShortcut.register('CommandOrControl+Shift+J', () => {
    focusMainWindow();
  });
  if (!shortcutRegistered) {
    console.warn('[main] Ctrl+Shift+J global shortcut could not be registered (already in use?)');
  } else {
    console.log('[main] Global shortcut Ctrl+Shift+J registered');
  }

  if (process.platform === 'win32' && !isDev) {
    try {
      const { ensureLaunchHotkey } = require('./lib/windowsLaunchHotkey');
      ensureLaunchHotkey(process.execPath);
    } catch (err) {
      console.warn('[main] ensureLaunchHotkey failed:', err.message);
    }
  }

  app.on('activate', () => {
    if (quitCleanupStarted || appIsQuitting) return;
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    else focusMainWindow();
  });

  // Start embedded backend after window is open (all modes — same AppData SQLite as .exe).
  {
    const cfg = loadConfig();
    const sqlitePath = path.join(app.getPath('userData'), 'data', 'jewellery-crm.sqlite');
    // Host unless this PC explicitly joined as staff/replica.
    // Do NOT treat unfinished setup as replica — that skips owner seed and breaks login.
    const branchRole = (cfg.mode === 'join' || cfg.role === 'replica' || cfg.role === 'client')
      ? 'replica'
      : 'active_host';
    console.log(`[main] Starting embedded backend as ${branchRole}…`);

    // Ensure the LAN port is reachable from other PCs on Windows.
    // Staff PCs discover the Main PC via UDP (41779) but connect over TCP 8080.
    // When running as a packaged .exe the embedded node binary is a different path
    // from the one the developer ran in VSCode, so Windows Firewall has no rule for it.
    // A port-based inbound rule (not tied to any exe) fixes this for all future starts.
    if (process.platform === 'win32' && branchRole === 'active_host') {
      const { exec } = require('child_process');
      const ruleName = 'Jewellery ERP LAN Port 8080';
      const addRule = `netsh advfirewall firewall add rule name="${ruleName}" protocol=TCP dir=in localport=8080 action=allow profile=any`;

      // netsh exits 0 if the rule exists, non-zero if it doesn't.
      exec(
        `netsh advfirewall firewall show rule name="${ruleName}"`,
        (checkErr) => {
          if (!checkErr) return; // rule already exists
          // Try directly (works if the app runs as admin or the rule is manageable by user).
          exec(addRule, (addErr) => {
            if (!addErr) {
              console.log('[main] Windows Firewall: allowed TCP 8080 inbound for LAN access');
              return;
            }
            // Elevation required — trigger a one-time UAC prompt so the user can approve.
            const psArg = addRule.replace(/"/g, '\\"');
            exec(
              `powershell -WindowStyle Hidden -Command "Start-Process cmd -ArgumentList '/c ${psArg}' -Verb RunAs -Wait"`,
              (psErr) => {
                if (psErr) console.warn('[main] Could not add firewall rule via UAC — add manually: ' + addRule);
                else console.log('[main] Windows Firewall rule added via UAC elevation');
              }
            );
          });
        }
      );
    }

    backendProcess.start({
      port: 8080,
      shopId: cfg.shop_id || null,
      sqlitePath,
      deviceNumber: cfg.device_number || 1,
      deviceId: cfg.device_id || null,
      branchRole,
      onLog: (line) => console.log('[backend]', line),
      onEvent: (event, payload) => {
        console.log(`[main] backend event ${event}`, payload);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(event, payload);
        }
      },
    }).then(async () => {
      console.log('[main] Backend ready');
      // Align LAN HMAC with shop secret from Host SQLite settings (seeded by backend)
      try {
        const lanSecret = require('./lib/services/lanSecret');
        const Database = require('better-sqlite3');
        const dbPath = path.join(app.getPath('userData'), 'data', 'jewellery-crm.sqlite');
        if (fs.existsSync(dbPath)) {
          const sdb = new Database(dbPath, { readonly: true, fileMustExist: true });
          try {
            const row = sdb.prepare(
              `SELECT value FROM settings WHERE key = ? ORDER BY created_at DESC LIMIT 1`,
            ).get('lan_coordination_secret');
            let secret = null;
            if (row?.value) {
              const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
              secret = parsed?.secret || null;
            }
            if (secret && secret.length >= 32) {
              lanSecret.adoptLanSharedKey(app.getPath('userData'), secret);
              lanCoordinator.setSharedKey(secret);
              console.log('[main] Synced LAN key from shop settings (fp=%s)', lanSecret.fingerprint(secret));
            }
          } finally {
            sdb.close();
          }
        }
      } catch (err) {
        console.warn('[main] LAN key sync skipped:', err.message);
      }
      // Re-probe authority now that Branch is up (avoids sticky Isolated)
      authorityState.notifyBackendReady?.(8080);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend:ready', { port: 8080 });
      }

      // Auto-complete setup: if the backend already has a shop+owner seeded (which
      // happens automatically on first Electron run), mark setup_complete so the app
      // goes straight to the sign-in page without showing the first-launch wizard.
      try {
        const setupCfg = loadConfig();
        if (!setupCfg.setup_complete) {
          const healthRes = await fetch('http://127.0.0.1:8080/api/health').then((r) => r.json()).catch(() => null);
          const shopId   = healthRes?.shop_id   || setupCfg.shop_id   || null;
          const deviceId = healthRes?.device_id || setupCfg.device_id || null;
          const deviceName = healthRes?.device_name || setupCfg.device_name || null;
          if (shopId) {
            saveConfig({
              mode:            'host',
              role:            'active_host',
              branch_api_url:  'http://127.0.0.1:8080',
              local_api_url:   'http://127.0.0.1:8080',
              shop_id:         shopId,
              device_id:       deviceId,
              device_name:     deviceName,
              device_number:   1,
              setup_complete:  true,
            });
            // Enable start-with-Windows for the owner PC so the server is always running.
            app.setLoginItemSettings({ openAtLogin: true, openAsHidden: false });
            console.log('[main] Auto-completed setup — shop seeded, loading sign-in');
            // Reload into the React frontend (sign-in page)
            if (mainWindow && !mainWindow.isDestroyed()) {
              const entry = frontendEntry();
              if (entry.type === 'url') mainWindow.loadURL(entry.value);
              else mainWindow.loadFile(entry.value);
            }
          }
        }
      } catch (err) {
        console.warn('[main] Auto-setup check skipped:', err.message);
      }
      // Import stashed full replica snapshot after join
      const pendingSnap = path.join(app.getPath('userData'), 'pending-snapshot.json');
      if (fs.existsSync(pendingSnap) && branchRole === 'replica') {
        const p = pendingSnap;
        try {
          const snapshot = JSON.parse(fs.readFileSync(p, 'utf8'));
          const flag = path.join(app.getPath('userData'), 'allow-snapshot-import');
          fs.writeFileSync(flag, '1', { mode: 0o600 });
          const res = await fetch(`http://127.0.0.1:8080/api/cluster/snapshot/import-local`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Local-Import': '1' },
            body: JSON.stringify({ snapshot }),
          });
          if (res.ok) {
            const data = await res.json();
            saveConfig({ event_watermark: data.watermark || 0 });
            try { fs.unlinkSync(p); } catch { /* */ }
            console.log('[main] Replica snapshot imported, watermark=', data.watermark);
          } else {
            console.warn('[main] Snapshot import failed', res.status);
          }
          try { fs.unlinkSync(flag); } catch { /* */ }
        } catch (e) {
          console.warn('[main] Snapshot import error', e.message);
        }
      }
      // LAN replica catch-up: pull from host using hostConnector's verified URL
      if (branchRole === 'replica') {
        const localUrl = 'http://127.0.0.1:8080';

        function initReplicaSync(hostUrl) {
          if (!hostUrl || hostUrl.includes('127.0.0.1')) return;
          lanReplicaSync.stop();
          lanReplicaSync.init({
            hostUrl,
            localUrl,
            getToken: async () => {
              try { return localStorage?.getItem?.('ssj_token') || null; } catch { return null; }
            },
            getWatermark: () => loadConfig().event_watermark || 0,
            setWatermark: (wm) => saveConfig({ event_watermark: wm }),
          });
          lanReplicaSync.start();
          console.log('[lanReplicaSync] started host=', hostUrl);
        }

        // Start hostConnector — it will discover the host and emit 'state'
        hostConnector.on('state', (state) => {
          if (state.host === 'connected' && state.host_url) {
            // Re-init sync whenever the verified host URL changes (DHCP recovery)
            if (state.host_url !== lanReplicaSync._hostUrl) {
              initReplicaSync(state.host_url);
            }
            // Tell authority state machine we have a reachable LAN host → LAN_COORDINATED
            authorityState.notifyJoinHostState(true, state.host_url);
          } else if (state.host === 'not_found' || state.host === 'reconnecting') {
            authorityState.notifyJoinHostState(false);
          }
        });

        // Seed with last known URL so sync can start immediately on cold start
        const seedUrl = loadConfig().last_known_host_url
          || cfg.host_api_url
          || cfg.branch_api_url;
        if (seedUrl && !seedUrl.includes('127.0.0.1')) {
          initReplicaSync(seedUrl);
        }

        // Start discovery — will silently update lanReplicaSync if host IP changed
        hostConnector.start().catch((e) =>
          console.warn('[hostConnector] start error:', e.message)
        );
        console.log('[hostConnector] started for replica');
      }
    }).catch((err) => {
      console.error('[main] Backend failed to start:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('backend:error', {
          error: err.stack || err.message,
        });
      }
    });
  }
});

app.on('before-quit', (e) => {
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  appIsQuitting = true;
  // Wait for embedded backend to exit so Task Manager does not keep orphan node
  // processes (which then fight the next launch for port 8080).
  e.preventDefault();

  globalShortcut.unregisterAll();
  destroySharedPrintWindow();
  if (tray) {
    try { tray.destroy(); } catch { /* */ }
    tray = null;
  }

  const finish = () => {
    try { udpDiscovery.stop(); } catch { /* */ }
    try { lanCoordinator.shutdown(); } catch { /* */ }
    try { authorityState.shutdown?.(); } catch { /* */ }
    try { shutdownLocalDb(); } catch { /* */ }
    app.exit(0);
  };

  Promise.resolve()
    .then(() => backendProcess.stop())
    .catch((err) => console.warn('[main] backend stop on quit:', err?.message || err))
    .then(finish);
});

// Closing the last window exits the app (and stops the embedded backend).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Harden: no remote module / navigation to unexpected origins from webviews
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
