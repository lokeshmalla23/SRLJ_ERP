/**
 * Simple in-memory rate limiter for LAN Host brute-force protection.
 * Uniform 429 responses — do not reveal whether credentials/devices exist.
 */
const buckets = new Map();

function clientKey(req, suffix = '') {
  const ip = req.ip
    || req.socket?.remoteAddress
    || req.headers['x-forwarded-for']
    || 'unknown';
  return `${ip}|${suffix}`;
}

/**
 * @param {{ windowMs?: number, max?: number, keySuffix?: string|((req)=>string) }} opts
 */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 20, keySuffix = '' } = {}) {
  return (req, res, next) => {
    const suffix = typeof keySuffix === 'function' ? keySuffix(req) : keySuffix;
    const key = clientKey(req, suffix || req.path);
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      entry = { windowStart: now, count: 0 };
      buckets.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.windowStart + windowMs - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfter)));
      return res.status(429).json({
        detail: 'Too many attempts. Please wait and try again.',
        code: 'RATE_LIMITED',
      });
    }
    return next();
  };
}

/** Periodic cleanup to avoid unbounded memory growth. */
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets.entries()) {
    if (now - v.windowStart > 60 * 60 * 1000) buckets.delete(k);
  }
}, 10 * 60 * 1000).unref?.();

export function _resetRateLimitBucketsForTests() {
  buckets.clear();
}
