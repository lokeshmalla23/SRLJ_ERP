'use strict';
/**
 * Bind Ctrl+Shift+J on Desktop / Start Menu .lnk shortcuts so Windows can
 * relaunch JewelleryCRM after a full quit (Electron globalShortcut only works
 * while the process is alive).
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SHORTCUT_NAME = 'Jewellery ERP.lnk';
const LEGACY_SHORTCUT_NAME = 'Jewellery CRM.lnk';
const HOTKEY = 'CTRL+SHIFT+J';

function shortcutCandidates() {
  const home = os.homedir();
  const desktop = path.join(home, 'Desktop');
  const publicDesktop = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');
  const startMenu = path.join(
    process.env.APPDATA || path.join(home, 'AppData', 'Roaming'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
  );
  const names = [SHORTCUT_NAME, LEGACY_SHORTCUT_NAME];
  const dirs = [desktop, publicDesktop, startMenu, path.join(startMenu, 'JewelleryCRM')];
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

/**
 * Ensure at least one launch shortcut exists with Ctrl+Shift+J.
 * @param {string} exePath absolute path to JewelleryCRM.exe
 */
function ensureLaunchHotkey(exePath) {
  if (process.platform !== 'win32' || !exePath) return;

  const existing = shortcutCandidates().filter((p) => fs.existsSync(p));
  const targets = existing.length
    ? existing
    : [path.join(os.homedir(), 'Desktop', SHORTCUT_NAME)];

  // Escape for PowerShell single-quoted strings: ' → ''
  const q = (s) => String(s).replace(/'/g, "''");
  const lines = [
    `$shell = New-Object -ComObject WScript.Shell`,
    `$exe = '${q(exePath)}'`,
    `$hotkey = '${HOTKEY}'`,
  ];

  for (const lnk of targets) {
    lines.push(`$lnk = '${q(lnk)}'`);
    lines.push(`$dir = Split-Path -Parent $lnk`);
    lines.push(`if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }`);
    lines.push(`$sc = $shell.CreateShortcut($lnk)`);
    lines.push(`if (-not (Test-Path -LiteralPath $lnk)) { $sc.TargetPath = $exe; $sc.WorkingDirectory = (Split-Path -Parent $exe); $sc.Description = 'Jewellery ERP' }`);
    lines.push(`$sc.Hotkey = $hotkey`);
    lines.push(`$sc.Save()`);
  }

  const script = lines.join('; ');
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { windowsHide: true, timeout: 15000 },
    (err) => {
      if (err) {
        console.warn('[windowsLaunchHotkey] Could not bind Ctrl+Shift+J on shortcut:', err.message);
      } else {
        console.log('[windowsLaunchHotkey] Ctrl+Shift+J bound on launch shortcut(s)');
      }
    },
  );
}

module.exports = { ensureLaunchHotkey };
