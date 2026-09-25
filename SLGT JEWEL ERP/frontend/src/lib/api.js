import axios from "axios";
import { appNavigate, currentAppPath } from "@/lib/appNavigate";
import {
  LAN_STATUS,
  normalizeLanStatus,
  canAuthoritativeWrite,
  isAuthoritativeWriteRequest,
} from "@/lib/lanStatus";

function resolveInitialBackendUrl() {
  const fromStorage = typeof localStorage !== "undefined"
    ? localStorage.getItem("ssj_backend_url")
    : null;
  return normalizeDesktopBackendUrl(
    fromStorage
    || import.meta.env.VITE_BACKEND_URL
    || "http://127.0.0.1:8080",
  );
}

/** Rewrite leftover localhost:8000 (old default) to the live Branch port. */
function normalizeDesktopBackendUrl(url, port = 8080) {
  const s = String(url || "").replace(/\/$/, "");
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):8000$/i.test(s)) {
    return s.replace(/:8000$/i, `:${port}`);
  }
  return s || "http://127.0.0.1:8080";
}

let backendUrl = resolveInitialBackendUrl();
export let API_BASE = `${backendUrl}/api`;

/** Cached LAN status for write fencing (updated by ConnectivityBanner / host events). */
let _lanStatus = LAN_STATUS.UNKNOWN;
let _isHostPc = false;

export function setLanStatus(status) {
  const next = status || LAN_STATUS.UNKNOWN;
  if (next === _lanStatus) return;
  _lanStatus = next;
  // When LAN connectivity improves to an authoritative state, notify any billing
  // gate that is waiting — avoids a 5-second stall until the next health-check tick.
  if (canAuthoritativeWrite(next)) {
    window.dispatchEvent(new CustomEvent("lan-status-ready"));
  }
}

export function getLanStatus() {
  return _lanStatus;
}

export function setIsHostPc(v) {
  // Main PC is identified once (config mode=host). HostConnector on that PC
  // stays at cold_start because it never starts — do not demote to "client"
  // or writes get fenced with "Main PC unreachable".
  if (v) _isHostPc = true;
}

export function getBackendUrl() {
  return backendUrl;
}

/** Dynamically update the backend URL (called when LAN host is discovered on a join PC). */
export function setBackendUrl(url) {
  const normalized = normalizeDesktopBackendUrl(url);
  if (!normalized || normalized === backendUrl) return;
  backendUrl = normalized;
  localStorage.setItem("ssj_backend_url", backendUrl);
  API_BASE = `${backendUrl}/api`;
  api.defaults.baseURL = API_BASE;
}

/** Apply Branch Service URL from Electron desktop config (or manual override). */
export async function initApiBackend() {
  try {
    if (typeof window !== "undefined" && window.jewelleryCRM?.getConfig) {
      const cfg = await window.jewelleryCRM.getConfig();
      // Main PC must always talk to its own embedded backend — never a stale LAN URL.
      if (cfg?.mode === "host" || cfg?.role === "active_host") {
        backendUrl = normalizeDesktopBackendUrl(cfg.local_api_url || "http://127.0.0.1:8080");
        _isHostPc = true;
        _lanStatus = LAN_STATUS.HOST; // set immediately — don't wait for ConnectivityBanner async
      } else if (cfg?.branch_api_url) {
        backendUrl = String(cfg.branch_api_url).replace(/\/$/, "");
      }
      if (backendUrl) {
        localStorage.setItem("ssj_backend_url", backendUrl);
        API_BASE = `${backendUrl}/api`;
        api.defaults.baseURL = API_BASE;
      }
    }
  } catch {
    // Keep env / storage fallback
  }
  return backendUrl;
}

// ── Global loading tracker ────────────────────────────────────────────────────
let _activeRequests = 0;
function _notifyLoading() {
  window.dispatchEvent(new CustomEvent("api-loading", { detail: _activeRequests > 0 }));
}

/**
 * Axios adapter that bridges ALL ERP API calls through Electron IPC (Node http.request).
 *
 * Why this matters for LAN ERP:
 *   - Chromium's network stack honours navigator.onLine. When internet is unavailable
 *     (but the LAN is perfectly fine), Chromium may block fetch() to LAN addresses.
 *   - Node's http module does NOT check navigator.onLine — it uses OS TCP directly.
 *   - By routing through IPC, every API call — whether to 127.0.0.1 (local backend)
 *     or 192.168.x.x (host PC on LAN) — bypasses Chromium's internet check entirely.
 *
 * The IPC handler in main.js (api:localRequest) resolves the correct hostname/port
 * from opts.baseUrl, so LAN Host requests are forwarded correctly over Node TCP.
 */
function desktopLocalAdapter(config) {
  const crm = typeof window !== "undefined" ? window.jewelleryCRM : null;
  if (!crm?.localRequest) {
    return Promise.reject(new Error("Desktop localRequest unavailable"));
  }

  // Extract URL path — axios.getUri() builds the full URL from baseURL + url
  let urlPath;
  try {
    const full = axios.getUri(config);
    const u = new URL(full, "http://placeholder");
    urlPath = u.pathname + u.search;
  } catch {
    const base = String(config.baseURL || API_BASE || "/api").replace(/\/$/, "");
    let rel = config.url || "/";
    if (!rel.startsWith("/")) rel = `/${rel}`;
    try {
      const basePath = new URL(base, "http://placeholder").pathname.replace(/\/$/, "");
      urlPath = `${basePath}${rel}`;
    } catch {
      urlPath = `/api${rel}`;
    }
  }

  const rawHeaders = config.headers || {};
  const headers = typeof rawHeaders.toJSON === "function" ? rawHeaders.toJSON() : { ...rawHeaders };

  return crm.localRequest({
    method: (config.method || "get").toUpperCase(),
    path: urlPath,
    // Pass the current backend base URL so IPC can route to LAN host if needed
    baseUrl: backendUrl,
    headers,
    body: config.data,
    timeoutMs: config.timeout || 60000,
  }).then((res) => {
    const response = {
      data: res.data,
      status: res.status || 0,
      statusText: res.statusText || "",
      headers: res.headers || {},
      config,
      request: {},
    };
    if (res.status === 0 || res.status < 200 || res.status >= 300) {
      const err = new Error(
        (typeof res.data?.detail === "string" && res.data.detail)
          || res.statusText
          || "Local API error",
      );
      err.response = res.status ? response : undefined;
      err.config = config;
      err.isAxiosError = true;
      return Promise.reject(err);
    }
    return response;
  });
}

