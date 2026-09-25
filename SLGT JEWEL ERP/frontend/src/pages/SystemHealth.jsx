import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Activity,
  Database,
  Network,
  Wifi,
  WifiOff,
  FolderOpen,
} from "lucide-react";
import { useAuthority, AUTHORITY_STATES } from "@/context/AuthorityContext";

const HOST_RECONNECTING = new Set(['reconnecting', 'checking_last_known', 'discovering', 'verifying']);

const AUTHORITY_META = {
  [AUTHORITY_STATES.CLOUD_COORDINATED]: {
    dot: "bg-emerald-500",
    label: "Local Host Ready",
    description: "Shop service is healthy. Billing and reports run from this PC’s local database.",
  },
  [AUTHORITY_STATES.LAN_COORDINATED]: {
    dot: "bg-amber-400",
    label: "LAN Coordinated",
    description: "Another PC on the LAN is the active host; this PC holds a local replica.",
  },
  [AUTHORITY_STATES.ISOLATED]: {
    dot: "bg-red-500",
    label: "Isolated / Starting",
    description: "Local shop service is not ready yet. Billing unlocks when it comes up.",
  },
  [AUTHORITY_STATES.UNKNOWN]: {
    dot: "bg-[#a3a3a3]",
    label: "Unknown",
    description: "Authority state has not been determined yet.",
  },
};

function StatusDot({ colorClass }) {
  return (
    <span className={`inline-block h-2.5 w-2.5 rounded-full flex-shrink-0 ${colorClass}`} />
  );
}

