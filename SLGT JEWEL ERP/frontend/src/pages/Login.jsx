import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import {
  Lock, Mail, ArrowRight, Wifi, RefreshCw, WifiOff, Clock, Volume2, VolumeX,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { formatApiError, getBackendUrl, initApiBackend } from "@/lib/api";
import { APP_WINDOW_TITLE, APP_BRAND_LINE1, APP_BRAND_LINE2 } from "@/lib/appBrand";
import { T } from "@/constants/testIds";
import loginJewelleryImg from "@/assets/login-jewellery.png";
import slgtLogo from "@/assets/slgt-logo.png";

function BrandMark({ light = false }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 rounded-md flex items-center justify-center overflow-hidden flex-shrink-0 bg-white border border-[#E5E7EB]">
        <img src={slgtLogo} alt="SLGT" className="h-full w-full object-contain p-0.5" />
      </div>
      <div className="min-w-0">
        <div
          className={`font-display text-[15px] font-semibold tracking-tight leading-tight ${
            light ? "text-white" : "text-[#0A0A0A]"
          }`}
          title={APP_WINDOW_TITLE}
        >
          {APP_BRAND_LINE1}
        </div>
        <div className={`text-[12px] font-medium tracking-tight ${light ? "text-[#E8C87A]" : "text-[#525252]"}`}>
          {APP_BRAND_LINE2}
        </div>
      </div>
    </div>
  );
}

// Last-known track, cached so playback can start on the very first paint —
// before the embedded backend has even finished cold-starting — instead of
// waiting on a network round-trip every single launch.
const LOGIN_MUSIC_CACHE_KEY = "ssj_login_music_cache";
const LOGIN_MUSIC_LOOP_CACHE_KEY = "ssj_login_music_loop_cache";

/**
 * Background music for the login screen only — this component (and its
 * <audio> element) unmounts the moment the user signs in and Login goes
 * away, so the music never follows them into the rest of the app.
 * Source comes from Settings → Company Profile → Login Screen Music
 * (GET /api/settings/company/public, unauthenticated — this page has no
 * token yet). Renders nothing when no track has been uploaded.
 */
function LoginMusic() {
  const audioRef = useRef(null);
  const [muted, setMuted] = useState(false);
  // Lazy initializer runs once, synchronously, before the first paint — so a
  // returning launch has `src` (and therefore <audio autoPlay>) ready
  // immediately, with zero network wait.
  const [src, setSrc] = useState(() => {
    try { return localStorage.getItem(LOGIN_MUSIC_CACHE_KEY) || null; } catch { return null; }
  });
  // Whether to loop is an admin-set preference (Settings → Company Profile),
  // cached alongside the track itself so it's correct from the first paint.
  const [loopEnabled, setLoopEnabled] = useState(() => {
    try { return localStorage.getItem(LOGIN_MUSIC_LOOP_CACHE_KEY) === "1"; } catch { return false; }
  });

  useEffect(() => {
    // On a full app close + reopen, the embedded backend is a brand-new child
    // process (desktop/main.js spawns it fresh AFTER the window is already
    // shown, so the login page renders before it's listening) — unlike a mere
    // logout, where that same backend process never stopped running, so the
    // very first fetch always succeeded instantly. This still runs every
    // launch (even when the cache above already started playback) so that an
    // admin uploading/removing a track is picked up, and so a first-ever
    // launch (nothing cached yet) still gets the track as fast as possible:
    // quick 250ms retries for the first few seconds (covers the common case
    // where the backend is already up or comes up almost immediately), then
    // backing off to 2s so a genuinely slow cold start doesn't hammer the
    // port for minutes. Total budget ~3 minutes.
    let live = true;
    let timer = null;
    let attempt = 0;
    const MAX_ATTEMPTS = 110;

    const tryFetch = async () => {
      try {
        const base = getBackendUrl().replace(/\/$/, "") || "http://127.0.0.1:8080";
        const res = await fetch(`${base}/api/settings/company/public`, { signal: AbortSignal.timeout(4000) });
        if (!live) return;
        const data = await res.json().catch(() => null);
        if (data?.login_music) {
          const loop = Boolean(data.login_music_loop);
          setSrc((prev) => (prev === data.login_music ? prev : data.login_music));
          setLoopEnabled(loop);
          try {
            localStorage.setItem(LOGIN_MUSIC_CACHE_KEY, data.login_music);
            localStorage.setItem(LOGIN_MUSIC_LOOP_CACHE_KEY, loop ? "1" : "0");
          } catch { /* ignore */ }
          return; // got the authoritative answer — stop
        }
        if (res.ok) {
          // Authoritative "nothing uploaded" (or an admin just removed it) —
          // clear any stale cache so the next launch doesn't play a track
          // that's no longer configured.
          setSrc(null);
          try {
            localStorage.removeItem(LOGIN_MUSIC_CACHE_KEY);
            localStorage.removeItem(LOGIN_MUSIC_LOOP_CACHE_KEY);
          } catch { /* ignore */ }
          return;
        }
        scheduleRetry();
      } catch {
        // Backend not reachable yet (still starting) — try again shortly.
        scheduleRetry();
      }
    };

    const scheduleRetry = () => {
      if (!live || attempt >= MAX_ATTEMPTS) return;
      attempt += 1;
      const delay = attempt <= 20 ? 250 : 2000;
      timer = setTimeout(tryFetch, delay);
    };

    tryFetch();

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el || !src) return undefined;
    el.volume = 0.35;
    let cleanup = () => {};
    el.play().catch(() => {
      // Autoplay-with-sound blocked (e.g. opened in a plain browser tab
      // before any click) — resume on the first interaction instead.
      const resume = () => { el.play().catch(() => {}); cleanup(); };
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
      cleanup = () => {
        window.removeEventListener("pointerdown", resume);
        window.removeEventListener("keydown", resume);
      };
    });
    return () => cleanup();
  }, [src]);

  if (!src) return null;

  return (
    <>
      <audio ref={audioRef} src={src} loop={loopEnabled} autoPlay preload="auto" />
      <button
        type="button"
        onClick={() => {
          const el = audioRef.current;
          if (!el) return;
          el.muted = !el.muted;
          setMuted(el.muted);
        }}
        title={muted ? "Unmute music" : "Mute music"}
        className="fixed top-4 right-4 z-20 h-9 w-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/45 transition-colors"
      >
        {muted ? <VolumeX size={16} strokeWidth={1.5} /> : <Volume2 size={16} strokeWidth={1.5} />}
      </button>
    </>
  );
}

