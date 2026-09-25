/**
 * Preload — expose a minimal, validated API to the renderer.
 * No Node, fs, shell, or child_process access for React.
 */
const { contextBridge, ipcRenderer } = require('electron');

const allowed = new Set([
  'config:get',
  'config:set',
  'connectivity:ping',
  'app:getInfo',
  'app:openLogsFolder',
  'shell:openExternal',
  'setup:completeAndReload',
  'setup:resetAndShowFirstLaunch',
  'print:page',
  'print:html',
  'pdf:saveFromHtml',
  'pdf:generateFromHtml',
  'dialog:pickFolder',
  'devices:getPrinters',
  'printers:getAssignments',
  'printers:setAssignments',
  'db:status',
  'db:backup',
  'backup:exportToFolder',
  'authority:reserve',
  'authority:commit',
  'authority:release',
  'authority:getState',
  'authority:canTransact',
  'auth:cacheCredential',
  'auth:loginOffline',
  'app:getLocalIp',
  'api:localRequest',
  'db:saveExportFile',
  'db:replace-and-restart',
  'backup:pickImportFile',
  'backup:importRestore',
  'cluster:stashSnapshot',
  'cluster:importStashedSnapshot',
  'db:factory-reset',
  // ── Windows startup ─────────────────────────────────────────────────────
  'app:getLoginItem',
  'app:setLoginItem',
  // ── Host connector ──────────────────────────────────────────────────────
  'host:getState',
  'host:retry',
  'host:pairingComplete',
  'host:employeeSignedIn',
  'host:employeeSignedOut',
]);

function invoke(channel, ...args) {
  if (!allowed.has(channel)) {
    return Promise.reject(new Error(`IPC channel blocked: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

contextBridge.exposeInMainWorld('jewelleryCRM', {
  isDesktop: true,
  getConfig: () => invoke('config:get'),
  setConfig: (patch) => invoke('config:set', patch),
  pingBranch: (url) => invoke('connectivity:ping', url),
  getAppInfo: () => invoke('app:getInfo'),
  openLogsFolder: () => invoke('app:openLogsFolder'),
  openExternal: (url) => invoke('shell:openExternal', url),
  completeSetupAndReload: () => invoke('setup:completeAndReload'),
  /** Logout → Create Shop / Join Shop screen again */
  resetAndShowFirstLaunch: () => invoke('setup:resetAndShowFirstLaunch'),
  printPage: () => invoke('print:page'),
  printHtml: (html, opts) => invoke('print:html', html, opts),
  /** Render HTML to a real PDF and let the user Save As via a native dialog */
  savePdfFromHtml: (html, opts) => invoke('pdf:saveFromHtml', html, opts),
  /** Native folder picker (WhatsApp invoice PDF path, backups, etc.) */
  pickFolder: (opts) => invoke('dialog:pickFolder', opts || {}),
  /** Render HTML to a real PDF and return its bytes (base64) for an inline preview — no dialog, no external app */
  generatePdfFromHtml: (html) => invoke('pdf:generateFromHtml', html),
  getPrinters: () => invoke('devices:getPrinters'),
  getPrinterAssignments: () => invoke('printers:getAssignments'),
  setPrinterAssignments: (a) => invoke('printers:setAssignments', a),
  getLocalDbStatus: () => invoke('db:status'),
  backupLocalDb: () => invoke('db:backup'),
  /** Pick USB/folder and copy a consistent shop DB backup there */
  exportBackupToFolder: (opts) => invoke('backup:exportToFolder', opts || {}),
  cacheCredential: (userObj) => invoke('auth:cacheCredential', userObj),
  loginOffline: (email, password) => invoke('auth:loginOffline', { email, password }),
  reserveAuthority: (opts) => invoke('authority:reserve', opts),
  commitAuthority: (leaseId) => invoke('authority:commit', leaseId),
  releaseAuthority: (leaseId) => invoke('authority:release', leaseId),
  getAuthorityState: () => invoke('authority:getState'),
  canTransact: (txType) => invoke('authority:canTransact', txType),
  getLocalIp: () => invoke('app:getLocalIp'),
  /** Node HTTP to local Branch — works when Chromium offline blocks fetch */
  localRequest: (opts) => invoke('api:localRequest', opts),
  /** Offline ownership transfer — save downloaded SQLite to temp file */
  saveExportFile: (opts) => invoke('db:saveExportFile', opts),
  /** Offline ownership transfer — stop backend, swap DB file, restart */
  replaceAndRestartDb: (opts) => invoke('db:replace-and-restart', opts),
  /** Manual restore — native "pick a backup file" dialog */
  pickBackupImportFile: () => invoke('backup:pickImportFile'),
  /** Manual restore — swap the picked (or decrypted) file into place and restart */
  importRestoreBackup: (opts) => invoke('backup:importRestore', opts),
  stashSnapshot: (snapshot) => invoke('cluster:stashSnapshot', snapshot),
  importStashedSnapshot: () => invoke('cluster:importStashedSnapshot'),
  /** Wipe all shop data and restart the app from scratch */
  factoryReset: () => invoke('db:factory-reset'),
  // ── Windows startup ───────────────────────────────────────────────────────
  getLoginItem: () => invoke('app:getLoginItem'),
  setLoginItem: (opts) => invoke('app:setLoginItem', opts),
  // ── Host connector ────────────────────────────────────────────────────────
  getHostState: () => invoke('host:getState'),
  retryHostConnection: () => invoke('host:retry'),
  notifyPairingComplete: (data) => invoke('host:pairingComplete', data),
  notifyEmployeeSignedIn: () => invoke('host:employeeSignedIn'),
  notifyEmployeeSignedOut: () => invoke('host:employeeSignedOut'),
  onHostStateChanged: (callback) => {
    ipcRenderer.on('host:stateChanged', (_event, data) => callback(data));
  },
  // ─────────────────────────────────────────────────────────────────────────
  onAuthorityStateChanged: (callback) => {
    ipcRenderer.on('authority:stateChanged', (_event, data) => callback(data));
  },
  onBackendReady: (callback) => {
    ipcRenderer.on('backend:ready', (_event, data) => callback(data));
  },
  onBackendError: (callback) => {
    ipcRenderer.on('backend:error', (_event, data) => callback(data));
  },
  openLogsFolder: () => ipcRenderer.invoke('app:openLogsFolder'),
});
