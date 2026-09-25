import { useEffect, useState } from "react";
import { useAuthority, AUTHORITY_STATES } from "@/context/AuthorityContext";
import { setLanStatus, setIsHostPc, setBackendUrl, LAN_STATUS, normalizeLanStatus } from "@/lib/api";

// Host connector states that indicate a client PC is trying to reach the Host
const HOST_RECONNECTING = new Set(['reconnecting', 'checking_last_known', 'discovering', 'verifying']);

export default function ConnectivityBanner() {
  const { state: authorityState, detail } = useAuthority();
  const isDesktop = Boolean(window.jewelleryCRM?.isDesktop);

  // Track host connector state for client PCs (non-host devices)
  const [hostConnState, setHostConnState] = useState(null);
  // True when we've confirmed this device is the main PC (via config or connector role)
  const [isHostPcLocal, setIsHostPcLocal] = useState(false);

  useEffect(() => {
    if (!isDesktop || !window.jewelleryCRM?.getHostState) {
      // Browser / host without connector: treat as HOST when talking to local API
      setIsHostPc(true);
      setIsHostPcLocal(true);
      setLanStatus(LAN_STATUS.HOST);
      return undefined;
    }
    let live = true;
    const hostPcRef = { current: false };

    const markHost = () => {
      hostPcRef.current = true;
      setIsHostPcLocal(true);
      setIsHostPc(true);
      setLanStatus(LAN_STATUS.HOST);
    };

    const applyConfig = (cfg) => {
      if (!live) return;
      const isHost = cfg?.mode === "host" || cfg?.role === "active_host"
        || (cfg && cfg.mode !== "join" && cfg.role !== "replica" && cfg.role !== "client");
      if (isHost) markHost();
    };

    const apply = (s) => {
      if (!live) return;
      setHostConnState(s);
      const mode = s?.mode || s?.role;
      const isHost = mode === "host" || s?.role === "active_host" || s?.is_host === true;
      // Heuristic: if host state is absent/idle and we are not discovering, likely host PC
      const hostPc = hostPcRef.current || isHost || (!s?.host && s?.device === "paired");
      if (hostPc) {
        markHost();
        return;
      }
      // When the LAN host is verified on a join PC, update backendUrl so ALL API calls
      // (including POS health check and billing writes) route to the main PC — not the
      // local replica at 127.0.0.1. Must happen BEFORE setLanStatus dispatches lan-status-ready.
      if (s?.host === "connected" && s?.host_url) {
        setBackendUrl(s.host_url);
      }
      setLanStatus(normalizeLanStatus(s, { isHostPc: false }));
      // When connector reports not_found, re-read config — owner may have switched to
      // host mode in this session after the initial config check already ran.
      if (s?.host === "not_found" || s?.host === "cold_start") {
        window.jewelleryCRM.getConfig?.().then(applyConfig).catch(() => {});
      }
    };

    window.jewelleryCRM.getHostState()
      .then(apply)
      .catch(() => {});

    if (window.jewelleryCRM.onHostStateChanged) {
      window.jewelleryCRM.onHostStateChanged(apply);
    }

    // Also read desktop config for mode=host
    window.jewelleryCRM.getConfig?.().then(applyConfig).catch(() => {});

    return () => { live = false; };
  }, [isDesktop]);

  const pending = detail?.pendingSync ?? 0;
  const host = hostConnState?.host;
  const hostInfo = hostConnState?.host_info;
  const shopName = hostInfo?.shop_name || "Main PC";

  // ── Host not found (client PC, discovery exhausted) ────────────────────────
  if (host === 'not_found' && !isHostPcLocal) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#E7C8BC] bg-[#FBF0EC] px-4 py-2.5 text-sm text-[#713F35]">
        <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[#A4513F] shadow-[0_0_0_3px_rgba(164,81,63,0.12)]" />
        <span className="min-w-0 font-semibold">{shopName} not found</span>
        <span className="min-w-0 text-[12px] leading-5 text-[#7C5148] sm:flex-1">
          Cannot reach the main PC on the local network. Check that it is powered on and connected.
        </span>
      </div>
    );
  }

  // ── Host reconnecting (client PC, keepalive lost) ───────────────────────────
  if (host && HOST_RECONNECTING.has(host) && !isHostPcLocal) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#E4D3A7] bg-[#FBF5E8] px-4 py-2.5 text-sm text-[#5F512F]">
        <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[#B49042] shadow-[0_0_0_3px_rgba(180,144,66,0.14)]" />
        <span className="min-w-0 font-semibold text-[#6F5729]">Reconnecting to {shopName}…</span>
        <span className="min-w-0 text-[12px] leading-5 text-[#786B48] sm:flex-1">
          Searching for the main PC on the local network.
        </span>
      </div>
    );
  }

  // ── Local service starting / authority lost ─────────────────────────────────
  if (authorityState === AUTHORITY_STATES.ISOLATED) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#E4D3A7] bg-[#FBF5E8] px-4 py-2.5 text-sm text-[#5F512F]">
        <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-[#B49042] shadow-[0_0_0_3px_rgba(180,144,66,0.14)]" />
        <span className="min-w-0 font-semibold text-[#6F5729]">Starting shop service…</span>
        <span className="min-w-0 text-[12px] leading-5 text-[#786B48] sm:flex-1">
          Local API not ready yet. Billing unlocks automatically when the service is up.
        </span>
        {pending > 0 && (
          <span className="ml-auto rounded-full border border-[#DCCBAA] bg-[#FCFAF4]/65 px-2 py-0.5 text-[10.5px] font-medium text-[#6F5D35]">
            {pending} event{pending !== 1 ? "s" : ""} queued
          </span>
        )}
      </div>
    );
  }

  // ── Replica mode (client PC, following host) ────────────────────────────────
  if (authorityState === AUTHORITY_STATES.LAN_COORDINATED) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#C8DACA] bg-[#F1F6F1] px-4 py-2.5 text-sm text-[#355747]">
        <span className="h-2 w-2 flex-shrink-0 rounded-full bg-[#3F6D58] shadow-[0_0_0_3px_rgba(63,109,88,0.12)]" />
        <span className="min-w-0 font-semibold text-[#294F40]">Following {shopName}</span>
        <span className="min-w-0 text-[12px] leading-5 text-[#53675B] sm:flex-1">
          This PC is a replica. All billing writes go to the main PC.
        </span>
        {pending > 0 && (
          <span className="ml-auto rounded-full border border-[#C8DACA] bg-[#FCFAF4]/70 px-2 py-0.5 text-[10.5px] font-medium text-[#496556]">
            {pending} event{pending !== 1 ? "s" : ""} queued
          </span>
        )}
      </div>
    );
  }

  // ── Normal operation — no banner ────────────────────────────────────────────
  return null;
}
