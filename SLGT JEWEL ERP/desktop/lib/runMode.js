'use strict';
/**
 * Detect how the desktop shell is running — source vs packaged, dev vs prod.
 * Local/exe feature drift usually means different frontend/backend snapshots or DB paths.
 */
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function isDevMode() {
  return process.argv.includes('--dev') || process.env.ELECTRON_DEV === '1';
}

function isPackagedApp() {
  return Boolean(app.isPackaged);
}

function repoBackendDir() {
  return path.resolve(__dirname, '..', '..', 'backend');
}

function bundledBackendDir() {
  return path.join(process.resourcesPath || '', 'backend');
}

/** Packaged .exe → bundled backend; `electron .` → live repo backend. */
function resolveBackendDir() {
  if (!isPackagedApp()) return repoBackendDir();
  const bundled = bundledBackendDir();
  return fs.existsSync(bundled) ? bundled : repoBackendDir();
}

function liveFrontendDist() {
  return path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html');
}

function bundledFrontendIndex() {
  return path.join(process.resourcesPath || '', 'frontend', 'index.html');
}

function readFrontendBuildInfo(indexHtmlPath) {
  try {
    const infoPath = path.join(path.dirname(indexHtmlPath), 'build-info.json');
    if (fs.existsSync(infoPath)) {
      return JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    }
  } catch { /* */ }
  return null;
}

function resolveFrontendEntry() {
  if (isDevMode()) {
    return {
      type: 'url',
      value: process.env.VITE_DEV_URL || 'http://localhost:3000',
      source: 'vite-dev',
      build: null,
    };
  }

  const live = liveFrontendDist();
  const bundled = bundledFrontendIndex();

  // `electron .` (not packaged): prefer freshly built dist over resources copy.
  if (!isPackagedApp() && fs.existsSync(live)) {
    return { type: 'file', value: live, source: 'frontend-dist', build: readFrontendBuildInfo(live) };
  }
  if (fs.existsSync(bundled)) {
    return { type: 'file', value: bundled, source: 'bundled-frontend', build: readFrontendBuildInfo(bundled) };
  }
  if (fs.existsSync(live)) {
    return { type: 'file', value: live, source: 'frontend-dist', build: readFrontendBuildInfo(live) };
  }
  return {
    type: 'file',
    value: path.join(__dirname, '..', 'first-launch.html'),
    source: 'first-launch',
    build: null,
  };
}

function parityWarnings(entry, backendDir) {
  const warnings = [];
  if (isDevMode()) {
    warnings.push('Dev mode uses Vite (latest UI). Stop any separate backend on port 8080 — this app starts its own with your AppData database.');
  } else if (isPackagedApp()) {
    warnings.push('Installed app uses bundled frontend + backend from the last installer build. Rebuild with npm run dist after code changes.');
  } else {
    warnings.push('Local electron start uses live backend code + frontend/dist. Run npm run build in frontend/ after UI changes.');
  }
  if (entry.source === 'first-launch') {
    warnings.push('Frontend build missing — run: cd frontend && npm run build');
  }
  if (!isPackagedApp() && backendDir && fs.existsSync(bundledBackendDir())) {
    warnings.push('Unpacked build folder detected — use npm start from desktop/ for live backend, or reinstall .exe for bundled backend.');
  }
  return warnings;
}

function getRunInfo() {
  const backendDir = resolveBackendDir();
  const frontend = resolveFrontendEntry();
  return {
    isDev: isDevMode(),
    isPackaged: isPackagedApp(),
    userData: app.getPath('userData'),
    backendSource: isPackagedApp() ? 'bundled' : 'live-repo',
    backendDir,
    frontendSource: frontend.source,
    frontendBuild: frontend.build,
    parityWarnings: parityWarnings(frontend, backendDir),
  };
}

module.exports = {
  isDevMode,
  isPackagedApp,
  resolveBackendDir,
  resolveFrontendEntry,
  getRunInfo,
};
