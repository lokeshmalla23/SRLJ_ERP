import { Sequelize } from 'sequelize';
import 'dotenv/config';
import { logger } from './utils/logger.js';

const isElectron   = process.env.ELECTRON_RUN === '1';
// Desktop/Electron must use local SQLite. Packaged .env often has a cloud
// DATABASE_URL; on Windows an empty override can be dropped and dotenv reloads it.
const forceLocalSqlite = isElectron && process.env.USE_CLOUD_DB !== '1';
const databaseUrl  = forceLocalSqlite ? null : process.env.DATABASE_URL;
const sqlitePath   = process.env.SQLITE_PATH;

// In Electron mode we fall back to local SQLite unless USE_CLOUD_DB=1.
// Outside Electron, DATABASE_URL is mandatory.
if (!isElectron && !databaseUrl) {
  throw new Error('DATABASE_URL environment variable is required');
}

export const isLocalMode = () => forceLocalSqlite || (isElectron && !databaseUrl);

// Op helpers — iLike is PostgreSQL only; SQLite LIKE is case-insensitive for ASCII
import { Op } from 'sequelize';
export const likeOp  = isLocalMode() ? Op.like : Op.iLike;

// Lock helper — SQLite uses file-level locking; FOR UPDATE is a no-op / unsupported
export function withLock(opts, transaction) {
  if (isLocalMode()) return { ...opts, transaction };
  return { ...opts, transaction, lock: transaction.LOCK.UPDATE };
}

/** Map legacy sslmode values so pg-connection-string keeps verify-full semantics. */
function normalizeDatabaseUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    const mode = u.searchParams.get('sslmode');
    if (mode === 'require' || mode === 'prefer' || mode === 'verify-ca') {
      u.searchParams.set('sslmode', 'verify-full');
    }
    return u.toString();
  } catch {
    return url;
  }
}

function resolveSsl() {
  const flag = process.env.DB_SSL;
  if (flag === 'false' || flag === '0') return false;
  if (flag === 'true'  || flag === '1') return { require: true, rejectUnauthorized: false };
  try {
    const host = new URL(databaseUrl).hostname;
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    if (local) return false;
  } catch { /* fall through */ }
  return { require: true, rejectUnauthorized: false };
}

function sqlLogger(sql) {
  const text = String(sql || '');
  logger.debug('sqlite', 'query', { sql: text.length > 800 ? `${text.slice(0, 800)}…` : text });
}

const enableSqlLog =
  process.env.DB_LOGGING === 'true'
  || process.env.LOG_SQL === '1'
  || (isElectron && process.env.LOG_SQL !== '0');

let sequelize;

if (isLocalMode()) {
  const storage = sqlitePath || './jewellery-crm.sqlite';
  logger.info('sqlite', 'opening database', { storage, electron: isElectron });
  sequelize = new Sequelize({
    dialect: 'sqlite',
    storage,
    logging: enableSqlLog ? sqlLogger : false,
    retry: { max: 8, match: [/SQLITE_BUSY/i, /SQLITE_LOCKED/i] },
    pool: { max: 1, min: 0, idle: 10000 },
    dialectOptions: { busyTimeout: 30000 },
  });
  sequelize.afterConnect(async (connection) => {
    try {
      if (typeof connection.pragma === 'function') {
        connection.pragma('busy_timeout = 30000');
        connection.pragma('journal_mode = WAL');
        connection.pragma('foreign_keys = ON');
        logger.debug('sqlite', 'pragmas applied', { busy_timeout: 30000, journal_mode: 'WAL' });
      } else if (connection?.run) {
        await new Promise((resolve, reject) => {
          connection.run('PRAGMA busy_timeout = 30000', (err) => (err ? reject(err) : resolve()));
        });
        await new Promise((resolve, reject) => {
          connection.run('PRAGMA journal_mode = WAL', (err) => (err ? reject(err) : resolve()));
        });
        await new Promise((resolve, reject) => {
          connection.run('PRAGMA foreign_keys = ON', (err) => (err ? reject(err) : resolve()));
        });
        logger.debug('sqlite', 'pragmas applied via run()');
      }
    } catch (err) {
      logger.warn('sqlite', 'pragma setup failed', { error: err.message });
    }
  });
} else {
  const ssl = resolveSsl();
  logger.info('db', 'opening postgres', { ssl: Boolean(ssl) });
  sequelize = new Sequelize(normalizeDatabaseUrl(databaseUrl), {
    dialect: 'postgres',
    dialectOptions: ssl ? { ssl } : {},
    logging: enableSqlLog ? sqlLogger : false,
    pool: { max: 10, min: 2, acquire: 30000, idle: 60000 },
  });
}

export default sequelize;
