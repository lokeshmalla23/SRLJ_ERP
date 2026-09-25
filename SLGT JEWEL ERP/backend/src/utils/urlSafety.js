/**
 * Validates admin-supplied metal-rate source URLs before they're saved or fetched.
 * Blocks non-http(s) protocols and requests aimed at loopback/private/link-local
 * network ranges so a malicious "source URL" can't be used to probe internal services.
 */
import dns from 'dns';

const { promises: dnsPromises } = dns;

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true; // "this" network
  return false;
}

function isPrivateIPv6(ip) {
  const norm = ip.toLowerCase();
  if (norm === '::1') return true; // loopback
  if (norm === '::') return true;
  if (norm.startsWith('fe80:') || norm.startsWith('fe8') || norm.startsWith('fe9') || norm.startsWith('fea') || norm.startsWith('feb')) return true; // link-local
  if (norm.startsWith('fc') || norm.startsWith('fd')) return true; // unique local
  if (norm.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — check the embedded IPv4 address too.
    const mapped = norm.split(':').pop();
    if (mapped && mapped.includes('.')) return isPrivateIPv4(mapped);
  }
  return false;
}

function isPrivateIp(ip) {
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** Synchronous format/protocol/literal-IP check — safe for validating on save. */
export function assertValidSourceUrlFormat(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) {
    const err = new Error('URL is required');
    err.status = 400;
    throw err;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    const err = new Error(`"${value}" is not a valid URL`);
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    const err = new Error(`"${value}" must use http:// or https://`);
    err.status = 400;
    throw err;
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '0.0.0.0') {
    const err = new Error(`"${value}" points to a local address, which is not allowed`);
    err.status = 400;
    throw err;
  }
  const bareHost = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if ((bareHost.includes('.') || bareHost.includes(':')) && isPrivateIp(bareHost)) {
    const err = new Error(`"${value}" points to a private/internal network address, which is not allowed`);
    err.status = 400;
    throw err;
  }
  return parsed;
}

/**
 * Full check before an actual outbound fetch: format/protocol check plus a DNS
 * resolution check, so a public hostname that resolves to a private IP (DNS
 * rebinding) is also rejected.
 */
export async function assertSafeToFetch(rawUrl) {
  const parsed = assertValidSourceUrlFormat(rawUrl);
  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  let addresses;
  try {
    addresses = await dnsPromises.lookup(hostname, { all: true });
  } catch (err) {
    const e = new Error(`Could not resolve host "${hostname}": ${err.message}`);
    e.status = 400;
    throw e;
  }
  const blocked = addresses.find((a) => isPrivateIp(a.address));
  if (blocked) {
    const err = new Error(`"${rawUrl}" resolves to a private/internal network address, which is not allowed`);
    err.status = 400;
    throw err;
  }
  return parsed;
}
