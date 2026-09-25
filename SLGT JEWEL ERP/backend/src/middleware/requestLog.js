/**
 * Express middleware: log every API request success and failure with timing.
 */
import { logger } from '../utils/logger.js';

export function requestLogMiddleware(req, res, next) {
  const start = Date.now();
  const reqId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  req.logId = reqId;

  const pathOnly = (req.originalUrl || req.url || '').split('?')[0];
  // Skip ultra-noisy health spam at debug only
  const isHealth = pathOnly === '/api/health';

  if (!isHealth) {
    logger.debug('http', 'request start', {
      id: reqId,
      method: req.method,
      path: pathOnly,
      device: req.headers['x-device-id'] || null,
      hasAuth: Boolean(req.headers.authorization),
    });
  }

  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const payload = {
      id: reqId,
      method: req.method,
      path: pathOnly,
      status,
      ms,
      device: req.headers['x-device-id'] || null,
    };
    if (isHealth && status < 400) {
      logger.debug('http', 'health ok', payload);
      return;
    }
    if (status >= 500) logger.error('http', 'request failed', payload);
    else if (status >= 400) logger.warn('http', 'request rejected', payload);
    else logger.info('http', 'request ok', payload);
  });

  next();
}

const DB_ERROR_PATTERNS = [
  /SQLITE_ERROR/i, /no such table/i, /no column named/i,
  /UNIQUE constraint failed/i, /FOREIGN KEY constraint/i,
  /SequelizeDatabaseError/i, /SequelizeUniqueConstraintError/i,
  /SQLITE_BUSY/i, /SQLITE_LOCKED/i,
];

function sanitizeError(err) {
  const raw = err?.message || 'Internal server error';
  const status = err?.status || err?.statusCode || 500;

  if (status < 500) return { status, message: raw };

  // Sequelize validation errors — return the first field-level message
  if (err?.name === 'SequelizeValidationError' && err?.errors?.length) {
    const first = err.errors[0];
    return { status: 400, message: first.message || 'Validation failed' };
  }

  // Friendly messages for known DB error patterns
  if (/UNIQUE constraint failed/i.test(raw))
    return { status: 409, message: 'A record with these details already exists.' };
  if (/SQLITE_BUSY|SQLITE_LOCKED/i.test(raw))
    return { status: 503, message: 'Database is busy — please try again in a moment.' };
  if (/no such table/i.test(raw))
    return { status: 500, message: 'Database schema is out of date. Please restart the app.' };
  if (/no such column|no column named|has no column/i.test(raw))
    return { status: 500, message: 'Database schema is out of date. Please restart the app.' };
  if (DB_ERROR_PATTERNS.some((p) => p.test(raw)))
    return { status: 500, message: 'A database error occurred. Please try again.' };

  return { status, message: raw };
}

export function errorLogMiddleware(err, req, res, _next) {
  logger.error('http', 'unhandled route error', {
    id: req.logId || null,
    method: req.method,
    path: (req.originalUrl || req.url || '').split('?')[0],
    error: err?.message,
    parent_error: err?.parent?.message || null,  // original SQLite error (which column/constraint)
    fields: err?.fields || null,                  // for UniqueConstraintError
    code: err?.code,
    stack: err?.stack,
  });
  const { status, message } = sanitizeError(err);
  res.status(status).json({ detail: message, code: err.code, request_id: req.logId || undefined });
}