function localDeviceId() {
  let id = localStorage.getItem("ssj_device_identifier");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("ssj_device_identifier", id);
  }
  return id;
}

async function resolveLocalDeviceId() {
  // Never replace a stored join identifier with the local backend's own device_id —
  // that mismatch created a *new* pending PC after restart.
  const stored = localStorage.getItem("ssj_device_identifier");
  if (stored) return stored;
  try {
    if (window.jewelleryCRM?.getConfig) {
      const cfg = await window.jewelleryCRM.getConfig();
      if (cfg?.device_id) {
        localStorage.setItem("ssj_device_identifier", cfg.device_id);
        return cfg.device_id;
      }
    }
  } catch { /* */ }
  return localDeviceId();
}

async function persistClientPairing({
  shop_id,
  device_id,
  device_identifier,
  device_number,
  device_token,
  lan_shared_key,
  hostUrl,
}) {
  const identifier = device_identifier || device_id;
  if (identifier) localStorage.setItem("ssj_device_identifier", identifier);
  if (hostUrl) localStorage.setItem("ssj_backend_url", hostUrl);
  if (window.jewelleryCRM?.setConfig) {
    await window.jewelleryCRM.setConfig({
      mode: "join",
      role: "replica",
      ...(hostUrl ? {
        branch_api_url: hostUrl,
        host_api_url: hostUrl,
        last_known_host_url: hostUrl,
        local_api_url: "http://127.0.0.1:8080",
      } : {}),
      shop_id: shop_id || null,
      device_id: identifier,
      device_number: device_number || 2,
      setup_complete: true,
    });
  }
  if (window.jewelleryCRM?.notifyPairingComplete && shop_id && identifier) {
    await window.jewelleryCRM.notifyPairingComplete({
      shop_id,
      device_id: identifier,
      device_identifier: identifier,
      device_number: device_number || 2,
      device_token: device_token || null,
      lan_shared_key: lan_shared_key || null,
    });
  }
}

async function resolveDeviceName() {
  try {
    if (window.jewelleryCRM?.getConfig) {
      const cfg = await window.jewelleryCRM.getConfig();
      if (cfg?.device_name) return cfg.device_name;
    }
  } catch { /* */ }
  return localStorage.getItem("ssj_device_name") || "Staff PC";
}

/**
 * Call Main PC APIs from a staff PC.
 * Must use Electron IPC (Node http) — Chromium fetch to LAN IPs often fails
 * from the packaged UI, so Devices never sees the join request.
 */
async function hostApi(hostUrl, { method = "GET", path, body, headers = {}, timeoutMs = 10000 } = {}) {
  const base = String(hostUrl || "").replace(/\/$/, "");
  if (!base) throw new Error("Main PC address missing");
  let reqPath = String(path || "/");
  if (!reqPath.startsWith("/")) reqPath = `/${reqPath}`;
  if (!reqPath.startsWith("/api")) reqPath = `/api${reqPath}`;

  if (window.jewelleryCRM?.localRequest) {
    const res = await window.jewelleryCRM.localRequest({
      method: method.toUpperCase(),
      path: reqPath,
      baseUrl: base,
      body,
      headers,
      timeoutMs,
    });
    const response = { status: res.status || 0, data: res.data };
    if (!res.ok || res.status === 0 || res.status >= 400) {
      const err = new Error(
        (typeof res.data?.detail === "string" && res.data.detail)
        || res.statusText
        || `Request failed (${res.status || 0})`,
      );
      err.response = { status: res.status, data: res.data };
      throw err;
    }
    return response;
  }

  const res = await fetch(`${base}${reqPath}`, {
    method: method.toUpperCase(),
    headers: { "Content-Type": "application/json", ...headers },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || `Request failed (${res.status})`);
    err.response = { status: res.status, data };
    throw err;
  }
  return { status: res.status, data };
}

