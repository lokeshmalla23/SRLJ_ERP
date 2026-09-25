/**
 * Structured ERP logger — console + daily file (sync append so crashes keep logs).
 *
 * Env:
 *   LOG_LEVEL=debug|info|warn|error  (default info; debug in Electron)
 *   LOG_DIR=absolute path            (default: ELECTRON_USERDATA/logs or ./logs)
 *   LOG_TO_FILE=0|1                  (default 1)
 */
import fs from 'fs';
import path from 'path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultLevel() {
  if (process.env.LOG_LEVEL) return String(process.env.LOG_LEVEL).toLowerCase();
  if (process.env.ELECTRON_RUN === '1') return 'debug';
  return 'info';
}

function resolveLogDir() {
  if (process.env.LOG_DIR) return process.env.LOG_DIR;
  if (process.env.ELECTRON_USERDATA) {
    return path.join(process.env.ELECTRON_USERDATA, 'logs');
  }
  return path.join(process.cwd(), 'logs');
}

let _level = defaultLevel();
let _dir = resolveLogDir();
let _fileEnabled = process.env.LOG_TO_FILE !== '0';
let _fileDay = null;
let _filePath = null;

function ensureLogFile() {
  if (!_fileEnabled) return null;
  const day = new Date().toISOString().slice(0, 10);
  if (_filePath && _fileDay === day) return _filePath;
  try {
    fs.mkdirSync(_dir, { recursive: true });
    _filePath = path.join(_dir, `erp-backend-${day}.log`);
    _fileDay = day;
    return _filePath;
  } catch (err) {
    console.error('[logger] cannot prepare log file:', err.message);
    return null;
  }
}

function shouldLog(level) {
  return (LEVELS[level] || 20) >= (LEVELS[_level] || 20);
}

function write(level, scope, message, meta) {
  if (!shouldLog(level)) return;
  const ts = new Date().toISOString();
  const base = { ts, level, scope, message };
  if (meta != null && typeof meta === 'object') {
    try {
      const safe = JSON.parse(JSON.stringify(meta, (_k, v) => {
        if (typeof v === 'string' && v.length > 2000) return `${v.slice(0, 2000)}…`;
        if (v instanceof Error) return { message: v.message, stack: v.stack };
        return v;
      }));
      Object.assign(base, { meta: safe });
    } catch {
      base.meta = { note: 'meta_serialize_failed' };
    }
  }
  const line = JSON.stringify(base);
  const pretty = `[${ts}] [${level.toUpperCase()}] [${scope}] ${message}${
    base.meta ? ` ${JSON.stringify(base.meta)}` : ''
  }`;

  if (level === 'error') console.error(pretty);
  else if (level === 'warn') console.warn(pretty);
  else console.log(pretty);

  const file = ensureLogFile();
  if (file) {
    try {
      fs.appendFileSync(file, `${line}\n`, 'utf8');
    } catch (err) {
      console.error('[logger] append failed:', err.message);
    }
  }
}

export const logger = {
  configure({ level, dir, toFile } = {}) {
    if (level) _level = String(level).toLowerCase();
    if (dir) {
      _dir = dir;
      _fileDay = null;
      _filePath = null;
    }
    if (toFile != null) _fileEnabled = Boolean(toFile);
  },
  getLogDir: () => _dir,
  debug: (scope, message, meta) => write('debug', scope, message, meta),
  info: (scope, message, meta) => write('info', scope, message, meta),
  warn: (scope, message, meta) => write('warn', scope, message, meta),
  error: (scope, message, meta) => write('error', scope, message, meta),
  async time(scope, label, fn) {
    const t0 = Date.now();
    try {
      const result = await fn();
      write('info', scope, `${label} ok`, { ms: Date.now() - t0 });
      return result;
    } catch (err) {
      write('error', scope, `${label} failed`, {
        ms: Date.now() - t0,
        error: err?.message,
        code: err?.code,
        stack: err?.stack,
      });
      throw err;
    }
  },
};

export default logger;
