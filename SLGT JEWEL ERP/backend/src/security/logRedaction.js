/**
 * Redact secrets and sensitive PII from log / error payloads.
 */
const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'secret', 'token', 'authorization', 'jwt',
  'api_key', 'apikey', 'otp', 'pin', 'card', 'upi', 'cvv',
  'backup_encryption_key', 'recovery_key', 'db_key', 'private_key',
  'access_token', 'refresh_token',
]);

const SENSITIVE_PATTERNS = [
  /\b\d{10,16}\b/g, // crude phone/card-ish
];

export function redactValue(key, value) {
  if (key && SENSITIVE_KEYS.has(String(key).toLowerCase())) return '[REDACTED]';
  if (typeof value === 'string') {
    let out = value;
    for (const re of SENSITIVE_PATTERNS) {
      // Only redact very long digit runs in known sensitive contexts
      if (key && /phone|mobile|card|pan|aadhaar/i.test(key)) {
        out = out.replace(re, '[REDACTED]');
      }
    }
    return out;
  }
  if (value && typeof value === 'object') return redactObject(value);
  return value;
}

export function redactObject(obj, depth = 0) {
  if (obj == null || depth > 6) return obj;
  if (Array.isArray(obj)) return obj.map((v) => redactValue(null, v));
  if (typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactValue(k, v);
  }
  return out;
}

export function safeErrorLog(err) {
  const base = {
    message: err?.message,
    code: err?.code,
    status: err?.status || err?.statusCode,
    stack: process.env.NODE_ENV === 'production' ? undefined : err?.stack,
  };
  return redactObject(base);
}

export function installConsoleRedaction() {
  const orig = console.error.bind(console);
  console.error = (...args) => {
    const scrubbed = args.map((a) => {
      if (a instanceof Error) return safeErrorLog(a);
      if (a && typeof a === 'object') return redactObject(a);
      return a;
    });
    orig(...scrubbed);
  };
}
