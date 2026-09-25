/**
 * Normalized LAN / Host reachability for ERP write fencing.
 * Internet / navigator.onLine is irrelevant.
 */

export const LAN_STATUS = Object.freeze({
  HOST: "HOST",
  CONNECTED: "CONNECTED",
  CONNECTING: "CONNECTING",
  RECONNECTING: "RECONNECTING",
  NOT_FOUND: "NOT_FOUND",
  UNKNOWN: "UNKNOWN",
});

const CONNECTING_HOST = new Set([
  "cold_start",
  "checking_last_known",
  "discovering",
  "verifying",
]);

/** Map hostConnector.state → LAN_STATUS */
export function normalizeLanStatus(hostConnectorState, { isHostPc = false } = {}) {
  if (isHostPc) return LAN_STATUS.HOST;
  const host = hostConnectorState?.host;
  if (!host) return LAN_STATUS.UNKNOWN;
  if (host === "connected") return LAN_STATUS.CONNECTED;
  if (host === "reconnecting") return LAN_STATUS.RECONNECTING;
  if (host === "not_found") return LAN_STATUS.NOT_FOUND;
  if (CONNECTING_HOST.has(host)) return LAN_STATUS.CONNECTING;
  return LAN_STATUS.UNKNOWN;
}

export function canAuthoritativeWrite(lanStatus) {
  // RECONNECTING = was connected, brief blip — safe to allow writes while reconnecting
  return (
    lanStatus === LAN_STATUS.HOST ||
    lanStatus === LAN_STATUS.CONNECTED ||
    lanStatus === LAN_STATUS.RECONNECTING
  );
}

const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);

/** Paths allowed even when Host is unreachable (local drafts / read-only UX helpers). */
const WRITE_ALLOWLIST = [
  /^\/auth\/login$/i,
  /^\/devices\/employee-join$/i,
  /^\/devices\/register$/i,
  /^\/devices\/join-ready$/i,
  /^\/devices\/heartbeat$/i,
  /^\/cluster\/snapshot\/bootstrap$/i,
];

export function isAuthoritativeWriteRequest(method, urlPath) {
  if (!WRITE_METHODS.has(String(method || "").toLowerCase())) return false;
  const path = String(urlPath || "").replace(/^\/api/, "") || "/";
  return !WRITE_ALLOWLIST.some((re) => re.test(path));
}