const CONNECTING_STATES = new Set([
  "cold_start", "checking_last_known", "discovering", "verifying", "reconnecting",
]);

function ConnectionDot({ ok, label }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-[#525252]">
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-400"}`} />
      {label}
    </div>
  );
}

function HostDiscoveryPanel({ discoveredHosts, manualUrl, onManualUrl, onConnect, probing, busy, onProbe }) {
  return (
    <div className="space-y-3">
      {discoveredHosts.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-1.5">
            Found on network
          </p>
          <div className="space-y-1.5">
            {discoveredHosts.map((h) => {
              const addr = h.candidate_urls?.[0]
                || (h.rinfo_address ? `http://${h.rinfo_address}:${h.api_port || 8080}` : null)
                || h.api_url || h.address || String(h);
              const label = h.shop_name || h.device_name || addr;
              return (
                <button
                  key={addr}
                  type="button"
                  disabled={busy}
                  onClick={() => onConnect(addr)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F9FAFB] text-left text-[13px] font-medium text-[#0A0A0A] disabled:opacity-50"
                >
                  <span className="flex items-center gap-2">
                    <Wifi size={13} className="text-emerald-500 shrink-0" />
                    {label}
                  </span>
                  <span className="text-[11px] font-mono text-[#9CA3AF] truncate">{addr !== label ? addr : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-1.5">
          Enter Main PC address manually
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            className="input flex-1 text-[13px]"
            placeholder="http://192.168.1.10:8080"
            value={manualUrl}
            onChange={(e) => onManualUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manualUrl.trim()) onConnect(manualUrl.trim());
            }}
          />
          <button
            type="button"
            disabled={busy || !manualUrl.trim()}
            onClick={() => onConnect(manualUrl.trim())}
            className="px-3 py-2 rounded-lg bg-[#0A0A0A] text-white text-[12px] font-semibold disabled:opacity-40"
          >
            Connect
          </button>
        </div>
      </div>

      <button
        type="button"
        onClick={onProbe}
        disabled={probing || busy}
        className="w-full flex items-center justify-center gap-2 text-[12px] text-[#737373] hover:text-[#0A0A0A] py-1"
      >
        <RefreshCw size={12} className={probing ? "animate-spin" : ""} />
        {probing ? "Scanning…" : "Scan network again"}
      </button>
    </div>
  );
}

function SearchingMainPc({ onRetry, retrying, discoveredHosts, manualUrl, onManualUrl, onConnect, probing, busy, onProbe }) {
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg px-4 py-3 border bg-blue-50 border-blue-200 text-center">
        <RefreshCw size={18} className="mx-auto text-blue-400 mb-1.5 animate-spin" />
        <p className="text-[13px] font-semibold text-blue-800">Searching for the Main PC on your local network…</p>
        <p className="text-[11.5px] text-blue-600 mt-1">Keep this computer on the same network as the Main PC.</p>
      </div>
      <HostDiscoveryPanel
        discoveredHosts={discoveredHosts}
        manualUrl={manualUrl}
        onManualUrl={onManualUrl}
        onConnect={onConnect}
        probing={probing}
        busy={busy}
        onProbe={onProbe}
      />
    </div>
  );
}

function MainPcUnavailable({ onRetry, retrying, discoveredHosts, manualUrl, onManualUrl, onConnect, probing, busy, onProbe, errorCode }) {
  // HOST_UNREACHABLE = discovered via UDP but HTTP health-check blocked (firewall).
  // HOST_NOT_FOUND   = no UDP response at all (wrong network or app not running).
  const isUnreachable = errorCode === "HOST_UNREACHABLE" || discoveredHosts.length > 0;
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg px-4 py-3 border bg-red-50 border-red-200 text-center">
        <WifiOff size={20} className="mx-auto text-red-400 mb-1.5" />
        <p className="text-[13px] font-semibold text-red-800">
          {isUnreachable ? "Main PC found but can’t connect" : "Main PC not found"}
        </p>
        <p className="text-[11.5px] text-red-600 mt-1">
          {isUnreachable
            ? "The Main PC is visible on the network but the connection was blocked. On the Main PC, allow port 8080 in Windows Firewall (TCP, inbound)."
            : "Make sure both PCs are on the same local network, or enter the address below."}
        </p>
      </div>
      <HostDiscoveryPanel
        discoveredHosts={discoveredHosts}
        manualUrl={manualUrl}
        onManualUrl={onManualUrl}
        onConnect={onConnect}
        probing={probing}
        busy={busy}
        onProbe={onProbe}
      />
    </div>
  );
}

function WaitingApproval({ deviceName, shopName, declined, onRequestAgain, busy }) {
  return (
    <div className="mt-6 space-y-4">
      <div className={`rounded-lg px-4 py-4 border ${declined ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}>
        {declined ? (
          <>
            <p className="text-[14px] font-semibold text-red-900">Access request declined</p>
            <p className="text-[12px] text-red-700 mt-1">
              Ask the owner or administrator on the Main PC to allow this computer, then request access again.
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <Clock size={16} className="text-amber-700" />
              <p className="text-[14px] font-semibold text-amber-950">Device approval required</p>
            </div>
            <p className="text-[12.5px] text-amber-900">
              This computer needs approval from the Main PC before it can access the ERP.
            </p>
          </>
        )}
      </div>
      <div className="border border-[#E5E7EB] rounded-lg px-4 py-3 text-[13px] space-y-2">
        <div className="flex justify-between gap-3">
          <span className="text-[#737373]">Device</span>
          <span className="font-medium text-right">{deviceName || "This PC"}</span>
        </div>
        {shopName && (
          <div className="flex justify-between gap-3">
            <span className="text-[#737373]">Shop</span>
            <span className="font-medium text-right">{shopName}</span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-[#737373]">Status</span>
          <span className="font-medium">{declined ? "Declined" : "Waiting for approval"}</span>
        </div>
      </div>
      {declined ? (
        <button type="button" onClick={onRequestAgain} disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? "Requesting…" : "Request Access Again"}
        </button>
      ) : (
        <>
          <p className="text-[11.5px] text-center text-[#737373]">
            On the Main PC open Settings → Devices and choose Allow Device.
          </p>
          <button
            type="button"
            onClick={onRequestAgain}
            disabled={busy}
            className="w-full py-2.5 text-[13px] font-medium rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#FAFAFA] disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send request again"}
          </button>
        </>
      )}
    </div>
  );
}

function DeviceRevoked({ onRequestAgain, busy }) {
  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-lg px-4 py-4 border bg-red-50 border-red-200 text-center">
        <p className="text-[13px] font-semibold text-red-800">This device is no longer authorized.</p>
        <p className="text-[11.5px] text-red-600 mt-1">
          Ask the owner or administrator to approve this computer.
        </p>
      </div>
      <button type="button" onClick={onRequestAgain} disabled={busy} className="btn-primary w-full py-2.5">
        {busy ? "Requesting…" : "Request Access"}
      </button>
    </div>
  );
}

function LoginForm({
  onSubmit, busy, error, connectedLabel, isHost, needsOwner,
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [shopName, setShopName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [showForgotHelp, setShowForgotHelp] = useState(false);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ email, password, shopName, ownerName, needsOwner });
      }}
      className="mt-6 space-y-4"
    >
      {connectedLabel && <ConnectionDot ok label={connectedLabel} />}
      {isHost && (
        <div className="rounded-lg bg-[#F0FDF4] border border-[#BBF7D0] px-3 py-2 text-[12px] text-[#15803D]">
          {needsOwner
            ? "First time on this Main PC — create the owner account below"
            : "This PC is the Main PC"}
        </div>
      )}
      {needsOwner && (
        <>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">Shop name</label>
            <input
              className="input"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Your jewellery shop"
              required
            />
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">Your name</label>
            <input
              className="input"
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Shop Owner"
            />
          </div>
        </>
      )}
      <div>
        <label className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">Email</label>
        <div className="relative">
          <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" />
          <input
            data-testid={T.loginEmail}
            type={needsOwner ? "email" : "text"}
            className="input pl-9"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">Password</label>
        <div className="relative">
          <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" />
          <input
            data-testid={T.loginPassword}
            type="password"
            className="input pl-9"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={needsOwner ? 8 : undefined}
          />
        </div>
      </div>
      {error && (
        <div data-testid={T.loginError} className="text-[12.5px] text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] px-3 py-2 rounded-md">
          {error}
        </div>
      )}
      <button data-testid={T.loginSubmit} type="submit" disabled={busy} className="btn-primary w-full py-2.5">
        {busy
          ? (needsOwner ? "Setting up…" : "Signing in…")
          : (needsOwner ? "Create owner & sign in" : "Sign in")}
        <ArrowRight size={14} />
      </button>
      {!needsOwner && (
        <div className="text-center pt-1">
          <button
            type="button"
            data-testid={T.loginForgotPassword}
            onClick={() => setShowForgotHelp((v) => !v)}
            className="text-[12px] text-[#2563EB] hover:text-[#1D4ED8] underline underline-offset-2"
          >
            Forgot Password?
          </button>
          {showForgotHelp && (
            <div className="mt-3 text-left rounded-lg px-3 py-2.5 bg-[#F5F5F4] border border-[#E5E5E5] text-[12px] text-[#525252] leading-relaxed">
              Please contact your ERP administrator to reset your login credentials.
              <div className="mt-1.5 font-medium text-[#404040]">
                Company: SLGT Marketing ERP<br />
                Contact: +91 85005 01823
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

export default function Login() {
  const { user, login, loading } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pcMode, setPcMode] = useState(null); // host | client | unknown
  const [needsOwner, setNeedsOwner] = useState(false);
  const [hostConnState, setHostConnState] = useState(null);
  const [authPhase, setAuthPhase] = useState("boot"); // boot | searching | unavailable | waiting | declined | revoked | login
  const [deviceName, setDeviceName] = useState("Staff PC");
  const [shopName, setShopName] = useState("");
  const [discoveredHosts, setDiscoveredHosts] = useState([]);
  const [manualUrl, setManualUrl] = useState(
    () => localStorage.getItem("ssj_manual_host_url") || ""
  );
  const [probing, setProbing] = useState(false);
  const pollRef = useRef(null);
  const requestedRef = useRef(false);
  const nav = useNavigate();
  const isDesktop = Boolean(window.jewelleryCRM);

  useEffect(() => {
    initApiBackend().catch(() => {});
  }, []);

  const loadPublicBrand = useCallback(async () => {
    document.title = APP_WINDOW_TITLE;
  }, []);

  useEffect(() => {
    loadPublicBrand();
  }, [loadPublicBrand]);

  const refreshBootstrapStatus = useCallback(async () => {
    try {
      const base = getBackendUrl().replace(/\/$/, "") || "http://127.0.0.1:8080";
      const st = await fetch(`${base}/api/cluster/bootstrap-status`, {
        signal: AbortSignal.timeout(4000),
      }).then((r) => (r.ok ? r.json() : null));
      setNeedsOwner(Boolean(st?.needs_owner));
    } catch {
      setNeedsOwner(false);
    }
  }, []);

  const probeForHosts = useCallback(async () => {
    setProbing(true);
    try {
      const localBase = "http://127.0.0.1:8080";
      let data;
      if (window.jewelleryCRM?.localRequest) {
        const res = await window.jewelleryCRM.localRequest({
          method: "GET",
          path: "/api/devices/discover",
          baseUrl: localBase,
          timeoutMs: 5000,
        });
        data = res?.data;
      } else {
        const res = await fetch(`${localBase}/api/devices/discover?timeout_ms=4000`, {
          signal: AbortSignal.timeout(5000),
        });
        data = await res.json().catch(() => ({}));
      }
      if (Array.isArray(data?.hosts) && data.hosts.length > 0) {
        setDiscoveredHosts(data.hosts);
      }
    } catch { /* non-fatal */ } finally {
      setProbing(false);
    }
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        if (window.jewelleryCRM?.getConfig) {
          const cfg = await window.jewelleryCRM.getConfig();
          if (!live) return;
          if (cfg?.mode === "join" || cfg?.role === "replica" || cfg?.role === "client") {
            setPcMode("client");
          } else {
            // Default / host / unfinished setup → Main PC sign-in (no separate first-launch)
            setPcMode("host");
            setAuthPhase("login");
            try {
              const base = getBackendUrl().replace(/\/$/, "") || "http://127.0.0.1:8080";
              const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
              if (h?.device_id) localStorage.setItem("ssj_device_identifier", h.device_id);
            } catch { /* backend may still be starting */ }
            await refreshBootstrapStatus();
          }
        } else {
          setPcMode("host");
          setAuthPhase("login");
          try {
            const base = getBackendUrl().replace(/\/$/, "") || "http://127.0.0.1:8080";
            const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
            if (h?.device_id) localStorage.setItem("ssj_device_identifier", h.device_id);
            if (h?.role && h.role !== "active_host") setPcMode("client");
          } catch { /* */ }
          await refreshBootstrapStatus();
        }
        setDeviceName(await resolveDeviceName());
      } catch {
        if (live) {
          setPcMode("host");
          setAuthPhase("login");
        }
      }
    })();
    return () => { live = false; };
  }, [isDesktop, refreshBootstrapStatus]);

  const switchToHost = async () => {
    setError("");
    setPcMode("host");
    setAuthPhase("login");
    stopPoll();
    if (window.jewelleryCRM?.setConfig) {
      await window.jewelleryCRM.setConfig({
        mode: "host",
        role: "active_host",
        branch_api_url: "http://127.0.0.1:8080",
        local_api_url: "http://127.0.0.1:8080",
      });
    }
    localStorage.setItem("ssj_backend_url", "http://127.0.0.1:8080");
    await initApiBackend();
    try {
      const h = await fetch("http://127.0.0.1:8080/api/health", { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
      if (h?.device_id) localStorage.setItem("ssj_device_identifier", h.device_id);
    } catch { /* */ }
    await refreshBootstrapStatus();
    await loadPublicBrand();
  };

  const switchToClient = async () => {
    setError("");
    setPcMode("client");
    setAuthPhase("searching");
    setDiscoveredHosts([]);
    requestedRef.current = false;
    if (window.jewelleryCRM?.setConfig) {
      await window.jewelleryCRM.setConfig({
        mode: "join",
        role: "replica",
      });
    }
    try {
      await window.jewelleryCRM?.retryHostConnection?.();
    } catch { /* */ }
    probeForHosts();
  };

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const claimAndApprove = useCallback(async (hostUrl, deviceIdentifier) => {
    let claim = {};
    try {
      const claimRes = await hostApi(hostUrl, {
        method: "POST",
        path: "/api/devices/claim-approval",
        body: { device_identifier: deviceIdentifier },
      });
      claim = claimRes.data || {};
    } catch (err) {
      if (err?.response?.status === 409) {
        await persistClientPairing({
          shop_id: err.response?.data?.shop_id,
          device_id: deviceIdentifier,
          device_identifier: deviceIdentifier,
          hostUrl,
        });
        return { ok: true, already: true };
      }
      throw err;
    }

    if (claim.bootstrap_token && window.jewelleryCRM?.stashSnapshot) {
      try {
        const snapRes = await hostApi(hostUrl, {
          method: "POST",
          path: "/api/cluster/snapshot/bootstrap",
          headers: {
            "X-Bootstrap-Token": claim.bootstrap_token,
            "X-Device-Id": deviceIdentifier,
          },
          body: { token: claim.bootstrap_token, device_id: deviceIdentifier },
        });
        if (snapRes?.data) {
          await window.jewelleryCRM.stashSnapshot(snapRes.data);
        }
      } catch (e) {
        console.warn("snapshot pull failed", e);
      }
    }

    localStorage.setItem("ssj_backend_url", hostUrl);
    await persistClientPairing({
      shop_id: claim.shop_id,
      device_id: deviceIdentifier,
      device_identifier: claim.device?.device_identifier || deviceIdentifier,
      device_number: claim.device_number || 2,
      device_token: claim.device_token || null,
      lan_shared_key: claim.lan_shared_key || null,
      hostUrl,
    });
    return { ok: true, claim };
  }, []);

  const sendAccessRequest = useCallback(async (hostUrl, { force = false } = {}) => {
    if (!hostUrl) return;
    if (requestedRef.current && !force) return;
    const deviceIdentifier = await resolveLocalDeviceId();
    const name = await resolveDeviceName();
    setDeviceName(name);
    try {
      if (window.jewelleryCRM?.localRequest) {
        await window.jewelleryCRM.localRequest({
          method: "POST",
          path: "/api/devices/join-ready",
          body: { device_name: name },
          timeoutMs: 4000,
        }).catch(() => {});
      }
      const { data } = await hostApi(hostUrl, {
        method: "POST",
        path: "/api/devices/request-join",
        body: {
          device_identifier: deviceIdentifier,
          device_name: name,
          platform: navigator.platform || undefined,
        },
      });
      requestedRef.current = true;
      if (data.shop_name) setShopName(data.shop_name);
      if (data.already_approved) {
        await persistClientPairing({
          shop_id: data.shop_id,
          device_id: data.device?.device_identifier || deviceIdentifier,
          device_identifier: data.device?.device_identifier || deviceIdentifier,
          device_number: data.device_number,
          hostUrl,
        });
        setAuthPhase("login");
        return true;
      }
      setAuthPhase("waiting");
      return true;
    } catch (err) {
      if (err?.response?.status === 429) {
        setError(err.response?.data?.detail || "Please wait before requesting again.");
        return false;
      }
      // Do NOT enter "waiting" — that lied when Main PC never received the request,
      // so Settings → Devices stayed empty on the owner PC.
      setError(
        formatApiError(err)
        || "Could not reach Main PC to request access. Check the address and that the Main PC ERP is running.",
      );
      setAuthPhase("unavailable");
      return false;
    }
  }, []);

  const startStatusPoll = useCallback((hostUrl) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const deviceIdentifier = await resolveLocalDeviceId();
        const { data } = await hostApi(hostUrl, {
          method: "GET",
          path: `/api/devices/join-status?device_identifier=${encodeURIComponent(deviceIdentifier)}`,
          timeoutMs: 4000,
        });
        if (data.shop_name) setShopName(data.shop_name);
        if (data.device_name) setDeviceName(data.device_name);

        if (data.status === "revoked") {
          setAuthPhase("revoked");
          return;
        }
        if (data.status === "declined") {
          setAuthPhase("declined");
          requestedRef.current = false;
          return;
        }
        if (data.status === "active" || data.status === "approved") {
          if (data.claim_ready) {
            await claimAndApprove(hostUrl, deviceIdentifier);
          } else {
            await persistClientPairing({
              shop_id: data.shop_id,
              device_id: data.device_id || deviceIdentifier,
              device_identifier: deviceIdentifier,
              hostUrl,
            });
          }
          stopPoll();
          setAuthPhase("login");
        }
      } catch { /* keep polling */ }
    }, 2500);
  }, [claimAndApprove]);

  const connectToHost = useCallback(async (hostUrl) => {
    const url = String(hostUrl || "").trim().replace(/\/$/, "");
    if (!url) return;
    setError("");
    setBusy(true);
    try {
      if (window.jewelleryCRM?.setConfig) {
        await window.jewelleryCRM.setConfig({
          mode: "join",
          role: "replica",
          branch_api_url: url,
          host_api_url: url,
          last_known_host_url: url,
          local_api_url: "http://127.0.0.1:8080",
        });
      }
      localStorage.setItem("ssj_backend_url", url);
      localStorage.setItem("ssj_manual_host_url", url);
      setHostConnState((s) => ({ ...(s || {}), host: "connected", host_url: url }));
      const ok = await sendAccessRequest(url);
      if (ok) startStatusPoll(url);
      await loadPublicBrand();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  }, [sendAccessRequest, startStatusPoll, loadPublicBrand]);

  useEffect(() => {
    if (pcMode !== "client" || !isDesktop) return undefined;
    let live = true;

    const applyState = async (s) => {
      if (!live || !s) return;
      setHostConnState(s);
      const { host, device, host_url: hostUrl, host_info: hostInfo } = s;

      if (CONNECTING_STATES.has(host)) {
        setAuthPhase("searching");
        return;
      }
      if (host === "not_found") {
        setAuthPhase("unavailable");
        probeForHosts();
        return;
      }
      if (host !== "connected" || !hostUrl) {
        setAuthPhase("searching");
        return;
      }

      // HostConnector verified a (possibly new) IP via UDP discovery — persist it
      // so the manual field and future startups always use the correct current IP.
      localStorage.setItem("ssj_manual_host_url", hostUrl);
      localStorage.setItem("ssj_backend_url", hostUrl);
      setManualUrl(hostUrl);

      if (hostInfo?.shop_name) setShopName(hostInfo.shop_name);

      if (device === "revoked") {
        setAuthPhase("revoked");
        return;
      }
      if (device === "paired") {
        setAuthPhase("login");
        return;
      }

      // not_paired / unknown / checking → request access + wait only if request actually landed
      if (device === "not_paired" || device === "checking" || device === "unknown" || device === "pending") {
        const ok = await sendAccessRequest(hostUrl);
        if (ok) {
          startStatusPoll(hostUrl);
          setAuthPhase((p) => (p === "declined" || p === "revoked" || p === "login" ? p : "waiting"));
        }
      }
    };

    (async () => {
      try {
        const s = await window.jewelleryCRM.getHostState();
        await applyState(s);
      } catch { /* */ }
    })();

    if (window.jewelleryCRM.onHostStateChanged) {
      window.jewelleryCRM.onHostStateChanged((s) => { applyState(s); });
    }

    return () => {
      live = false;
      stopPoll();
    };
  }, [pcMode, isDesktop, sendAccessRequest, startStatusPoll, probeForHosts]);

  if (!loading && user) return <Navigate to="/" replace />;

  const retryHost = async () => {
    setRetrying(true);
    setError("");
    setDiscoveredHosts([]);
    try {
      await window.jewelleryCRM?.retryHostConnection?.();
    } catch { /* */ } finally {
      setRetrying(false);
    }
    probeForHosts();
  };

  const submitLogin = async ({ email, password, shopName: shop, ownerName, needsOwner: createOwner }) => {
    setError("");
    setBusy(true);
    try {
      if (pcMode === "client" && hostConnState?.host_url) {
        const deviceIdentifier = await resolveLocalDeviceId();
        // Prefer host auth so role/permissions come from Main PC; device must already be approved
        try {
          const { data } = await hostApi(hostConnState.host_url, {
            method: "POST",
            path: "/api/auth/login",
            headers: { "X-Device-Id": deviceIdentifier },
            body: { email, password, device_identifier: deviceIdentifier },
          });
          localStorage.setItem("ssj_token", data.access_token);
          localStorage.setItem("ssj_backend_url", hostConnState.host_url);
          sessionStorage.setItem("ssj_session_ok", "1");
          if (window.jewelleryCRM?.notifyEmployeeSignedIn) {
            await window.jewelleryCRM.notifyEmployeeSignedIn();
          }
          if (window.jewelleryCRM?.notifyPairingComplete && data.user) {
            await window.jewelleryCRM.notifyPairingComplete({
              shop_id: hostConnState.host_info?.shop_id,
              device_id: deviceIdentifier,
            });
          }
          // Full reload (not router nav) so AuthContext re-bootstraps from the token
          // we just stored. Electron serves this page over file://, where an
          // absolute-path assign("/") resolves to the filesystem root and fails to
          // load — reload() re-requests the same document instead.
          window.location.reload();
          return;
        } catch (err) {
          const code = err?.response?.data?.code;
          if (code === "DEVICE_REVOKED") {
            setAuthPhase("revoked");
            return;
          }
          if (code === "DEVICE_PENDING" || code === "DEVICE_DECLINED") {
            setAuthPhase(code === "DEVICE_DECLINED" ? "declined" : "waiting");
            return;
          }
          throw err;
        }
      }

      // Main PC first-run: create owner on this Sign In page (no separate first-launch)
      if (createOwner || needsOwner) {
        if (!shop?.trim()) throw new Error("Shop name is required");
        if (!password || password.length < 8) throw new Error("Password must be at least 8 characters");
        const base = getBackendUrl().replace(/\/$/, "") || "http://127.0.0.1:8080";
        const boot = await fetch(`${base}/api/cluster/bootstrap-owner`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: ownerName || "Shop Owner",
            email,
            password,
            shop_name: shop.trim(),
          }),
        });
        const bootData = await boot.json().catch(() => ({}));
        if (!boot.ok && boot.status !== 409) {
          throw Object.assign(new Error(bootData.detail || "Could not create owner"), { response: { data: bootData } });
        }
        setNeedsOwner(false);
      }

      // Main PC: bind X-Device-Id to the host identity so a stale staff-PC id cannot block login
      if (pcMode === "host") {
        try {
          const base = getBackendUrl().replace(/\/$/, "") || "http://127.0.0.1:8080";
          const h = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(4000) }).then((r) => r.json());
          if (h?.device_id) localStorage.setItem("ssj_device_identifier", h.device_id);
        } catch { /* */ }
      }

      await login(email, password);
      if (window.jewelleryCRM?.setConfig && pcMode === "host") {
        await window.jewelleryCRM.setConfig({
          mode: "host",
          role: "active_host",
          setup_complete: true,
          shop_name: shop?.trim() || undefined,
        });
      }
      if (window.jewelleryCRM?.notifyEmployeeSignedIn) {
        await window.jewelleryCRM.notifyEmployeeSignedIn();
      }
      nav("/");
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const requestAgain = async () => {
    setBusy(true);
    setError("");
    requestedRef.current = false;
    try {
      const url = hostConnState?.host_url;
      await sendAccessRequest(url, { force: true });
      if (url) startStatusPoll(url);
    } finally {
      setBusy(false);
    }
  };

  const renderBody = () => {
    if (pcMode === "host" || (!isDesktop && authPhase === "login")) {
      return (
        <>
          <LoginForm
            onSubmit={submitLogin}
            busy={busy}
            error={error}
            isHost={pcMode === "host"}
            needsOwner={needsOwner}
            connectedLabel={pcMode === "host" ? "Main PC ready" : null}
          />
          {isDesktop && (
            <button
              type="button"
              onClick={switchToClient}
              className="mt-4 w-full text-[12px] text-[#737373] hover:text-[#0A0A0A] underline-offset-2 hover:underline"
            >
              This is a staff PC — connect to Main PC
            </button>
          )}
        </>
      );
    }

    const discoveryProps = {
      discoveredHosts,
      manualUrl,
      onManualUrl: (v) => { setManualUrl(v); if (v) localStorage.setItem("ssj_manual_host_url", v); },
      onConnect: connectToHost,
      probing,
      busy,
      onProbe: probeForHosts,
    };

    if (authPhase === "boot" || authPhase === "searching") {
      return (
        <>
          <SearchingMainPc
            onRetry={authPhase === "searching" ? retryHost : null}
            retrying={retrying}
            {...discoveryProps}
          />
          <button
            type="button"
            onClick={switchToHost}
            className="mt-4 w-full text-[12px] text-[#737373] hover:text-[#0A0A0A] underline-offset-2 hover:underline"
          >
            This is the Main PC — sign in here
          </button>
        </>
      );
    }
    if (authPhase === "unavailable") {
      return (
        <>
          <MainPcUnavailable
            onRetry={retryHost}
            retrying={retrying}
            errorCode={hostConnState?.error}
            {...discoveryProps}
          />
          <button
            type="button"
            onClick={switchToHost}
            className="mt-4 w-full text-[12px] text-[#737373] hover:text-[#0A0A0A] underline-offset-2 hover:underline"
          >
            This is the Main PC — sign in here
          </button>
        </>
      );
    }
    if (authPhase === "revoked") {
      return <DeviceRevoked onRequestAgain={requestAgain} busy={busy} />;
    }
    if (authPhase === "waiting" || authPhase === "declined") {
      return (
        <WaitingApproval
          deviceName={deviceName}
          shopName={shopName || hostConnState?.host_info?.shop_name}
          declined={authPhase === "declined"}
          onRequestAgain={requestAgain}
          busy={busy}
        />
      );
    }

    return (
      <>
        <LoginForm
          onSubmit={submitLogin}
          busy={busy}
          error={error}
          connectedLabel="Connected to Main PC"
        />
        <button
          type="button"
          onClick={switchToHost}
          className="mt-4 w-full text-[12px] text-[#737373] hover:text-[#0A0A0A] underline-offset-2 hover:underline"
        >
          This is the Main PC — sign in here
        </button>
      </>
    );
  };

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-5 login-bg">
      <LoginMusic />
      <div className="hidden lg:flex lg:col-span-3 relative overflow-hidden border-r border-[#0B1220]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `url('${loginJewelleryImg}')`,
            backgroundSize: "cover",
            backgroundPosition: "right center",
          }}
          aria-hidden
        />
        {/* Soft left veil so copy stays readable over the velvet */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#06101F]/88 via-[#06101F]/55 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#06101F]/45 via-transparent to-[#06101F]/25" />
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <BrandMark light />
          <div className="max-w-xl">
            <h1 className="font-display text-[40px] leading-[1.05] font-semibold text-white tracking-tight drop-shadow-[0_2px_24px_rgba(0,0,0,0.35)]">
              Approve the PC once. Staff just sign in.
            </h1>
            <p className="text-[14px] text-[#D6D0C4] mt-6 max-w-md leading-relaxed">
              New computers appear on the Main PC for approval. After that, anyone with an account signs in with email and password — roles come from their account, not the device.
            </p>
          </div>
          <div className="text-[11px] text-[#A8A29A] font-mono">© {new Date().getFullYear()} SLGT</div>
        </div>
      </div>

      <div className="lg:col-span-2 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="mb-6">
            <BrandMark />
          </div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-[#737373] font-semibold mb-3">Sign in</div>
          <h2 className="font-display text-[26px] font-semibold text-[#0A0A0A] tracking-tight">
            {needsOwner && pcMode === "host" ? "Set up Main PC." : "Welcome back."}
          </h2>
          {renderBody()}
        </div>
      </div>
    </div>
  );
}
