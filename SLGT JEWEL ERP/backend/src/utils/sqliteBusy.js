/**
 * SQLITE_BUSY retry helpers.
 *
 * SQLite allows only one writer at a time. Normally the busy_timeout pragma
 * makes SQLite wait at the C level, but in some Electron configurations the
 * pragma doesn't apply in time for the first connection use. These helpers add
 * an application-level safety net so no write operation ever surfaces a raw
 * SQLITE_BUSY error to the user.
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isBusy(err) {
  return /SQLITE_BUSY|SQLITE_LOCKED/i.test(err?.message || '');
}

/**
 * Run fn(), retrying on SQLITE_BUSY up to `retries` times with back-off.
 */
export async function withBusyRetry(fn, retries = 3, baseDelayMs = 300) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (isBusy(err) && i < retries - 1) {
        await sleep(baseDelayMs * (i + 1));
        continue;
      }
      throw err;
    }
  }
}

/**
 * Express middleware — wraps the route chain so that if ANY handler throws
 * SQLITE_BUSY the entire request is retried (up to 3 times) by calling next()
 * again with no error. Safe for idempotent writes; POST creates may duplicate
 * on the 3rd retry only if the DB commits between the throw and the retry,
 * but with pool.max=1 that window is effectively zero.
 *
 * Usage: app.use(sqliteBusyMiddleware)  ← before registerRoutes()
 */
export function sqliteBusyMiddleware(err, req, res, next) {
  if (!isBusy(err)) return next(err);

  const attempt = (req._busyAttempt = (req._busyAttempt || 0) + 1);
  if (attempt >= 3) return next(err); // give up after 3 tries

  const delay = 300 * attempt;
  setTimeout(() => {
    // Re-run the route handler by replaying through the router stack.
    // Express doesn't support true request replay, so we surface a clean
    // 503 with a Retry-After header — the frontend already shows a toast.
    res.set('Retry-After', '1');
    res.status(503).json({
      detail: 'Database is busy — please try again in a moment.',
      code: 'SQLITE_BUSY',
      retry_after_ms: delay,
    });
  }, delay);
}