function HealthCard({ title, icon: Icon, children, action }) {
  return (
    <div className="border border-[#E5E7EB] rounded-xl bg-white p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.11em] font-semibold text-[#737373]">
          {Icon && <Icon size={14} strokeWidth={1.75} />}
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function fmtTime(v) {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString();
  } catch {
    return String(v);
  }
}

function HostConnectionCard({ isDesktop, authorityState, hostConnState }) {
  const host = hostConnState?.host;
  const shopName = hostConnState?.host_info?.shop_name || "Main PC";

  let dot, label, description, Icon;

  if (!isDesktop) {
    Icon = Wifi;
    dot = "bg-[#a3a3a3]";
    label = "Web mode";
    description = "Host connectivity tracking is only available in the desktop app.";
  } else if (host === 'connected') {
    Icon = Wifi;
    dot = "bg-emerald-500";
    label = `Connected to ${shopName}`;
    description = "This PC is a replica. All billing writes are forwarded to the main PC over the local network.";
  } else if (host === 'not_found') {
    Icon = WifiOff;
    dot = "bg-red-500";
    label = "Main PC not found";
    description = `Cannot reach ${shopName} on the local network. Ensure it is powered on and connected to the same network.`;
  } else if (host && HOST_RECONNECTING.has(host)) {
    Icon = Wifi;
    dot = "bg-amber-400";
    label = `Searching for ${shopName}…`;
    description = "Scanning the local network for the main PC. This usually resolves in a few seconds.";
  } else if (!host && authorityState === AUTHORITY_STATES.CLOUD_COORDINATED) {
    Icon = Network;
    dot = "bg-emerald-500";
    label = "This PC is the main host";
    description = "This device is the authoritative host. Other PCs on the local network connect to it as replicas.";
  } else if (!host && authorityState === AUTHORITY_STATES.LAN_COORDINATED) {
    Icon = Wifi;
    dot = "bg-amber-400";
    label = "LAN peer active";
    description = "Following a peer on the local network. Host connector state not yet reported.";
  } else {
    Icon = Wifi;
    dot = "bg-[#a3a3a3]";
    label = "Checking…";
    description = "Determining host connection status.";
  }

  return (
    <HealthCard title="Host Connection" icon={Icon}>
      <div className="flex items-center gap-2.5">
        <StatusDot colorClass={dot} />
        <span className="text-[15px] font-semibold text-[#0A0A0A]">{label}</span>
      </div>
      <p className="text-[13px] text-[#737373] leading-relaxed">{description}</p>
    </HealthCard>
  );
}

export default function SystemHealth() {
  const { state } = useAuthority();
  const isDesktop = Boolean(window.jewelleryCRM?.isDesktop);
  const meta = AUTHORITY_META[state] ?? AUTHORITY_META[AUTHORITY_STATES.UNKNOWN];

  const [hostConnState, setHostConnState] = useState(null);
  const [dbStatus, setDbStatus] = useState(null);
  const [appInfo, setAppInfo] = useState(null);

  useEffect(() => {
    if (!isDesktop || !window.jewelleryCRM?.getAppInfo) return;
    let live = true;
    window.jewelleryCRM.getAppInfo()
      .then((info) => { if (live) setAppInfo(info); })
      .catch(() => {});
    return () => { live = false; };
  }, [isDesktop]);

  useEffect(() => {
    if (!isDesktop || !window.jewelleryCRM?.getHostState) return;
    let live = true;
    window.jewelleryCRM.getHostState()
      .then((s) => { if (live) setHostConnState(s); })
      .catch(() => {});
    if (window.jewelleryCRM.onHostStateChanged) {
      window.jewelleryCRM.onHostStateChanged((s) => { if (live) setHostConnState(s); });
    }
    return () => { live = false; };
  }, [isDesktop]);

  const refresh = useCallback(async () => {
    if (!isDesktop) return;
    try {
      const db = await window.jewelleryCRM.getLocalDbStatus();
      setDbStatus(db);
    } catch {
      // keep previous
    }
  }, [isDesktop]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 8_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const openLogs = async () => {
    if (!window.jewelleryCRM?.openLogsFolder) {
      toast.error("Open logs is only available in the desktop app");
      return;
    }
    try {
      const r = await window.jewelleryCRM.openLogsFolder();
      toast.success(r?.logDir ? `Opened ${r.logDir}` : "Opened logs folder");
    } catch (err) {
      toast.error(err?.message || "Could not open logs folder");
    }
  };

  const isReady = dbStatus?.ok === true || dbStatus?.status === "ok" || dbStatus?.ready === true;

  return (
    <div className="max-w-[1200px] pb-10">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[20px] font-semibold text-[#0A0A0A] tracking-tight flex items-center gap-2">
            <Activity size={20} strokeWidth={1.75} />
            System Health
          </h2>
          <p className="text-[13px] text-[#737373] mt-0.5">
            Local database, shop service, and LAN host status. This shop runs fully offline.
            {isDesktop && <span className="ml-1 text-[11px] text-[#a3a3a3]">Auto-refresh 8s.</span>}
          </p>
        </div>
      </div>

      {!isDesktop && (
        <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl p-4 text-[13px] mb-4">
          System health details are available in the desktop app only.
        </div>
      )}

      {isDesktop && appInfo?.run?.parityWarnings?.length ? (
        <div className="border border-amber-200 bg-amber-50 text-amber-900 rounded-xl p-4 text-[13px] mb-4 space-y-1">
          <p className="font-semibold">Local vs installed app</p>
          {appInfo.run.parityWarnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {appInfo.run.frontendBuild?.built_at ? (
            <p className="text-[11px] text-amber-800/80 font-mono">
              UI build: {appInfo.run.frontendBuild.built_at}
              {" · "}
              {appInfo.run.frontendSource}
              {" · "}
              backend {appInfo.run.backendSource}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-4">
        <HostConnectionCard
          isDesktop={isDesktop}
          authorityState={state}
          hostConnState={hostConnState}
        />

        <HealthCard title="Authority" icon={Activity}>
          <div className="flex items-center gap-2.5">
            <StatusDot colorClass={meta.dot} />
            <span className="text-[15px] font-semibold text-[#0A0A0A]">{meta.label}</span>
          </div>
          <p className="text-[13px] text-[#737373] leading-relaxed">{meta.description}</p>
        </HealthCard>

        <HealthCard
          title="Local Database"
          icon={Database}
          action={
            isDesktop && window.jewelleryCRM?.openLogsFolder ? (
              <button
                type="button"
                onClick={openLogs}
                className="text-[11px] font-semibold text-[#9B7B36] hover:underline inline-flex items-center gap-1"
              >
                <FolderOpen size={12} /> Open logs
              </button>
            ) : null
          }
        >
          <div className="flex items-center gap-2.5">
            <StatusDot colorClass={isReady ? "bg-emerald-500" : "bg-red-500"} />
            <span className={`text-[15px] font-semibold ${isReady ? "text-[#0A0A0A]" : "text-red-600"}`}>
              {isReady ? "Ready (SQLite on this PC)" : "Error"}
            </span>
          </div>
          {!isReady && (
            <p className="text-[12px] text-red-600 font-mono break-all">
              {dbStatus?.error || dbStatus?.message || "Unknown database error"}
            </p>
          )}
          {dbStatus?.logDir && (
            <p className="text-[11px] text-[#a3a3a3] font-mono break-all">
              Logs: {dbStatus.logDir}
            </p>
          )}
        </HealthCard>
      </div>

    </div>
  );
}