function shouldUseDesktopLocalAdapter() {
  if (typeof window === "undefined") return false;
  // In Electron: ALWAYS route through Node IPC regardless of destination URL.
  // This ensures LAN Host calls (http://192.168.x.x:8000) work even when
  // navigator.onLine === false (no internet). Internet status is irrelevant
  // to LAN ERP connectivity — only Host reachability matters.
  return Boolean(window.jewelleryCRM?.localRequest);
}

const api = axios.create({
  baseURL: API_BASE,
  headers: { "Content-Type": "application/json" },
  timeout: 20000,
});

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("ssj_token");
  if (token && token !== "__offline__") cfg.headers.Authorization = `Bearer ${token}`;
  const deviceId = localStorage.getItem("ssj_device_identifier");
  if (deviceId) cfg.headers["X-Device-Id"] = deviceId;

  // Host-unreachable write fence (join clients only)
  if (!_isHostPc && isAuthoritativeWriteRequest(cfg.method, cfg.url)) {
    if (!canAuthoritativeWrite(_lanStatus)) {
      const err = new Error(
        "Main PC unreachable — sales, payments, and stock changes are paused. Viewing only.",
      );
      err.code = "HOST_UNREACHABLE";
      err.response = {
        status: 503,
        data: { detail: err.message, code: "HOST_UNREACHABLE" },
      };
      err.isAxiosError = true;
      return Promise.reject(err);
    }
  }

  if (shouldUseDesktopLocalAdapter()) {
    cfg.adapter = desktopLocalAdapter;
  }
  _activeRequests++;
  _notifyLoading();
  return cfg;
});

api.interceptors.response.use(
  (r) => {
    _activeRequests = Math.max(0, _activeRequests - 1);
    _notifyLoading();
    try {
      const url = r?.config?.url || "";
      if (!String(url).includes("/health")) {
        console.info(
          `[api:ok] ${String(r?.config?.method || "get").toUpperCase()} ${url} → ${r.status}`,
        );
      }
    } catch { /* */ }
    return r;
  },
  async (err) => {
    _activeRequests = Math.max(0, _activeRequests - 1);
    _notifyLoading();

    try {
      const cfg = err?.config || {};
      console.error(
        `[api:fail] ${String(cfg.method || "get").toUpperCase()} ${cfg.url || "?"} → ${err?.response?.status || 0}`,
        err?.response?.data?.detail || err?.message,
      );
    } catch { /* */ }

    // SQLITE_BUSY — auto-retry once after the suggested delay (transparent to the user)
    if (
      err?.response?.status === 503 &&
      err?.response?.data?.code === "SQLITE_BUSY" &&
      !err?.config?._busyRetried
    ) {
      const delay = err?.response?.data?.retry_after_ms || 600;
      await new Promise((r) => setTimeout(r, delay));
      const retryConfig = { ...err.config, _busyRetried: true };
      try {
        return await api(retryConfig);
      } catch (retryErr) {
        return Promise.reject(retryErr);
      }
    }

    if (err?.response?.status === 401) {
      const url = String(err?.config?.url || "");
      // Wrong PIN / auth-check endpoints must not clear the session
      const skipLogout =
        url.includes("/settings/verify-hidden-bill-password")
        || url.includes("/settings/company/unlock")
        || url.includes("/auth/login")
        || err?.config?.skipAuthLogout;
      if (!skipLogout && currentAppPath() !== "/login") {
        localStorage.removeItem("ssj_token");
        appNavigate("/login");
      }
    }
    if (err?.response?.data?.code === "DEVICE_REVOKED") {
      localStorage.removeItem("ssj_token");
      localStorage.removeItem("ssj_device_identifier");
      localStorage.removeItem("ssj_backend_url"); // stale host URL — force rediscovery on rejoin
      localStorage.setItem(
        "ssj_device_revoked_msg",
        err?.response?.data?.detail ||
          "This device has been removed from the shop. Pair again to continue.",
      );
      if (currentAppPath() !== "/login") appNavigate("/login");
    }
    return Promise.reject(err);
  },
);

export { LAN_STATUS, normalizeLanStatus, canAuthoritativeWrite };

export function formatApiError(err) {
  const detail = err?.response?.data?.detail;
  if (!detail) return err?.message || "Something went wrong";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => {
        if (!e) return "";
        // FastAPI / Pydantic style: { loc: ["body", "name"], msg: "..." }
        const field = Array.isArray(e.loc)
          ? e.loc.filter((f) => f !== "body").join(".")
          : (e.path || e.field || null);
        const msg = e.msg || e.message || JSON.stringify(e);
        return field ? `${field}: ${msg}` : msg;
      })
      .filter(Boolean)
      .join("; ");
  return String(detail);
}

/** No-op — shop data stays on local SQLite / LAN replicas (cloud sync removed). */
export function triggerBackgroundSync() {
  return Promise.resolve(null);
}

export default api;
