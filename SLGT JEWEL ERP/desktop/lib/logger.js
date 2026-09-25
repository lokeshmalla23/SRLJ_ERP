'use strict';
/**
 * Desktop main-process logger — console + daily file under userData/logs.
 * Uses sync append so every line is on disk immediately (needed for crash diagnosis).
 */
const fs = require('fs');
const path = require('path');

let _dir = null;
let _day = null;
let _filePath = null;

function logDir() {
  if (_dir) return _dir;
  try {
    const { app } = require('electron');
    _dir = path.join(app.getPath('userData'), 'logs');
  } catch {
    _dir = path.join(process.cwd(), 'logs');
  }
  try { fs.mkdirSync(_dir, { recursive: true }); } catch { /* */ }
  return _dir;
}

function logFile() {
  const day = new Date().toISOString().slice(0, 10);
  if (_filePath && _day === day) return _filePath;
  try {
    _filePath = path.join(logDir(), `erp-desktop-${day}.log`);
    _day = day;
    return _filePath;
  } catch {
    return null;
  }
}

function write(level, scope, message, meta) {
  const ts = new Date().toISOString();
  let safeMeta = meta;
  if (meta != null && typeof meta === 'object') {
    try {
      safeMeta = JSON.parse(JSON.stringify(meta, (_k, v) => {
        if (typeof v === 'string' && v.length > 2000) return `${v.slice(0, 2000)}…`;
        if (v instanceof Error) return { message: v.message, stack: v.stack };
        return v;
      }));
    } catch {
      safeMeta = { note: 'meta_serialize_failed' };
    }
  }
  const row = { ts, level, scope, message, ...(safeMeta != null ? { meta: safeMeta } : {}) };
  const line = JSON.stringify(row);
  const pretty = `[${ts}] [${level.toUpperCase()}] [${scope}] ${message}${
    safeMeta != null ? ` ${JSON.stringify(safeMeta)}` : ''
  }`;
  if (level === 'error') console.error(pretty);
  else if (level === 'warn') console.warn(pretty);
  else console.log(pretty);
  const file = logFile();
  if (file) {
    try { fs.appendFileSync(file, `${line}\n`, 'utf8'); } catch { /* */ }
  }
}

module.exports = {
  getLogDir: logDir,
  debug: (scope, message, meta) => write('debug', scope, message, meta),
  info: (scope, message, meta) => write('info', scope, message, meta),
  warn: (scope, message, meta) => write('warn', scope, message, meta),
  error: (scope, message, meta) => write('error', scope, message, meta),
};
