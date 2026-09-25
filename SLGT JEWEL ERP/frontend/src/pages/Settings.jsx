import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Save, Plus, Trash2, X, Building2, Coins, Download, Database, RefreshCw, Activity, Monitor, Crown, ArrowLeftRight, CheckCircle2, XCircle, Loader2, Wifi, WifiOff, Percent, ScrollText, Printer, Tag, AlertTriangle, FileText, ClipboardList, LayoutGrid } from "lucide-react";
import { printHtml } from "@/lib/printHtml";
import { generateStripTagPrintPayload, makePinTagBarcodeUrl } from "@/lib/labelPrint";
import { generateActiveEstimationPrintHTML } from "@/lib/estimationPrint";
import { SAMPLE_ESTIMATION } from "@/lib/estimationLayout";
import api, { formatApiError, getBackendUrl } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import MoneyInput from "@/components/ui/MoneyInput";
import { Switch } from "@/components/ui/switch";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import { notifyCompanyUpdated, useCompany } from "@/context/CompanyContext";
import { notifyDisplayPrefsChanged } from "@/context/DisplayPrefsContext";
import { formatRoleLabel, hasFullAccessRole, isSuperAdminRole } from "@/lib/roleLabel";
import { fmtDate, fmtDateTime, fmtINR, parseMoneyInput } from "@/lib/format";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import useConfirm from "@/hooks/useConfirm";
import { DEFAULT_SHOP_WHATSAPP_NUMBER } from "@/lib/shopConfig";
import { invalidateStockAlertSoundCache } from "@/lib/stockAlert";
import DbBrowser from "@/components/settings/DbBrowser";
import BackupExportTab from "@/components/settings/BackupExportTab";
import ImportProgressModal from "@/components/inventory/ImportProgressModal";
import {
  emptyImportProgress,
  formatImportSummary,
  importProductsFromCsv,
} from "@/lib/productCsvImport";
import {
  SettingsSection,
  SettingsSplit,
  SettingsTabFrame,
  PrintSettingsLockBanner,
} from "@/components/settings/settingsLayout";
import ApplicationManagementTab from "@/components/settings/ApplicationManagementTab";
import InvoiceLayoutEditor from "@/components/settings/InvoiceLayoutEditor";
import InvoiceLetterheadSection from "@/components/settings/InvoiceLetterheadSection";
import BarcodeLayoutEditor from "@/components/settings/BarcodeLayoutEditor";
import EstimationLayoutEditor from "@/components/settings/EstimationLayoutEditor";

/** Settings tabs with RBAC — view gates visibility; write gates Save / destructive actions. */
const TABS = [
  { id: "company", label: "Company", icon: Building2, tid: T.settingsTabsCompany, module: "settings", view: "view", write: "manage" },
  { id: "gold", label: "Gold Rate", icon: Coins, tid: T.settingsTabsGoldRate, module: "settings", view: "view", write: "edit" },
  { id: "billing", label: "Billing", icon: Percent, tid: "settings-tab-billing", module: "settings", view: "view", write: "manage" },
  { id: "hidden", label: "Hidden Bill", icon: Crown, tid: "settings-tab-hidden", module: "settings", view: "view", write: "manage", ownerOnly: true, secret: true },
  { id: "app-management", label: "Application Management", icon: LayoutGrid, tid: "settings-tab-app-management", module: "settings", view: "view", write: "manage", superAdminOnly: true },
  { id: "devices", label: "Devices", icon: Monitor, tid: "settings-tab-devices", module: "settings", view: "view", write: "manage" },
  { id: "printers", label: "Printers & Devices", icon: Printer, tid: "settings-tab-printers", module: "settings", view: "view", write: "edit" },
  { id: "invoice-print", label: "Invoice Print", icon: FileText, tid: "settings-tab-invoice-print", module: "settings", view: "view", write: "manage" },
  { id: "barcode-tag", label: "Barcode Tag", icon: Tag, tid: "settings-tab-barcode-tag", module: "settings", view: "view", write: "manage" },
  { id: "estimation-print", label: "Estimation Print", icon: ClipboardList, tid: "settings-tab-estimation-print", module: "settings", view: "view", write: "manage" },
  { id: "network", label: "Shop Network", icon: Wifi, tid: "settings-tab-network", module: "settings", view: "view", write: "manage" },
  { id: "system", label: "System Health", icon: Activity, tid: "settings-tab-system", module: "settings", view: "view", write: null },
  { id: "audit", label: "Audit", icon: ScrollText, tid: "settings-tab-audit", module: "settings", view: "view", write: null },
  { id: "backup", label: "Backup & Export", icon: Database, tid: "settings-tab-backup", module: "backup", view: "view", write: "manage" },
  { id: "import", label: "Import CSV", icon: Download, tid: "settings-tab-import", module: "backup", view: "export", write: "export" },
];

/** Each of these tabs locks and unlocks on its own (5× click on that tab). */
const PRINT_SETTINGS_TABS = {
  printers: { label: "Printers & Devices" },
  "invoice-print": { label: "Invoice Print" },
  "barcode-tag": { label: "Barcode Tag" },
  "estimation-print": { label: "Estimation Print" },
};

function emptyClickState() {
  return { count: 0, timer: null };
}

function ViewOnlyBanner({ module, action }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" strokeWidth={1.5} />
      <span>
        View only — you need <span className="font-mono font-semibold">{module}.{action}</span> to make changes.
      </span>
    </div>
  );
}

export default function SettingsPage() {
  const { can, user } = useAuth();
  const isOwner = hasFullAccessRole(user?.role);
  // Application Management is the ERP Administrator's own tool (licensing modules
  // for a shop) — deliberately narrower than "owner", so a shop_owner never sees it.
  const isSuperAdmin = isSuperAdminRole(user?.role);
  const [hiddenBillTabUnlocked, setHiddenBillTabUnlocked] = useState(false);
  const [appManagementRevealed, setAppManagementRevealed] = useState(false);
  const visibleTabs = TABS.filter((t) => {
    if (t.ownerOnly && !isOwner) return false;
    if (t.superAdminOnly && !isSuperAdmin) return false;
    if (t.secret && !hiddenBillTabUnlocked) return false;
    // Application Management stays undiscoverable until the ERP Administrator
    // clicks the Settings page header 5× (see the onClick on <PageHeader> below) —
    // like Hidden Bill's reveal-via-Billing-tab gesture, but its own trigger.
    if (t.id === "app-management" && !appManagementRevealed) return false;
    return can(t.module, t.view || "view");
  });
  const allowedKey = visibleTabs.map((t) => t.id).join("|");
  const [tab, setTab] = useState(() => visibleTabs[0]?.id || "company");
  const [dbBrowserOpen, setDbBrowserOpen] = useState(false);
  const backupClicksRef = useRef({ count: 0, timer: null });
  const companyClicksRef = useRef({ count: 0, timer: null });
  const billingClicksRef = useRef({ count: 0, timer: null });
  const printTabClicksRef = useRef({
    printers: emptyClickState(),
    "invoice-print": emptyClickState(),
    "barcode-tag": emptyClickState(),
    "estimation-print": emptyClickState(),
  });
  const [companyUnlocked, setCompanyUnlocked] = useState(false);
  const [companyUnlockOpen, setCompanyUnlockOpen] = useState(false);
  const [companyUnlockBusy, setCompanyUnlockBusy] = useState(false);
  const [companyUnlockError, setCompanyUnlockError] = useState("");
  const appManagementRevealClicksRef = useRef({ count: 0, timer: null });
  const appManagementUnlockClicksRef = useRef({ count: 0, timer: null });
  const [appManagementUnlocked, setAppManagementUnlocked] = useState(false);
  const [appManagementUnlockOpen, setAppManagementUnlockOpen] = useState(false);
  const [appManagementUnlockBusy, setAppManagementUnlockBusy] = useState(false);
  const [appManagementUnlockError, setAppManagementUnlockError] = useState("");
  const [printTabUnlocked, setPrintTabUnlocked] = useState({
    printers: false,
    "invoice-print": false,
    "barcode-tag": false,
    "estimation-print": false,
  });
  const [printUnlockTab, setPrintUnlockTab] = useState(null);
  const [printSettingsUnlockBusy, setPrintSettingsUnlockBusy] = useState(false);
  const [printSettingsUnlockError, setPrintSettingsUnlockError] = useState("");

  useEffect(() => {
    const allowed = allowedKey ? allowedKey.split("|") : [];
    if (allowed.length && !allowed.includes(tab)) setTab(allowed[0]);
  }, [allowedKey, tab]);

  const resetClickCounter = (ref) => {
    ref.current.count = 0;
    if (ref.current.timer) {
      clearTimeout(ref.current.timer);
      ref.current.timer = null;
    }
  };

  const bumpClickCounter = (ref, onHit, times = 5) => {
    const state = ref.current;
    if (state.timer) clearTimeout(state.timer);
    state.count += 1;
    if (state.count >= times) {
      state.count = 0;
      state.timer = null;
      onHit();
    } else {
      state.timer = setTimeout(() => {
        state.count = 0;
        state.timer = null;
      }, 2500);
    }
  };

  const handleTabClick = (id) => {
    setTab(id);
    if (id === "backup" && isOwner) {
      bumpClickCounter(backupClicksRef, () => setDbBrowserOpen(true));
    } else {
      resetClickCounter(backupClicksRef);
    }
    if (id === "company") {
      bumpClickCounter(companyClicksRef, () => {
        if (companyUnlocked) {
          toast.info("Company profile is already unlocked");
          return;
        }
        setCompanyUnlockError("");
        setCompanyUnlockOpen(true);
      });
    } else {
      resetClickCounter(companyClicksRef);
    }
    if (id === "billing" && isOwner) {
      bumpClickCounter(billingClicksRef, () => {
        setHiddenBillTabUnlocked(true);
        setTab("hidden");
      }, 3);
    } else {
      resetClickCounter(billingClicksRef);
    }
    if (PRINT_SETTINGS_TABS[id]) {
      bumpClickCounter({ current: printTabClicksRef.current[id] }, () => {
        if (printTabUnlocked[id]) return;
        setPrintSettingsUnlockError("");
        setPrintUnlockTab(id);
      });
    }
    if (id === "app-management" && isSuperAdmin) {
      bumpClickCounter(appManagementUnlockClicksRef, () => {
        if (appManagementUnlocked) {
          toast.info("Application Management is already unlocked");
          return;
        }
        setAppManagementUnlockError("");
        setAppManagementUnlockOpen(true);
      });
    } else {
      resetClickCounter(appManagementUnlockClicksRef);
    }
  };

  // 5 clicks on the Settings page title/subtitle reveals the Application
  // Management tab (undiscoverable otherwise) — a separate gesture from the
  // per-tab unlock click above, which only unlocks it for editing once visible.
  const handlePageHeaderClick = () => {
    if (!isSuperAdmin || appManagementRevealed) return;
    bumpClickCounter(appManagementRevealClicksRef, () => {
      setAppManagementRevealed(true);
      setTab("app-management");
      toast.success("Application Management tab revealed");
    });
  };

  const submitAppManagementUnlock = async (password) => {
    setAppManagementUnlockBusy(true);
    setAppManagementUnlockError("");
    try {
      await api.post("/settings/application-management/unlock", { password });
      setAppManagementUnlocked(true);
      setAppManagementUnlockOpen(false);
      toast.success("Application Management unlocked");
    } catch (err) {
      const msg = formatApiError(err) || "Failed — incorrect password";
      setAppManagementUnlockError(msg);
      toast.error(msg);
    } finally {
      setAppManagementUnlockBusy(false);
    }
  };

  const submitCompanyUnlock = async (password) => {
    setCompanyUnlockBusy(true);
    setCompanyUnlockError("");
    try {
      await api.post("/settings/company/unlock", { password });
      setCompanyUnlocked(true);
      setCompanyUnlockOpen(false);
      toast.success("Company profile unlocked");
    } catch (err) {
      const msg = formatApiError(err) || "Failed — incorrect password";
      setCompanyUnlockError(msg);
      toast.error(msg);
    } finally {
      setCompanyUnlockBusy(false);
    }
  };

  const submitPrintSettingsUnlock = async (password) => {
    const tabId = printUnlockTab;
    if (!tabId) return;
    setPrintSettingsUnlockBusy(true);
    setPrintSettingsUnlockError("");
    try {
      await api.post("/settings/print-settings/unlock", { password });
      setPrintTabUnlocked((prev) => ({ ...prev, [tabId]: true }));
      setPrintUnlockTab(null);
      toast.success(`${PRINT_SETTINGS_TABS[tabId]?.label || "Tab"} unlocked`);
    } catch (err) {
      const msg = formatApiError(err) || "Failed — incorrect password";
      setPrintSettingsUnlockError(msg);
      toast.error(msg);
    } finally {
      setPrintSettingsUnlockBusy(false);
    }
  };

  const lockPrintTab = (id) => setPrintTabUnlocked((prev) => ({ ...prev, [id]: false }));

  const active = visibleTabs.find((t) => t.id === tab) || null;
  const canWrite = Boolean(active?.write && can(active.module, active.write));

  if (!visibleTabs.length) {
    return (
      <div className="w-full">
        <PageHeader title="Settings" subtitle="Configure your showroom, live rates, staff and access controls." />
        <div className="card text-[13px] text-[#737373]">
          You do not have permission to view any settings. Ask the shop owner to grant <span className="font-mono">settings.view</span>.
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-[calc(100vh-8rem)]">
      {isOwner ? (
        <DbBrowser open={dbBrowserOpen} onClose={() => setDbBrowserOpen(false)} />
      ) : null}
      <div onClick={handlePageHeaderClick}>
        <PageHeader title="Settings" subtitle="Configure your showroom, live rates, staff and access controls." />
      </div>
      <div className="sticky top-16 z-10 -mx-1 mb-5 border-b border-[#E5E7EB] bg-[#F7F7F5]/95 backdrop-blur-sm">
        <div className="flex items-center gap-0.5 overflow-x-auto px-1">
          {visibleTabs.map((t) => {
            const Icon = t.icon;
            const isActive = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={t.tid}
                onClick={() => handleTabClick(t.id)}
                className={`flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? "text-[#0A0A0A] border-[#0A0A0A]"
                    : "text-[#737373] border-transparent hover:text-[#0A0A0A]"
                }`}
              >
                <Icon size={14} strokeWidth={1.5} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {active?.write && !canWrite && (
        <ViewOnlyBanner module={active.module} action={active.write} />
      )}

      {tab === "company" && (
        <CompanyTab
          canWrite={canWrite}
          unlocked={companyUnlocked}
          onLocked={() => setCompanyUnlocked(false)}
        />
      )}
      {companyUnlockOpen && (
        <CompanyUnlockDialog
          busy={companyUnlockBusy}
          error={companyUnlockError}
          onClose={() => {
            if (!companyUnlockBusy) {
              setCompanyUnlockOpen(false);
              setCompanyUnlockError("");
            }
          }}
          onSubmit={submitCompanyUnlock}
        />
      )}
      {printUnlockTab && (
        <CompanyUnlockDialog
          title={`Unlock ${PRINT_SETTINGS_TABS[printUnlockTab]?.label || "settings"}`}
          subtitle="Enter the password"
          busy={printSettingsUnlockBusy}
          error={printSettingsUnlockError}
          onClose={() => {
            if (!printSettingsUnlockBusy) {
              setPrintUnlockTab(null);
              setPrintSettingsUnlockError("");
            }
          }}
          onSubmit={submitPrintSettingsUnlock}
        />
      )}
      {appManagementUnlockOpen && (
        <CompanyUnlockDialog
          title="Unlock Application Management"
          subtitle="Enter the password"
          busy={appManagementUnlockBusy}
          error={appManagementUnlockError}
          onClose={() => {
            if (!appManagementUnlockBusy) {
              setAppManagementUnlockOpen(false);
              setAppManagementUnlockError("");
            }
          }}
          onSubmit={submitAppManagementUnlock}
        />
      )}
      {tab === "gold" && <GoldRateTab canWrite={canWrite} />}
      {tab === "billing" && <BillingTab canWrite={canWrite} />}
      {tab === "hidden" && isOwner && <HiddenBillSettingsTab canWrite={canWrite} />}
      {tab === "app-management" && isSuperAdmin && (
        <ApplicationManagementTab
          canWrite={canWrite}
          unlocked={appManagementUnlocked}
          onLocked={() => setAppManagementUnlocked(false)}
        />
      )}
      {tab === "devices" && <DevicesTab canWrite={canWrite} />}
      {tab === "printers" && (
        <PrintersDevicesTab
          canWrite={canWrite}
          unlocked={printTabUnlocked.printers}
          onLocked={() => lockPrintTab("printers")}
        />
      )}
      {tab === "invoice-print" && (
        <InvoiceLayoutEditor
          canWrite={canWrite}
          unlocked={printTabUnlocked["invoice-print"]}
          onLocked={() => lockPrintTab("invoice-print")}
        />
      )}
      {tab === "barcode-tag" && (
        <BarcodeLayoutEditor
          canWrite={canWrite}
          unlocked={printTabUnlocked["barcode-tag"]}
          onLocked={() => lockPrintTab("barcode-tag")}
        />
      )}
      {tab === "estimation-print" && (
        <EstimationLayoutEditor
          canWrite={canWrite}
          unlocked={printTabUnlocked["estimation-print"]}
          onLocked={() => lockPrintTab("estimation-print")}
        />
      )}
      {tab === "network" && <ShopNetworkTab canWrite={canWrite} />}
      {tab === "system" && <SystemHealthTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "backup" && <BackupExportTab canWrite={canWrite} />}
      {tab === "import" && <ImportCsvTab canWrite={canWrite} />}
    </div>
  );
}

// ─── Shop Network (host / replicas / promote) ─────────────────────────────────
function ShopNetworkTab({ canWrite = false }) {
  const { user, can } = useAuth();
  const [nodes, setNodes] = useState(null);
  const [eligibility, setEligibility] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState({ dual: false, isolate: false });
  const [showDiag, setShowDiag] = useState(false);

  const refresh = async () => {
    try {
      const { data } = await api.get("/cluster/nodes");
      setNodes(data);
    } catch {
      setNodes(null);
    }
    try {
      const { data } = await api.get("/cluster/promote-eligibility");
      setEligibility(data);
    } catch {
      setEligibility(null);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, []);

  const cluster = nodes?.cluster;
  const devices = nodes?.devices || [];
  const canPromote = canWrite && (can("settings", "manage") || hasFullAccessRole(user?.role));

  return (
    <SettingsTabFrame>
      <SettingsSplit>
        <SettingsSection
          title="Shop Network"
          description="One active host writes; other PCs hold full replicas and sync over LAN."
          actions={(
            <button type="button" onClick={refresh} className="flex items-center gap-2 text-[13px] px-3 py-2 border border-[#E5E7EB]">
              <RefreshCw size={14} /> Refresh
            </button>
          )}
        >
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between py-2 border-b border-[#F0F0F0]">
              <span className="text-[#737373]">This PC role</span>
              <span className="font-medium">{cluster?.fenced ? "Fenced" : (cluster?.role === "active_host" ? "Host ★" : "Full replica")}</span>
            </div>
            {showDiag && (
              <>
                <div className="flex justify-between py-2 border-b border-[#F0F0F0]"><span className="text-[#737373]">Shop ID</span><span className="font-mono text-[11px]">{cluster?.shop_id || "—"}</span></div>
                <div className="flex justify-between py-2 border-b border-[#F0F0F0]"><span className="text-[#737373]">Host term</span><span>{cluster?.host_term ?? "—"}</span></div>
                <div className="flex justify-between py-2 border-b border-[#F0F0F0]"><span className="text-[#737373]">Event watermark</span><span>{cluster?.event_watermark ?? 0}</span></div>
              </>
            )}
            <button type="button" className="text-[12px] text-[#737373] underline" onClick={() => setShowDiag((v) => !v)}>
              {showDiag ? "Hide diagnostics" : "Diagnostics"}
            </button>
          </div>

          {eligibility && cluster?.role !== "active_host" && (
            <div className={`mt-4 border px-4 py-3 text-[13px] rounded-md ${eligibility.recommended ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="font-medium">{eligibility.recommended ? "✓ Eligible to become host" : "Not recommended yet"}</div>
              <div className="text-[#525252] mt-1">
                Synced to #{eligibility.watermark}{eligibility.lag > 0 ? ` (${eligibility.lag} behind)` : ""} · Integrity {eligibility.integrity}
              </div>
            </div>
          )}

          {canPromote && cluster?.role !== "active_host" && !cluster?.fenced && (
            <div className="mt-4 border border-amber-200 bg-amber-50 px-4 py-4 space-y-3 rounded-md">
              <h4 className="text-[14px] font-semibold text-[#0A0A0A]">Make this PC the Host</h4>
              <p className="text-[13px] text-[#525252]">
                Only promote if the previous host is shut down or disconnected from the LAN.
              </p>
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" checked={confirm.isolate} onChange={(e) => setConfirm((c) => ({ ...c, isolate: e.target.checked }))} className="mt-1" />
                I have shut down or isolated the previous host.
              </label>
              <label className="flex items-start gap-2 text-[13px]">
                <input type="checkbox" checked={confirm.dual} onChange={(e) => setConfirm((c) => ({ ...c, dual: e.target.checked }))} className="mt-1" />
                I understand dual-active risk and confirm this promote.
              </label>
              <button
                type="button"
                disabled={busy || !confirm.dual || !confirm.isolate || (eligibility && !eligibility.eligible)}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api.post("/cluster/promote", {
                      confirm_dual_active_risk: true,
                      confirm_isolate_old_host: true,
                    });
                    toast.success("This PC is now the shop host");
                    setConfirm({ dual: false, isolate: false });
                    refresh();
                  } catch (e) {
                    toast.error(formatApiError(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-3 py-2 text-[13px] bg-[#0A0A0A] text-white disabled:opacity-40"
              >
                {busy ? "Promoting…" : "Make this PC Host"}
              </button>
            </div>
          )}

          {cluster?.role === "active_host" && (
            <p className="text-[13px] text-[#737373] mt-4">
              This PC is the active host (term {cluster.host_term}). Cashiers on other PCs send sales here over LAN.
            </p>
          )}
        </SettingsSection>

        <SettingsSection title="PCs in this shop" description="Host and replica devices registered for LAN sync.">
          {devices.length === 0 ? (
            <div className="py-6 text-[13px] text-[#737373]">No devices registered yet.</div>
          ) : (
            <div className="divide-y divide-[#F0F0F0]">
              {devices.map((d) => {
                const online = d.status === "active";
                const isHost = d.is_host;
                return (
                  <div key={d.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-[13px] font-medium text-[#0A0A0A]">
                        {d.device_name}{d.is_self ? " (this PC)" : ""}{isHost ? " ★ HOST" : ""}
                      </div>
                      <div className="text-[12px] text-[#737373] font-mono">{d.device_identifier}</div>
                      <div className="text-[12px] text-[#737373]">
                        Last sync: {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-[12px]">
                      {online ? <Wifi size={14} className="text-emerald-600" /> : <WifiOff size={14} className="text-[#A3A3A3]" />}
                      <span className={online ? "text-emerald-700" : "text-[#737373]"}>
                        {online ? "Online" : (d.status || "Offline")}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SettingsSection>
      </SettingsSplit>
    </SettingsTabFrame>
  );
}

// ─── System Health Tab ────────────────────────────────────────────────────────
function SystemHealthTab() {
  const [health, setHealth] = useState(null);
  const [sync, setSync] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [diag, setDiag] = useState(null);
  const [eod, setEod] = useState(null);
  const [busy, setBusy] = useState(null);
  const [openAtLogin, setOpenAtLogin] = useState(false);

  useEffect(() => {
    if (!window.jewelleryCRM?.getLoginItem) return;
    window.jewelleryCRM.getLoginItem().then((s) => setOpenAtLogin(Boolean(s?.openAtLogin))).catch(() => {});
  }, []);

  const toggleStartup = async () => {
    if (!window.jewelleryCRM?.setLoginItem) return;
    const next = !openAtLogin;
    await window.jewelleryCRM.setLoginItem({ openAtLogin: next });
    setOpenAtLogin(next);
  };

  const refresh = async () => {
    try {
      const base = getBackendUrl();
      const h = await fetch(`${base}/api/health`).then((r) => r.json());
      setHealth(h);
    } catch {
      setHealth({ ready: false, status: "error" });
    }
    try {
      const { data } = await api.get("/sync/status");
      setSync(data);
    } catch {
      setSync(null);
    }
    try {
      const { data } = await api.get("/recovery/status");
      setRecovery(data);
    } catch {
      setRecovery(null);
    }
    try {
      const { data } = await api.get("/system/diagnostics");
      setDiag(data);
    } catch {
      setDiag(null);
    }
    try {
      const { data } = await api.get("/system/eod");
      setEod(data);
    } catch {
      setEod(null);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, []);

  const row = (label, value, ok = true) => (
    <div className="flex items-center justify-between py-3 border-b border-[#F0F0F0]">
      <span className="text-[13px] text-[#737373]">{label}</span>
      <span className={`text-[13px] font-medium ${ok ? "text-[#0A0A0A]" : "text-red-700"}`}>{value}</span>
    </div>
  );

  return (
    <SettingsTabFrame>
      <SettingsSection
        title="System Health"
        description="Branch host, database, sync, backup and recovery."
        actions={(
          <button
            type="button"
            onClick={refresh}
            className="flex items-center gap-2 text-[13px] px-3 py-2 border border-[#E5E7EB] hover:bg-[#FAFAFA]"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        )}
      >

      {window.jewelleryCRM?.setLoginItem && (
        <div className="flex items-center justify-between py-3 px-4 border border-[#E5E7EB] mb-4 rounded">
          <div>
            <p className="text-[13px] font-medium text-[#0A0A0A]">Start with Windows</p>
            <p className="text-[11.5px] text-[#737373]">Launch automatically when this PC turns on — recommended for the owner PC</p>
          </div>
          <button
            type="button"
            onClick={toggleStartup}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${openAtLogin ? "bg-emerald-500" : "bg-[#D1D5DB]"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${openAtLogin ? "translate-x-6" : "translate-x-1"}`} />
          </button>
        </div>
      )}

      <div className="border border-[#E5E7EB] px-4">
        {row("Local Database", health?.database?.status === "ok" ? "Healthy" : "Unavailable", health?.database?.status === "ok")}
        {row("Branch Mode", health?.app_mode || "—")}
        {row("Schema", String(health?.schema_version ?? diag?.schema_version ?? "—"))}
        {row("Device", diag?.device_name || health?.device_name || "—")}
        {row("Role", diag?.role || health?.role || "—")}
        {row(
          "Cloud",
          sync?.cloud_endpoint_configured
            ? (sync?.online ? "Online" : "Offline / paused")
            : "Not configured",
          !sync?.cloud_endpoint_configured || sync?.online
        )}
        {row("Pending Sync", String(sync?.pending ?? 0), (sync?.pending ?? 0) === 0)}
        {row("Failed Sync", String(sync?.failed ?? 0), (sync?.failed ?? 0) === 0)}
        {row(
          "Last Sync",
          sync?.last_sync_at ? new Date(sync.last_sync_at).toLocaleString() : "—"
        )}
        {row("Host Term", String(health?.cluster?.host_term ?? health?.authority?.host_term ?? "—"))}
        {row("Cluster Role", health?.cluster?.role || health?.authority?.role || "—")}
        {row(
          "Authoritative",
          health?.authority?.authoritative ? "Yes" : `No (${health?.authority?.code || "—"})`,
          Boolean(health?.authority?.authoritative)
        )}
        {row(
          "Recovery Snapshot",
          recovery?.snapshot?.created_at
            ? new Date(recovery.snapshot.created_at).toLocaleString()
            : "None yet"
        )}
        {row(
          "Today Invoices",
          eod?.invoices ? `${eod.invoices.invoice_count} / ${fmtINR(eod.invoices.sales_total || 0)}` : "—"
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy("backup");
            try {
              await api.post("/system/backup");
              toast.success("Local backup created");
              refresh();
            } catch (e) {
              toast.error(formatApiError(e));
            } finally {
              setBusy(null);
            }
          }}
          className="px-3 py-2 text-[13px] bg-[#0A0A0A] text-white disabled:opacity-50"
        >
          {busy === "backup" ? "Backing up…" : "Run Backup Now"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy("sync");
            try {
              await api.post("/sync/retry");
              toast.success("Sync retry queued");
              refresh();
            } catch (e) {
              toast.error(formatApiError(e));
            } finally {
              setBusy(null);
            }
          }}
          className="px-3 py-2 text-[13px] border border-[#E5E7EB]"
        >
          Retry Failed Sync
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy("snap");
            try {
              await api.post("/recovery/snapshot");
              toast.success("Recovery snapshot written");
              refresh();
            } catch (e) {
              toast.error(formatApiError(e));
            } finally {
              setBusy(null);
            }
          }}
          className="px-3 py-2 text-[13px] border border-[#E5E7EB]"
        >
          Write Recovery Snapshot
        </button>
      </div>
      </SettingsSection>
    </SettingsTabFrame>
  );
}

// ─── Import CSV Tab ───────────────────────────────────────────────────────────
const IMPORT_KINDS = [
  { id: "customers", label: "Customers", match: "Mobile" },
  { id: "products", label: "Products", match: "Barcode / Code" },
  { id: "vendors", label: "Vendors", match: "Mobile or Name" },
  { id: "employees", label: "Employees", match: "Mobile" },
  { id: "quotations", label: "Quotations", match: "Quote No" },
  { id: "expenses", label: "Expenses", match: "always create new" },
];

function ImportCsvTab({ canWrite = false }) {
  const [kind, setKind] = useState("customers");
  const [updateExisting, setUpdateExisting] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [productImportProgress, setProductImportProgress] = useState(null);
  const fileRef = useRef(null);
  const kindMeta = IMPORT_KINDS.find((k) => k.id === kind) || IMPORT_KINDS[0];

  const downloadTemplate = async () => {
    try {
      const token = localStorage.getItem("ssj_token");
      const resp = await fetch(`${getBackendUrl()}/api/backup/templates/${kind}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error("Template download failed");
      const blob = await resp.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${kind}_import_template.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Template downloaded");
    } catch (e) {
      toast.error(formatApiError(e) || "Could not download template");
    }
  };

  const onFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setResult(null);
    try {
      const csv = await file.text();
      if (kind === "products") {
        setProductImportProgress(emptyImportProgress());
        const data = await importProductsFromCsv({
          csvText: csv,
          fileName: file.name,
          updateExisting,
          onProgress: setProductImportProgress,
        });
        setResult(data);
        const summary = formatImportSummary(data);
        if (data.errors.length) toast.error(`${summary}. ${data.errors.length} error(s).`);
        else toast.success(`Import complete — ${summary}.`);
      } else {
        const { data } = await api.post(`/backup/import/${kind}`, {
          csv,
          update_existing: updateExisting,
        }, { timeout: 300000 });
        setResult(data);
        toast.success(
          `Import done — created ${data.created}, updated ${data.updated}, skipped ${data.skipped}`
        );
      }
    } catch (e) {
      setProductImportProgress(null);
      toast.error(formatApiError(e) || "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <SettingsTabFrame>
      <SettingsSplit>
        <SettingsSection
          title="Import CSV"
          description="Load master data and quotations from Excel/CSV. Reports are calculated from invoices after data is imported — finalized invoices are not CSV-imported."
        >
          <div className="flex flex-wrap gap-2 mb-4">
            {IMPORT_KINDS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { setKind(t.id); setResult(null); }}
                className={`px-3 py-2 text-[13px] border ${
                  kind === t.id ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "border-[#E5E7EB] text-[#0A0A0A]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="space-y-4">
            <p className="text-[12px] text-[#737373]">Match key: {kindMeta.match}</p>
            <button
              type="button"
              onClick={downloadTemplate}
              className="px-3 py-2 text-[13px] border border-[#E5E7EB] hover:bg-[#FAFAFA]"
            >
              Download {kindMeta.label} template
            </button>
            {kind !== "expenses" && (
              <label className="flex items-start gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  className="mt-1"
                />
                Update existing rows when match key already exists
              </label>
            )}
            <div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                disabled={busy || !canWrite}
                onChange={(e) => onFile(e.target.files?.[0])}
                className="block w-full text-[13px] text-[#737373] file:mr-3 file:py-2 file:px-3 file:border file:border-[#E5E7EB] file:bg-white file:text-[13px]"
              />
              {busy && <p className="text-[12px] text-[#737373] mt-2">Importing…</p>}
              {!canWrite && (
                <p className="text-[12px] text-amber-800 mt-2">Import requires backup.export permission.</p>
              )}
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title="Results & tips" description="Last import summary and guidance.">
          {result ? (
            <div className="text-[13px] space-y-1 mb-4">
              <div>Created: <span className="font-medium">{result.created}</span></div>
              <div>Updated: <span className="font-medium">{result.updated}</span></div>
              <div>Skipped: <span className="font-medium">{result.skipped}</span></div>
              <div>Total rows: <span className="font-medium">{result.total_rows}</span></div>
              {(result.errors || []).length > 0 && (
                <div className="mt-2 text-[#B45309]">
                  <div className="font-medium">Row issues (first {result.errors.length}):</div>
                  <ul className="list-disc ml-4 mt-1 text-[12px]">
                    {result.errors.map((e, i) => (
                      <li key={i}>Line {e.row}: {e.detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-[#737373] mb-4">No import run yet.</p>
          )}
          <div className="text-[12px] text-[#737373] space-y-1">
            <p className="font-medium text-[#525252]">Tips</p>
            <ul className="list-disc ml-4 space-y-1">
              <li>Save Excel as CSV UTF-8; keep template headers unchanged.</li>
              <li>Quotations import header totals (line items stay empty — refine in Quotation screen if needed).</li>
              <li>Reports (sales, GST, stock) appear automatically once invoices/products exist.</li>
            </ul>
          </div>
        </SettingsSection>
      </SettingsSplit>
      <ImportProgressModal
        open={Boolean(productImportProgress)}
        title="Importing products"
        progress={productImportProgress}
        onClose={() => setProductImportProgress(null)}
      />
    </SettingsTabFrame>
  );
}

function HiddenBillSettingsTab({ canWrite = false }) {
  const [configured, setConfigured] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/settings/hidden-bill")
      .then(({ data }) => setConfigured(Boolean(data?.configured)))
      .catch(() => setConfigured(false))
      .finally(() => setLoading(false));
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!canWrite) return;
    if (configured && !/^\d{4,8}$/.test(currentPassword)) {
      return toast.error("Enter the current password");
    }
    if (!/^\d{4,8}$/.test(password)) {
      return toast.error("Password must be 4–8 digits");
    }
    if (password !== confirm) {
      return toast.error("Passwords do not match");
    }
    setSaving(true);
    try {
      await api.put("/settings/hidden-bill", {
        password,
        ...(configured ? { current_password: currentPassword } : {}),
      });
      setConfigured(true);
      setCurrentPassword("");
      setPassword("");
      setConfirm("");
      toast.success(configured ? "The password has been updated" : "Hidden bill password saved");
    } catch (err) {
      toast.error(formatApiError(err) || "Failed — current password does not match");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageLoadingBadge />;

  return (
    <SettingsTabFrame>
      <SettingsSection
        title="Hidden bill password"
        description="Used when staff tap the shop name 3 times on POS. Digits only (4–8). Owner-only setting."
      >
        <p className="text-[12px] mb-3">
          Status:{" "}
          <strong className={configured ? "text-green-700" : "text-amber-700"}>
            {configured ? "Configured" : "Not set yet"}
          </strong>
        </p>
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {configured && (
            <div className="md:col-span-2">
              <label className="text-[11px] text-[#737373]">Current password</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                className="input mt-1 max-w-xs"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value.replace(/\D/g, "").slice(0, 8))}
                disabled={!canWrite}
                placeholder="Enter current password"
                autoComplete="current-password"
              />
            </div>
          )}
          <div>
            <label className="text-[11px] text-[#737373]">{configured ? "New password" : "Password"}</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input mt-1"
              value={password}
              onChange={(e) => setPassword(e.target.value.replace(/\D/g, "").slice(0, 8))}
              disabled={!canWrite}
              placeholder="••••"
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="text-[11px] text-[#737373]">Confirm {configured ? "new password" : ""}</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input mt-1"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, "").slice(0, 8))}
              disabled={!canWrite}
              placeholder="••••"
              autoComplete="new-password"
            />
          </div>
          <div className="md:col-span-2">
            <button type="submit" className="btn-primary text-sm" disabled={!canWrite || saving}>
              {saving ? "Saving…" : configured ? "Update password" : "Set password"}
            </button>
          </div>
        </form>
      </SettingsSection>
    </SettingsTabFrame>
  );
}

function BillingTab({ canWrite = false }) {
  const [form, setForm] = useState({ gst_pct: 3, payment_modes: "cash,upi,card,bank_transfer,cheque,old_gold_exchange,old_silver_exchange" });
  const [offlinePricingMode, setOfflinePricingMode] = useState("preserve");
  const [letterhead, setLetterhead] = useState({
    hasImage: false,
    on_print: false,
    on_download: false,
  });
  const [whatsappPdfFolder, setWhatsappPdfFolder] = useState("");
  const [invoicePdfFolder, setInvoicePdfFolder] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/settings/invoice").then(({ data }) => {
      setForm({
        gst_pct: data?.gst_pct ?? 3,
        payment_modes: Array.isArray(data?.payment_modes)
          ? data.payment_modes.join(",")
          : "cash,upi,card,bank_transfer,cheque,old_gold_exchange,old_silver_exchange",
        default_wastage_pct: data?.default_wastage_pct ?? 0,
        default_making_charge_type: data?.default_making_charge_type || "fixed",
        max_discount_pct_without_override: data?.max_discount_pct_without_override ?? 10,
        manager_override_pin: data?.manager_override_pin ?? "",
        show_transaction_time: data?.show_transaction_time !== false,
      });
      setWhatsappPdfFolder(String(data?.whatsapp_pdf_folder || ""));
      setInvoicePdfFolder(String(data?.invoice_pdf_folder || ""));
    }).catch(() => {});
    api.get("/settings").then(({ data }) => {
      const offline = Array.isArray(data) ? data.find((s) => s.key === "offline") : null;
      if (offline?.value?.pricing_mode) setOfflinePricingMode(offline.value.pricing_mode);
    }).catch(() => {});
    api.get("/settings/company").then(({ data }) => {
      const image = typeof data?.invoice_letterhead_image === "string" ? data.invoice_letterhead_image.trim() : "";
      const legacy = Boolean(data?.invoice_letterhead_enabled);
      setLetterhead({
        hasImage: Boolean(image),
        on_print: data?.invoice_letterhead_on_print != null ? Boolean(data.invoice_letterhead_on_print) : legacy,
        on_download: data?.invoice_letterhead_on_download != null ? Boolean(data.invoice_letterhead_on_download) : legacy,
      });
    }).catch(() => {});
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/settings/invoice", {
        gst_pct: Number(form.gst_pct),
        payment_modes: form.payment_modes,
        default_wastage_pct: Number(form.default_wastage_pct) || 0,
        default_making_charge_type: form.default_making_charge_type || "fixed",
        max_discount_pct_without_override: Number(form.max_discount_pct_without_override) || 10,
        manager_override_pin: form.manager_override_pin || null,
        show_transaction_time: form.show_transaction_time !== false,
        whatsapp_pdf_folder: whatsappPdfFolder,
        invoice_pdf_folder: invoicePdfFolder,
      });
      await api.put("/settings/offline", { pricing_mode: offlinePricingMode });
      await api.put("/settings/company", {
        invoice_letterhead_on_print: Boolean(letterhead.on_print),
        invoice_letterhead_on_download: Boolean(letterhead.on_download),
      });
      notifyCompanyUpdated();
      notifyDisplayPrefsChanged();
      toast.success("Billing settings saved");
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsTabFrame>
      <SettingsSection title="Invoice & tax" description="GST, payment modes, wastage and discount overrides.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-[12px] text-[#525252]">
            Default GST %
            <input
              className="input mt-1"
              type="text" inputMode="decimal"
              step="0.1"
              value={form.gst_pct}
              onChange={(e) => setForm({ ...form, gst_pct: e.target.value })}
            />
          </label>
          <label className="block text-[12px] text-[#525252] sm:col-span-2">
            Payment modes (comma-separated)
            <input
              className="input mt-1"
              value={form.payment_modes}
              onChange={(e) => setForm({ ...form, payment_modes: e.target.value })}
            />
          </label>
          <label className="block text-[12px] text-[#525252]">
            Default wastage %
            <input
              className="input mt-1"
              type="text" inputMode="decimal"
              step="0.1"
              value={form.default_wastage_pct ?? 0}
              onChange={(e) => setForm({ ...form, default_wastage_pct: e.target.value })}
            />
          </label>
          <label className="block text-[12px] text-[#525252]">
            Default making charge type
            <select
              className="input mt-1"
              value={form.default_making_charge_type || "fixed"}
              onChange={(e) => setForm({ ...form, default_making_charge_type: e.target.value })}
            >
              <option value="fixed">Fixed</option>
              <option value="per_gram">Per gram</option>
              <option value="percentage">Percentage</option>
            </select>
          </label>
          <label className="block text-[12px] text-[#525252]">
            Max discount % without manager PIN
            <input
              className="input mt-1"
              type="text" inputMode="decimal"
              value={form.max_discount_pct_without_override ?? 10}
              onChange={(e) => setForm({ ...form, max_discount_pct_without_override: e.target.value })}
            />
          </label>
          <label className="block text-[12px] text-[#525252]">
            Manager override PIN
            <input
              className="input mt-1"
              type="password"
              autoComplete="new-password"
              value={form.manager_override_pin ?? ""}
              onChange={(e) => setForm({ ...form, manager_override_pin: e.target.value })}
              placeholder="Set PIN for discount overrides"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EADFBF] bg-[#FDFBF7] p-3">
          <div>
            <div className="text-[13px] font-medium text-[#0A0A0A]">Show Transaction Time</div>
            <p className="mt-0.5 text-[12px] text-[#737373]">
              On: every date shown in Accounts, Reports, and Statements also shows the time of day.
              Off: only the date is shown everywhere — no times.
            </p>
          </div>
          <Switch
            checked={form.show_transaction_time !== false}
            onCheckedChange={(v) => setForm({ ...form, show_transaction_time: v })}
            disabled={!canWrite}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Invoice letterhead"
        description="Uses the A5 image from Settings → Company. On-screen POS bills stay without a background."
      >
        {!letterhead.hasImage ? (
          <p className="text-[13px] text-[#737373]">
            Upload a letterhead image in Settings → Company first. These toggles stay off until an image is saved.
          </p>
        ) : null}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EADFBF] bg-[#FDFBF7] p-3">
            <div>
              <div className="text-[13px] font-medium text-[#0A0A0A]">Letterhead on Print</div>
              <p className="mt-0.5 text-[12px] text-[#737373]">
                On: printer and print preview use the uploaded letterhead as the page background.
                Off: paper bills stay plain.
              </p>
            </div>
            <Switch
              checked={Boolean(letterhead.on_print)}
              onCheckedChange={(v) => {
                if (v && !letterhead.hasImage) {
                  toast.error("Upload a letterhead in Company first");
                  return;
                }
                setLetterhead((s) => ({ ...s, on_print: v }));
              }}
              disabled={!canWrite || !letterhead.hasImage}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EADFBF] bg-[#FDFBF7] p-3">
            <div>
              <div className="text-[13px] font-medium text-[#0A0A0A]">Letterhead on Download</div>
              <p className="mt-0.5 text-[12px] text-[#737373]">
                On: downloaded POS PDFs show the letterhead behind the bill.
                Off: downloaded files stay plain.
              </p>
            </div>
            <Switch
              checked={Boolean(letterhead.on_download)}
              onCheckedChange={(v) => {
                if (v && !letterhead.hasImage) {
                  toast.error("Upload a letterhead in Company first");
                  return;
                }
                setLetterhead((s) => ({ ...s, on_download: v }));
              }}
              disabled={!canWrite || !letterhead.hasImage}
            />
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="POS invoice download folder"
        description="When you tap Download on a POS bill, the PDF is saved here automatically. Leave blank to pick a location each time."
      >
        <label className="block text-[12px] text-[#525252]">
          Folder path
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              className="input flex-1 min-w-[220px] font-mono text-[12.5px]"
              value={invoicePdfFolder}
              onChange={(e) => setInvoicePdfFolder(e.target.value)}
              placeholder="D:\Bills\Invoices"
              disabled={!canWrite}
            />
            {typeof window !== "undefined" && window.jewelleryCRM?.pickFolder ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={!canWrite}
                onClick={async () => {
                  try {
                    const picked = await window.jewelleryCRM.pickFolder({
                      title: "Choose folder for POS invoice PDFs",
                      buttonLabel: "Use this folder",
                    });
                    if (!picked?.canceled && picked.path) setInvoicePdfFolder(picked.path);
                  } catch (err) {
                    toast.error(err?.message || "Could not pick folder");
                  }
                }}
              >
                Browse
              </button>
            ) : null}
          </div>
        </label>
      </SettingsSection>

      <SettingsSection
        title="WhatsApp invoice PDF folder"
        description="When you tap WhatsApp on a POS bill, the PDF is saved here automatically, then the customer's chat opens. Leave blank to use the Windows Downloads folder."
      >
        <label className="block text-[12px] text-[#525252]">
          Folder path
          <div className="mt-1 flex flex-wrap gap-2">
            <input
              className="input flex-1 min-w-[220px] font-mono text-[12.5px]"
              value={whatsappPdfFolder}
              onChange={(e) => setWhatsappPdfFolder(e.target.value)}
              placeholder="D:\Bills\WhatsApp"
              disabled={!canWrite}
            />
            {typeof window !== "undefined" && window.jewelleryCRM?.pickFolder ? (
              <button
                type="button"
                className="btn-secondary"
                disabled={!canWrite}
                onClick={async () => {
                  try {
                    const picked = await window.jewelleryCRM.pickFolder({
                      title: "Choose folder for WhatsApp invoice PDFs",
                      buttonLabel: "Use this folder",
                    });
                    if (!picked?.canceled && picked.path) setWhatsappPdfFolder(picked.path);
                  } catch (err) {
                    toast.error(err?.message || "Could not pick folder");
                  }
                }}
              >
                Browse
              </button>
            ) : null}
          </div>
        </label>
      </SettingsSection>

      <SettingsSection
        title="Offline pricing"
        description="When the host is offline, sales are saved as Pending Sales. Choose how prices are resolved at sync time."
        actions={(
          <button type="button" className="btn-primary" disabled={saving || !canWrite} onClick={save}>
            {saving ? "Saving…" : "Save billing settings"}
          </button>
        )}
      >
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          <label className="flex items-start gap-3 cursor-pointer border border-[#E5E7EB] rounded-lg p-3">
            <input
              type="radio"
              name="offline_pricing_mode"
              value="preserve"
              checked={offlinePricingMode === "preserve"}
              onChange={() => setOfflinePricingMode("preserve")}
              className="mt-0.5"
            />
            <div>
              <div className="text-[13px] font-medium text-[#0A0A0A]">Preserve original quoted price</div>
              <div className="text-[12px] text-[#737373]">Use the gold rate that was shown at the time of the draft (recommended)</div>
            </div>
          </label>
          <label className="flex items-start gap-3 cursor-pointer border border-[#E5E7EB] rounded-lg p-3">
            <input
              type="radio"
              name="offline_pricing_mode"
              value="recalculate"
              checked={offlinePricingMode === "recalculate"}
              onChange={() => setOfflinePricingMode("recalculate")}
              className="mt-0.5"
            />
            <div>
              <div className="text-[13px] font-medium text-[#0A0A0A]">Recalculate using latest rate at sync</div>
              <div className="text-[12px] text-[#737373]">Invoice uses the gold rate active when the host comes back online</div>
            </div>
          </label>
        </div>
      </SettingsSection>
    </SettingsTabFrame>
  );
}

function AuditTab() {
  const [events, setEvents] = useState([]);
  const [verify, setVerify] = useState(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    try {
      const [{ data: list }, { data: v }] = await Promise.all([
        api.get("/cluster/audit/events", { params: { limit: 100 } }),
        api.get("/cluster/audit/verify").catch(() => ({ data: null })),
      ]);
      setEvents(list?.data || []);
      setVerify(v);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  return (
    <SettingsTabFrame>
      <SettingsSection
        title="Audit trail"
        description={verify?.ok === true ? `Chain OK (${verify.checked} events)` : verify?.ok === false ? `Broken at seq ${verify.broken_at}` : "Verify pending"}
        actions={(
          <button type="button" className="btn-secondary" onClick={refresh}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      >
      {loading && !events.length ? (
        <PageLoadingBadge />
      ) : (
        <div className="table-shell">
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Seq</th>
                <th className="table-th">Action</th>
                <th className="table-th">Entity</th>
                <th className="table-th">When</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td className="table-td text-[#737373]" colSpan={4}>No audit events yet.</td></tr>
              ) : events.map((ev) => (
                <tr key={ev.id} className="table-row">
                  <td className="table-td font-mono text-[12px]">{ev.seq}</td>
                  <td className="table-td">{ev.action || ev.event_type}</td>
                  <td className="table-td font-mono text-[12px]">{ev.entity_type ? `${ev.entity_type}:${ev.entity_id || ""}` : "—"}</td>
                  <td className="table-td text-[#737373] text-[12px]">{fmtDate(ev.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </SettingsSection>
    </SettingsTabFrame>
  );
}

function companyLooksSaved(form) {
  if (!form) return false;
  if (form.profile_locked) return true;
  return Boolean(String(form.name || "").trim());
}

function OwnerCredentialsCard({ canWrite = false, unlocked = false, onLocked }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [currentUsername, setCurrentUsername] = useState(undefined); // undefined = loading, null = none yet

  useEffect(() => {
    api.get("/users")
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : [];
        const owner = list.find((u) => (u.role === "shop_owner" || u.role === "owner"));
        setCurrentUsername(owner?.email || null);
      })
      .catch(() => setCurrentUsername(null));
  }, []);

  const frozen = !unlocked;
  const fieldsDisabled = !canWrite || frozen;

  const save = async () => {
    if (frozen) return;
    if (!username.trim()) {
      toast.error("Username is required");
      return;
    }
    if (!password || password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const { data } = await api.put("/settings/owner-credentials", {
        username: username.trim(),
        password,
        confirm_password: confirmPassword,
      });
      toast.success("Login credentials updated — locked again");
      setCurrentUsername(data?.username || username.trim().toLowerCase());
      setUsername("");
      setPassword("");
      setConfirmPassword("");
      onLocked?.();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Update Password"
      description="Create or reset the owner's login username and password. The permanent administrator login is separate and unaffected by this."
      actions={!frozen ? (
        <button onClick={save} disabled={busy || !canWrite} className="btn-primary">
          <Save size={14} strokeWidth={1.5} /> {busy ? "Saving…" : "Save credentials"}
        </button>
      ) : (
        <span className="text-[12px] font-medium text-[#B49042]">Locked</span>
      )}
    >
      <div className="mb-4 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2 text-[12.5px] text-[#525252]">
        <span className="font-medium text-[#0A0A0A]">Current login username:</span>{" "}
        {currentUsername === undefined ? "Loading…" : currentUsername ? (
          <span className="font-mono">{currentUsername}</span>
        ) : (
          <span className="text-[#a3a3a3]">not created yet</span>
        )}
      </div>
      {unlocked && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Unlocked for editing. After you save, this section will lock again.
        </div>
      )}
      {frozen && (
        <p className="text-[12.5px] text-[#737373] mb-4">
          Click the Company tab 5 times quickly and enter the secret password to unlock.
        </p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <F label="New Username">
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="e.g. ABC Jewellery"
            disabled={fieldsDisabled}
            autoComplete="off"
          />
        </F>
        <F label="New Password">
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            disabled={fieldsDisabled}
            autoComplete="new-password"
          />
        </F>
        <F label="Confirm Password">
          <input
            type="password"
            className="input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={fieldsDisabled}
            autoComplete="new-password"
          />
        </F>
      </div>
    </SettingsSection>
  );
}

const METAL_SOURCE_FIELDS = [
  { key: "all_in_one", label: "All in One" },
  { key: "gold", label: "Gold" },
  { key: "silver", label: "Silver" },
  { key: "platinum", label: "Platinum" },
];

const METAL_PREVIEW_FIELDS = [
  { key: "gold_24k", label: "24K Gold" },
  { key: "gold_22k", label: "22K Gold" },
  { key: "gold_18k", label: "18K Gold" },
  { key: "silver", label: "Silver" },
  { key: "pure_silver", label: "Pure Silver" },
  { key: "platinum", label: "Platinum" },
];

/** Which website(s) the ERP fetches live gold/silver/platinum rates from — feeds the
 *  central source resolver (individual metal URL overrides "All in One"). The rates
 *  themselves are still viewed/edited on Settings → Gold Rate, unchanged. */
function MetalPriceSourcesSection({ sources, setSource, disabled, canWrite }) {
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState(null);
  const [testError, setTestError] = useState("");

  const runTest = async () => {
    setTesting(true);
    setTestError("");
    setResults(null);
    try {
      const payload = {
        all_in_one: sources.all_in_one || "",
        gold: sources.gold || "",
        silver: sources.silver || "",
        platinum: sources.platinum || "",
      };
      const { data } = await api.post("/settings/company/metal-sources/test", payload, { timeout: 30_000 });
      setResults(data.results || []);
    } catch (err) {
      setTestError(formatApiError(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <SettingsSection
      title="Metal Price Sources"
      description='Where the ERP fetches live gold, silver, and platinum rates from. An individual metal URL overrides "All in One" for that metal — leave it blank to fall back to All in One.'
      actions={
        <button type="button" onClick={runTest} disabled={testing || !canWrite} className="btn-secondary">
          <RefreshCw size={14} strokeWidth={1.5} className={testing ? "animate-spin" : ""} /> {testing ? "Testing…" : "Test Sources"}
        </button>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {METAL_SOURCE_FIELDS.map(({ key, label }) => (
          <F key={key} label={label}>
            <input
              className="input font-mono"
              placeholder="https://example.com/rates"
              value={sources[key] || ""}
              onChange={(e) => setSource(key, e.target.value)}
              disabled={disabled}
              autoComplete="off"
            />
          </F>
        ))}
      </div>

      {testError && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
          <AlertTriangle size={14} strokeWidth={1.5} /> {testError}
        </div>
      )}

      {results && (
        <div className="mt-4 space-y-3">
          {results.length === 0 && (
            <p className="text-[12.5px] text-[#737373]">No sources to test — enter a URL above first.</p>
          )}
          {results.map((r) => (
            <div key={r.slot} className="rounded-md border border-[#E5E7EB] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-[#0A0A0A]">
                  {METAL_SOURCE_FIELDS.find((f) => f.key === r.slot)?.label || r.slot}
                </div>
                {r.reachable ? (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <CheckCircle2 size={13} strokeWidth={1.5} /> Website reachable
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-red-600">
                    <XCircle size={13} strokeWidth={1.5} /> {r.error || "Unreachable"}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {r.metals.map((m) => (
                  <span
                    key={m.metal}
                    className={`flex items-center gap-1 text-[12px] ${m.ok ? "text-emerald-600" : "text-red-600"}`}
                  >
                    {m.ok ? <CheckCircle2 size={13} strokeWidth={1.5} /> : <XCircle size={13} strokeWidth={1.5} />}
                    {m.metal[0].toUpperCase() + m.metal.slice(1)} rate {m.ok ? "detected" : `not detected${m.detail ? ` — ${m.detail}` : ""}`}
                  </span>
                ))}
              </div>
              {r.preview && (
                <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 border-t border-[#F3F4F6] pt-2 font-mono text-[12px] text-[#525252]">
                  {METAL_PREVIEW_FIELDS.filter(({ key }) => r.preview[key] != null).map(({ key, label }) => (
                    <div key={key}>{label}: {fmtINR(r.preview[key])}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function CompanyTab({ canWrite = false, unlocked = false, onLocked }) {
  const { refresh: refreshAuth } = useAuth();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get("/settings/company"),
      api.get("/settings/login-music").catch(() => ({ data: {} })),
      api.get("/settings/stock-alert-sound").catch(() => ({ data: {} })),
    ])
      .then(([companyRes, musicRes, stockSoundRes]) => setForm({
        ...(companyRes.data || {}),
        login_music: musicRes.data?.login_music || "",
        login_music_loop: Boolean(musicRes.data?.login_music_loop),
        stock_alert_sound: stockSoundRes.data?.stock_alert_sound || "",
      }))
      .catch(() => setForm({}));
  }, []);

  if (!form) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-64 shimmer rounded-md" />
    </div>
  );

  const frozen = companyLooksSaved(form) && !unlocked;
  const fieldsDisabled = !canWrite || frozen;
  const set = (k, v) => {
    if (frozen) return;
    setForm((f) => ({ ...f, [k]: v }));
  };
  const setSource = (k, v) => {
    if (frozen) return;
    setForm((f) => ({ ...f, metal_price_sources: { ...(f.metal_price_sources || {}), [k]: v } }));
  };

  const save = async () => {
    if (frozen) return;
    if (
      (form.invoice_letterhead_on_print || form.invoice_letterhead_on_download || form.invoice_letterhead_enabled)
      && !String(form.invoice_letterhead_image || "").trim()
    ) {
      toast.error("Upload a letterhead image or turn off letterhead on Print and Download in Billing");
      return;
    }
    setBusy(true);
    try {
      const [{ data }, musicRes, stockSoundRes] = await Promise.all([
        api.put("/settings/company", { ...form, profile_locked: true }, { timeout: 60_000 }),
        // Both live in their own settings row — saved alongside, not merged into `data`.
        api.put("/settings/login-music", { login_music: form.login_music || "", login_music_loop: Boolean(form.login_music_loop) }, { timeout: 60_000 }),
        api.put("/settings/stock-alert-sound", { stock_alert_sound: form.stock_alert_sound || "" }, { timeout: 60_000 }),
      ]);
      setForm({
        ...(data || { ...form, profile_locked: true }),
        login_music: musicRes?.data?.login_music || "",
        login_music_loop: Boolean(musicRes?.data?.login_music_loop),
        stock_alert_sound: stockSoundRes?.data?.stock_alert_sound || "",
      });
      invalidateStockAlertSoundCache();
      notifyCompanyUpdated();
      try { await refreshAuth?.(); } catch { /* ignore */ }
      toast.success("Company details saved — profile is now locked");
      onLocked?.();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const onLogoFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error("Logo image must be under 1MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("logo", reader.result);
    reader.readAsDataURL(file);
  };

  const onLoginMusicFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Please choose an audio file");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error("Audio file must be under 6MB — a short looping clip works best");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("login_music", reader.result);
    reader.readAsDataURL(file);
  };

  const onStockAlertSoundFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Please choose an audio file");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      toast.error("Audio file must be under 6MB — a short alert clip works best");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set("stock_alert_sound", reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <SettingsTabFrame>
      <SettingsSection
        title="Company Profile"
        description="Business name, logo, GST and invoice prefix apply across the app after save."
        actions={!frozen ? (
          <button data-enter-submit="true" onClick={save} disabled={busy || !canWrite} className="btn-primary">
            <Save size={14} strokeWidth={1.5} /> {busy ? "Saving…" : "Save details"}
          </button>
        ) : (
          <span className="text-[12px] font-medium text-[#B49042]">Locked</span>
        )}
      >
      {unlocked && !frozen && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">
          Unlocked for editing. After you save, the profile will lock again.
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <F label="Business Name"><input className="input" value={form.name || ""} onChange={(e) => set("name", e.target.value)} disabled={fieldsDisabled} /></F>
        <F label="Shop Owner Name">
          <input
            className="input"
            value={form.owner_name || ""}
            onChange={(e) => set("owner_name", e.target.value)}
            placeholder="Owner display name"
            disabled={fieldsDisabled}
          />
        </F>
        <F label="Tagline"><input className="input" value={form.tagline || ""} onChange={(e) => set("tagline", e.target.value)} disabled={fieldsDisabled} /></F>
        <div className="md:col-span-2 xl:col-span-3">
          <F label="Showroom Logo">
            <div className="flex items-center gap-4">
              {form.logo ? (
                <img src={form.logo} alt="Showroom logo" className="h-14 w-14 rounded-md object-contain border border-[#E5E7EB] bg-white" />
              ) : (
                <div className="h-14 w-14 rounded-md border border-dashed border-[#E5E7EB] flex items-center justify-center text-[10px] text-[#a3a3a3]">
                  No logo
                </div>
              )}
              {!frozen && (
                <div className="flex items-center gap-2">
                  <label className={`btn-secondary ${fieldsDisabled ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}>
                    Upload
                    <input type="file" accept="image/*" className="hidden" onChange={onLogoFile} disabled={fieldsDisabled} />
                  </label>
                  {form.logo && (
                    <button type="button" className="btn-secondary" onClick={() => set("logo", null)} disabled={fieldsDisabled}>Remove</button>
                  )}
                </div>
              )}
            </div>
          </F>
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <F label="Login Screen Music">
            <div className="flex items-center gap-4 flex-wrap">
              {form.login_music ? (
                <audio controls src={form.login_music} className="h-9 max-w-[280px]" />
              ) : (
                <span className="text-[12.5px] text-[#a3a3a3]">No music uploaded</span>
              )}
              {!frozen && (
                <div className="flex items-center gap-2">
                  <label className={`btn-secondary ${fieldsDisabled ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}>
                    Upload
                    <input type="file" accept="audio/*" className="hidden" onChange={onLoginMusicFile} disabled={fieldsDisabled} />
                  </label>
                  {form.login_music && (
                    <button type="button" className="btn-secondary" onClick={() => set("login_music", "")} disabled={fieldsDisabled}>Remove</button>
                  )}
                </div>
              )}
            </div>
            {form.login_music && (
              <label className="flex items-center gap-2 mt-2.5 text-[12.5px] text-[#0A0A0A] cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={Boolean(form.login_music_loop)}
                  onChange={(e) => set("login_music_loop", e.target.checked)}
                  disabled={fieldsDisabled}
                />
                Repeat / loop this audio continuously
              </label>
            )}
            <p className="text-[11px] text-[#a3a3a3] mt-1.5">
              Plays only on the sign-in screen (before login), with a mute button. Under 6MB — a short clip works best.
              {form.login_music && (form.login_music_loop
                ? " It will loop continuously until the user logs in."
                : " It will play once and then stop.")}
            </p>
          </F>
        </div>
        <div className="md:col-span-2 xl:col-span-3">
          <F label="Stock Alert Sound">
            <div className="flex items-center gap-4 flex-wrap">
              {form.stock_alert_sound ? (
                <audio controls src={form.stock_alert_sound} className="h-9 max-w-[280px]" />
              ) : (
                <span className="text-[12.5px] text-[#a3a3a3]">No sound uploaded</span>
              )}
              {!frozen && (
                <div className="flex items-center gap-2">
                  <label className={`btn-secondary ${fieldsDisabled ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}>
                    Upload
                    <input type="file" accept="audio/*" className="hidden" onChange={onStockAlertSoundFile} disabled={fieldsDisabled} />
                  </label>
                  {form.stock_alert_sound && (
                    <button type="button" className="btn-secondary" onClick={() => set("stock_alert_sound", "")} disabled={fieldsDisabled}>Remove</button>
                  )}
                </div>
              )}
            </div>
            <p className="text-[11px] text-[#a3a3a3] mt-1.5">
              Plays in POS and Estimation when a cashier tries to add a product beyond what's in stock
              (e.g. only 1 piece left and it's already on the bill). Same lock as the rest of this profile.
            </p>
          </F>
        </div>
        <F label="Phone"><input className="input font-mono" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} disabled={fieldsDisabled} /></F>
        <F label="Email"><input className="input" value={form.email || ""} onChange={(e) => set("email", e.target.value)} disabled={fieldsDisabled} /></F>
        <div className="md:col-span-2 xl:col-span-3">
          <F label="Address"><input className="input" value={form.address || ""} onChange={(e) => set("address", e.target.value)} disabled={fieldsDisabled} /></F>
        </div>
        <F label="GST Number"><input className="input font-mono" value={form.gst_number || ""} onChange={(e) => set("gst_number", e.target.value)} disabled={fieldsDisabled} /></F>
        <F label="Invoice Prefix"><input className="input font-mono" value={form.invoice_prefix || ""} onChange={(e) => set("invoice_prefix", e.target.value)} disabled={fieldsDisabled} /></F>
        <F label="WhatsApp Number">
          <input
            className="input font-mono"
            placeholder={DEFAULT_SHOP_WHATSAPP_NUMBER}
            value={form.whatsapp_number || ""}
            onChange={(e) => set("whatsapp_number", e.target.value)}
            disabled={fieldsDisabled}
          />
        </F>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#EADFBF] bg-[#FDFBF7] p-3">
        <div>
          <div className="text-[13px] font-medium text-[#0A0A0A]">Aadhaar Mandatory Above ₹50,000</div>
          <p className="mt-0.5 text-[12px] text-[#737373]">
            On: POS billing requires the customer's Aadhaar number before a bill over ₹50,000 can be completed.
            Off: Aadhaar stays optional at any bill amount.
          </p>
        </div>
        <Switch
          checked={form.aadhaar_mandatory_above_50000 !== false}
          onCheckedChange={(v) => set("aadhaar_mandatory_above_50000", v)}
          disabled={fieldsDisabled}
        />
      </div>
      <p className="text-[11.5px] text-[#a3a3a3] mt-3">
        After save: business name and logo appear in the sidebar; shop owner name replaces “Shop Owner”
        labels across the app and updates the owner login display name; GST and address print on invoices;
        invoice prefix is used for new bill numbers.
      </p>
      </SettingsSection>
      <MetalPriceSourcesSection
        sources={form.metal_price_sources || {}}
        setSource={setSource}
        disabled={fieldsDisabled}
        canWrite={canWrite}
      />
      <InvoiceLetterheadSection
        form={form}
        setField={set}
        disabled={fieldsDisabled}
        actions={!frozen ? (
          <button type="button" onClick={save} disabled={busy || !canWrite} className="btn-primary">
            <Save size={14} strokeWidth={1.5} /> {busy ? "Saving…" : "Save details"}
          </button>
        ) : (
          <span className="text-[12px] font-medium text-[#B49042]">Locked</span>
        )}
      />
      <OwnerCredentialsCard canWrite={canWrite} unlocked={unlocked} onLocked={onLocked} />
    </SettingsTabFrame>
  );
}

function CompanyUnlockDialog({
  busy,
  error,
  onClose,
  onSubmit,
  title = "Unlock Company Profile",
  subtitle = "Enter the password to edit frozen details",
}) {
  const [password, setPassword] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  const submit = (e) => {
    e.preventDefault();
    if (!password.trim() || busy) return;
    onSubmit(password);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
          <div>
            <div className="text-sm font-semibold text-[#0A0A0A]">{title}</div>
            <div className="text-[11px] text-[#737373]">{subtitle}</div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-[#737373]" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <input
            ref={inputRef}
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder="Password"
            autoComplete="off"
          />
          {error ? <p className="text-[12px] text-red-600">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || !password.trim()}>
              {busy ? "Checking…" : "Unlock"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const TEST_PRINT_HTML = (label) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Test Print</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; padding: 24px; }
@page { size: A4; margin: 10mm; }
h1 { font-size: 16pt; margin-bottom: 8px; }
p { font-size: 10pt; color: #444; margin-top: 4px; }
</style></head>
<body>
<h1>${label} — Test Print</h1>
<p>If this page printed successfully, this device is working correctly.</p>
<p>Generated: ${new Date().toLocaleString("en-IN")}</p>
</body></html>`;

// Uses whichever printer type (normal/thermal) is active in Settings →
// Estimation Print, so this "does my assigned printer work" test matches
// what a real estimation print would actually send it.
const TEST_ESTIMATION_PRINT_HTML = (company) => generateActiveEstimationPrintHTML(
  SAMPLE_ESTIMATION.quote,
  SAMPLE_ESTIMATION.items,
  company || { name: "Sri Srinivasa Jewellers" },
  SAMPLE_ESTIMATION.goldRate,
  SAMPLE_ESTIMATION.rateMap,
);

async function makeTestBarcodeHtml() {
  const { SAMPLE_TAG_PRODUCT } = await import("@/lib/barcodeLayout");
  const items = [{ product: SAMPLE_TAG_PRODUCT, qty: 1 }];
  return generateStripTagPrintPayload(items, "Sri Srinivasa Jewellers");
}

/** Printer / Barcode Printer / Barcode Scanner status + quick tests. */
function PrintersDevicesTab({ canWrite = false, unlocked = false, onLocked }) {
  const isDesktop = Boolean(window.jewelleryCRM?.isDesktop);
  const [loading, setLoading] = useState(true);
  const [printerInfo, setPrinterInfo] = useState(null);
  const [assignments, setAssignments] = useState({ invoice: null, label: null, estimation: null });
  const [testingPrinter, setTestingPrinter] = useState(false);
  const [testingLabel, setTestingLabel] = useState(false);
  const [testingEstimation, setTestingEstimation] = useState(false);
  const [savingPref, setSavingPref] = useState(false);
  const [scanValue, setScanValue] = useState("");
  const [scanResult, setScanResult] = useState(null);
  const scanTimestamps = useRef([]);

  const loadPrinters = () => {
    if (!isDesktop) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      window.jewelleryCRM.getPrinters(),
      window.jewelleryCRM.getPrinterAssignments?.() || Promise.resolve({ invoice: null, label: null, estimation: null }),
    ])
      .then(([data, asgn]) => {
        setPrinterInfo(data);
        setAssignments({
          invoice: asgn?.invoice || null,
          label: asgn?.label || null,
          estimation: asgn?.estimation || null,
        });
      })
      .catch(() => setPrinterInfo({ printers: [], error: "Failed to query printers" }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadPrinters(); }, [isDesktop]);

  const saveAssignments = async (patch) => {
    if (!window.jewelleryCRM?.setPrinterAssignments) return;
    setSavingPref(true);
    try {
      const next = { ...assignments, ...patch };
      await window.jewelleryCRM.setPrinterAssignments(next);
      setAssignments(next);
      toast.success("Printer assignment saved");
      onLocked?.();
    } catch (err) {
      toast.error(err?.message || "Could not save printer assignment");
    } finally {
      setSavingPref(false);
    }
  };

  const testPrint = async () => {
    setTestingPrinter(true);
    try {
      await printHtml(TEST_PRINT_HTML("Printer"), { printerType: "invoice" });
    } catch {
      /* printHtml already showed toast */
    } finally {
      setTestingPrinter(false);
    }
  };

  const testLabel = async () => {
    setTestingLabel(true);
    try {
      const { html, rawTspl, rawTsplBase64 } = await makeTestBarcodeHtml();
      await printHtml(html, { printerType: "label", rawTspl, rawTsplBase64 });
    } catch {
      /* printHtml already showed toast */
    } finally {
      setTestingLabel(false);
    }
  };

  const testEstimation = async () => {
    setTestingEstimation(true);
    try {
      await printHtml(TEST_ESTIMATION_PRINT_HTML(), { printerType: "estimation" });
    } catch {
      /* printHtml already showed toast */
    } finally {
      setTestingEstimation(false);
    }
  };

  const onScanKeyDown = () => {
    scanTimestamps.current.push(Date.now());
  };

  const onScanChange = (e) => {
    setScanValue(e.target.value);
  };

  const onScanSubmit = (e) => {
    e.preventDefault();
    const stamps = scanTimestamps.current;
    if (!scanValue || stamps.length < 2) {
      setScanResult({ ok: false, message: "Scan a barcode/tag into the box above, then press Enter." });
      return;
    }
    const gaps = [];
    for (let i = 1; i < stamps.length; i++) gaps.push(stamps[i] - stamps[i - 1]);
    const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
    // HID scanners inject characters far faster than a human can type (usually <30ms/char);
    // this is a heuristic, not real device detection — this app has no USB/HID integration.
    const looksLikeScanner = avgGap < 30;
    setScanResult({
      ok: true,
      value: scanValue,
      avgGap: avgGap.toFixed(1),
      looksLikeScanner,
      message: looksLikeScanner
        ? "Fast keystroke burst detected — this looks like a scanner."
        : "Keystrokes came in slowly — this looks like manual typing, not a scanner.",
    });
    scanTimestamps.current = [];
    setScanValue("");
  };

  const printers = printerInfo?.printers || [];
  // Connected only for dropdowns; full physical list shows Offline in red when unplugged
  const connectedPrinters = printers.filter((p) => p.connected);
  const preferredName = assignments.invoice || "";
  const invoicePrinter = preferredName ? printers.find((p) => p.name === preferredName) : null;
  const labelPrinter = assignments.label ? printers.find((p) => p.name === assignments.label) : null;
  const estimationPrinter = assignments.estimation ? printers.find((p) => p.name === assignments.estimation) : null;
  const invoiceConnected = Boolean(invoicePrinter?.connected);
  const labelConnected = Boolean(labelPrinter?.connected);
  const estimationConnected = Boolean(estimationPrinter?.connected);
  const labelMissing = Boolean(assignments.label && !labelConnected);
  const invoiceMissing = Boolean(preferredName && !invoiceConnected);
  const estimationMissing = Boolean(assignments.estimation && !estimationConnected);
  const frozen = !unlocked;
  const effectiveCanWrite = canWrite && !frozen;

  return (
    <SettingsTabFrame>
      <PrintSettingsLockBanner frozen={frozen} />
      {!isDesktop && (
        <div className="border border-amber-200 bg-amber-50 text-[13px] text-[#92400E] flex items-center gap-2 rounded-lg px-4 py-3">
          <AlertTriangle size={14} strokeWidth={1.5} />
          Printer/device status requires the desktop app — you&apos;re viewing this in a browser.
        </div>
      )}

      <SettingsSplit>
        <SettingsSection
          title="Invoice / bill printer"
          description="Invoices print on the main PC USB printer. Client PCs send jobs over LAN to the host."
          actions={isDesktop ? (
            <button type="button" className="btn-secondary !py-1 !text-[11.5px]" onClick={loadPrinters}>
              <RefreshCw size={12} strokeWidth={1.5} /> Refresh
            </button>
          ) : null}
        >
          {loading ? (
            <div className="h-16 shimmer rounded-md" />
          ) : !isDesktop ? (
            <p className="text-[13px] text-[#737373]">Open the desktop ERP to manage printers.</p>
          ) : connectedPrinters.length === 0 && !invoiceMissing ? (
            <div className="flex items-center gap-2 text-[13px] text-[#991B1B]">
              <XCircle size={14} strokeWidth={1.5} /> No connected printers found — plug in Canon/TSC and click Refresh.
            </div>
          ) : (
            <>
              <div className="mb-3">
                <label className="label">Invoice / Bill Printer</label>
                <select
                  className="input text-[13px]"
                  disabled={savingPref || !effectiveCanWrite}
                  value={preferredName}
                  onChange={(e) => saveAssignments({ invoice: e.target.value || null })}
                >
                  <option value="">Windows default (auto)</option>
                  {connectedPrinters.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.displayName || p.name}{p.isDefault ? " — system default" : ""}
                    </option>
                  ))}
                  {invoiceMissing && (
                    <option value={preferredName}>{preferredName} — not connected</option>
                  )}
                </select>
              </div>
              <div className="space-y-1.5 mb-3 max-h-[240px] overflow-y-auto">
                {printers.length === 0 ? (
                  <div className="text-[12px] text-[#737373]">No physical printers found.</div>
                ) : printers.map((p) => (
                  <div key={p.name} className="flex items-center justify-between text-[13px] border border-[#E5E7EB] rounded-md px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 rounded-full flex-shrink-0 ${p.connected ? "bg-[#166534]" : "bg-[#DC2626]"}`} />
                      <span className="font-medium text-[#0A0A0A] truncate">{p.displayName || p.name}</span>
                      <span className={`text-[11px] ${p.connected ? "text-[#166534]" : "text-[#DC2626]"}`}>
                        {p.connected ? "Connected" : "Offline"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {preferredName === p.name && (
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#ECFDF5] text-[#166534] border border-[#A7F3D0]">Invoice</span>
                      )}
                      {assignments.label === p.name && (
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">Label</span>
                      )}
                      {assignments.estimation === p.name && (
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#F5F3FF] text-[#6D28D9] border border-[#DDD6FE]">Estimation</span>
                      )}
                      {p.isDefault && (
                        <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-[#FDFBF7] text-[#B49042] border border-[#EADFBF]">Default</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {preferredName && invoiceMissing && (
                <div className="flex items-start gap-2 text-[12px] text-[#991B1B] bg-[#FEF2F2] border border-[#FECACA] rounded-md p-2.5 mb-3">
                  <XCircle size={13} strokeWidth={1.5} className="mt-0.5 flex-shrink-0" />
                  Invoice printer <strong className="mx-1">{preferredName}</strong> is not connected right now.
                </div>
              )}
              <button type="button" className="btn-secondary" onClick={testPrint} disabled={testingPrinter}>
                <Printer size={13} strokeWidth={1.5} /> {testingPrinter ? "Sending…" : "Send Test Print"}
              </button>
            </>
          )}
        </SettingsSection>

        <SettingsSection
          title="Barcode / label printer"
          description="Works with any Windows label printer (TSC, Brother, Godex, Xprinter, etc.)."
        >
          {isDesktop ? (
            <div className="mb-3">
              <label className="label">Label Printer</label>
              <select
                className="input text-[13px]"
                disabled={savingPref || !effectiveCanWrite}
                value={assignments.label || ""}
                onChange={(e) => saveAssignments({ label: e.target.value || null })}
              >
                <option value="">— Not assigned —</option>
                {connectedPrinters.map((p) => (
                  <option key={p.name} value={p.name}>{p.displayName || p.name}</option>
                ))}
                {labelMissing && (
                  <option value={assignments.label}>{assignments.label} — not connected</option>
                )}
              </select>
              {assignments.label && labelConnected && (
                <p className="text-[11px] text-green-700 mt-1">✓ Connected — labels print to <strong>{assignments.label}</strong></p>
              )}
              {assignments.label && labelMissing && (
                <p className="text-[11px] text-[#991B1B] mt-1">✕ <strong>{assignments.label}</strong> is not connected. Plug it in, then Refresh.</p>
              )}
              {!assignments.label && (
                <p className="text-[11px] text-[#92400E] mt-1">No label printer assigned yet.</p>
              )}
            </div>
          ) : (
            <p className="text-[13px] text-[#737373] mb-3">Open the desktop ERP to assign a label printer.</p>
          )}
          <button type="button" className="btn-secondary" onClick={testLabel} disabled={testingLabel || !isDesktop}>
            <Tag size={13} strokeWidth={1.5} /> {testingLabel ? "Sending…" : "Print Test Label"}
          </button>
        </SettingsSection>
      </SettingsSplit>

      <SettingsSection
        title="Estimation printer"
        description="Estimations print on A5. Choose a dedicated printer, or leave this on the invoice printer."
      >
        {isDesktop ? (
          <div className="mb-3 max-w-xl">
            <label className="label">Estimation Printer (A5)</label>
            <select
              className="input text-[13px]"
              disabled={savingPref || !effectiveCanWrite}
              value={assignments.estimation || ""}
              onChange={(e) => saveAssignments({ estimation: e.target.value || null })}
            >
              <option value="">Same as invoice printer</option>
              {connectedPrinters.map((p) => (
                <option key={p.name} value={p.name}>{p.displayName || p.name}</option>
              ))}
              {estimationMissing && (
                <option value={assignments.estimation}>{assignments.estimation} — not connected</option>
              )}
            </select>
            {assignments.estimation && estimationConnected && (
              <p className="text-[11px] text-green-700 mt-1">✓ Connected — estimations print A5 to <strong>{assignments.estimation}</strong></p>
            )}
            {assignments.estimation && estimationMissing && (
              <p className="text-[11px] text-[#991B1B] mt-1">✕ <strong>{assignments.estimation}</strong> is not connected. Plug it in, then Refresh.</p>
            )}
            {!assignments.estimation && (
              <p className="text-[11px] text-[#737373] mt-1">No dedicated estimation printer — A5 jobs use the invoice printer.</p>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-[#737373] mb-3">Open the desktop ERP to assign an estimation printer.</p>
        )}
        <button type="button" className="btn-secondary" onClick={testEstimation} disabled={testingEstimation || !isDesktop}>
          <FileText size={13} strokeWidth={1.5} /> {testingEstimation ? "Sending…" : "Send A5 Test Print"}
        </button>
      </SettingsSection>

      <SettingsSection
        title="Barcode scanner"
        description="Scanners act as keyboards — click the box and scan any tag to confirm it is working."
      >
        <form onSubmit={onScanSubmit} className="flex flex-wrap items-center gap-2 mb-3 max-w-2xl">
          <input
            className="input flex-1 min-w-[220px]"
            placeholder="Click here, then scan a barcode…"
            value={scanValue}
            onChange={onScanChange}
            onKeyDown={onScanKeyDown}
            autoComplete="off"
          />
          <button type="submit" className="btn-secondary">Check</button>
        </form>
        {scanResult && (
          <div className={`flex items-center gap-2 text-[13px] ${scanResult.looksLikeScanner ? "text-[#166534]" : "text-[#92400E]"}`}>
            {scanResult.ok ? (
              scanResult.looksLikeScanner ? <CheckCircle2 size={14} strokeWidth={1.5} /> : <AlertTriangle size={14} strokeWidth={1.5} />
            ) : (
              <XCircle size={14} strokeWidth={1.5} />
            )}
            <span>
              {scanResult.message}
              {scanResult.ok && ` (value: "${scanResult.value}", avg ${scanResult.avgGap}ms/keystroke)`}
            </span>
          </div>
        )}
      </SettingsSection>
    </SettingsTabFrame>
  );
}

function GoldRateTab({ canWrite = false }) {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  // Once the admin manually edits a derived field directly, later re-editing
  // the 24K/999 base rate must not silently overwrite that override again.
  const [touched, setTouched] = useState({});

  const load = () =>
    api.get("/settings/gold-rate")
      .then(({ data }) => setForm(data || {}))
      .catch(() => setForm({}));

  useEffect(() => {
    load();
  }, []);

  // Live mode auto-syncs in the background; poll while this tab is open so it's visibly "live".
  useEffect(() => {
    if (!form?.live_rate_enabled) return undefined;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [form?.live_rate_enabled]);

  if (!form) return (
    <div className="space-y-4">
      <PageLoadingBadge />
      <div className="h-64 shimmer rounded-md" />
    </div>
  );
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const liveOn = !!form.live_rate_enabled;

  const markTouched = (key) => setTouched((t) => ({ ...t, [key]: true }));

  // Manual entry: typing the 24K / 999-silver base rate auto-fills the derived
  // purities (still editable afterward) using the same karat/fineness ratios
  // as the DP Gold live-sync path — (purity/24)*24K, (purity/999)*999. Once a
  // derived field has been hand-edited, later base-rate edits leave it alone
  // instead of silently recomputing over the admin's manual price.
  const handleGold24kChange = (raw, numeric) => {
    setForm((f) => ({
      ...f,
      gold_24k: raw,
      ...(touched.gold_22k ? {} : { gold_22k: Math.round((22 / 24) * numeric * 100) / 100 }),
      ...(touched.gold_18k ? {} : { gold_18k: Math.round((18 / 24) * numeric * 100) / 100 }),
    }));
  };
  const handlePureSilverChange = (raw, numeric) => {
    setForm((f) => ({
      ...f,
      pure_silver: raw,
      ...(touched.silver ? {} : { silver: Math.round((925 / 999) * numeric * 100) / 100 }),
    }));
  };

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/settings/gold-rate", {
        ...form,
        gold_24k: parseMoneyInput(form.gold_24k),
        gold_22k: parseMoneyInput(form.gold_22k),
        gold_18k: parseMoneyInput(form.gold_18k),
        silver: parseMoneyInput(form.silver),
        pure_silver: parseMoneyInput(form.pure_silver),
        source: "settings",
      });
      toast.success("Rates updated");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post("/settings/gold-rate/sync");
      setForm(data);
      toast.success("Synced with configured source");
    } catch (err) {
      toast.error(formatApiError(err));
      load();
    } finally {
      setSyncing(false);
    }
  };

  const toggleLive = async (checked) => {
    const prevForm = form;
    set("live_rate_enabled", checked);
    try {
      const { data } = await api.put("/settings/gold-rate", { live_rate_enabled: checked });
      setForm(data);
      if (checked) await syncNow();
    } catch (err) {
      toast.error(formatApiError(err));
      setForm(prevForm);
    }
  };

  return (
    <SettingsTabFrame>
      <SettingsSection
        title="Live Metal Rates"
        description="Rates propagate to POS billing and dashboard widgets."
        actions={liveOn ? (
          <button data-enter-submit="true" onClick={syncNow} disabled={syncing || !canWrite} className="btn-primary">
            <RefreshCw size={14} strokeWidth={1.5} className={syncing ? "animate-spin" : ""} /> {syncing ? "Syncing…" : "Sync now"}
          </button>
        ) : (
          <button data-enter-submit="true" onClick={save} disabled={busy || !canWrite} className="btn-primary">
            <Save size={14} strokeWidth={1.5} /> {busy ? "Saving…" : "Save rates"}
          </button>
        )}
      >
        <div className="flex items-center justify-between gap-3 mb-4 p-3 rounded-md border border-gray-200 bg-gray-50">
          <div>
            <div className="text-sm font-medium text-gray-900">Live rate from configured source</div>
            <div className="text-[11px] text-gray-400 mb-0.5">
              Set in Settings → Company → Company Profile → Metal Price Sources
            </div>
            <div className="text-xs text-gray-500">
              {liveOn
                ? form.live_rate_last_synced_at
                  ? `Auto-synced · last update ${fmtDateTime(form.live_rate_last_synced_at)}`
                  : "Auto-sync enabled — syncing…"
                : "Off — enter rates manually below"}
            </div>
            {liveOn && form.live_rate_last_error && (
              <div className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} strokeWidth={1.5} /> Last sync failed: {form.live_rate_last_error}
              </div>
            )}
          </div>
          <Switch checked={liveOn} onCheckedChange={toggleLive} disabled={!canWrite} />
        </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <F label="24K Gold (₹/g)"><MoneyInput className="input font-mono" value={form.gold_24k} onValueChange={handleGold24kChange} disabled={liveOn} /></F>
        <F label="22K Gold (₹/g)"><MoneyInput className="input font-mono" value={form.gold_22k} onValueChange={(raw) => { set("gold_22k", raw); markTouched("gold_22k"); }} disabled={liveOn} /></F>
        <F label="18K Gold (₹/g)"><MoneyInput className="input font-mono" value={form.gold_18k} onValueChange={(raw) => { set("gold_18k", raw); markTouched("gold_18k"); }} disabled={liveOn} /></F>
        <F label="Silver (₹/g)"><MoneyInput className="input font-mono" value={form.silver ?? 0} onValueChange={(raw) => { set("silver", raw); markTouched("silver"); }} disabled={liveOn} /></F>
        <F label="Pure Silver (₹/g)"><MoneyInput className="input font-mono" value={form.pure_silver ?? 0} onValueChange={handlePureSilverChange} disabled={liveOn} /></F>
      </div>
      </SettingsSection>
    </SettingsTabFrame>
  );
}

function UsersTab() {
  const { user: me } = useAuth();
  const { ownerName } = useCompany();
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState(null);
  const [openNew, setOpenNew] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const load = () =>
    api.get("/users")
      .then(({ data }) => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]));
  useEffect(() => {
    load();
    api.get("/meta/roles")
      .then(({ data }) => setMeta(data))
      .catch(() => setMeta({ roles: ["cashier", "manager", "shop_owner"], modules: [], actions: [] }));
  }, []);

  const remove = async (id) => {
    if (!(await confirm("Delete this user?"))) return;
    try {
      await api.delete(`/users/${id}`);
      toast.success("User deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="text-[13px] text-[#737373]">Manage your team's access to Sri Srinivasa Jewellers.</div>
        <button onClick={() => setOpenNew(true)} className="btn-primary">
          <Plus size={14} strokeWidth={1.5} /> New user
        </button>
      </div>
      <div className="table-shell">
        <table className="w-full">
          <thead>
            <tr className="table-head-row">
              <th className="table-th">User</th>
              <th className="table-th">Email</th>
              <th className="table-th">Role</th>
              <th className="table-th">Status</th>
              <th className="table-th">Since</th>
              <th className="table-th"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="table-row">
                <td className="table-td">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center text-[12px]">
                      {u.name?.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="font-medium">{u.name}</div>
                  </div>
                </td>
                <td className="table-td font-mono text-[12.5px]">{u.email}</td>
                <td className="table-td">
                  <span className={`chip ${u.role === "shop_owner" ? "chip-gold" : "chip-neutral"}`}>
                    {formatRoleLabel(u.role, ownerName, u.email)}
                  </span>
                </td>
                <td className="table-td">
                  {u.active ? (
                    <span className="chip chip-success">Active</span>
                  ) : (
                    <span className="chip chip-danger">Disabled</span>
                  )}
                </td>
                <td className="table-td text-[#737373] font-mono text-[12px]">{fmtDate(u.created_at)}</td>
                <td className="table-td text-right">
                  {u.id !== me?.id && (
                    <button onClick={() => remove(u.id)} className="text-[#a3a3a3] hover:text-[#991B1B]">
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openNew && meta && (
        <NewUserModal roles={meta.roles} onClose={() => setOpenNew(false)} onCreated={load} />
      )}
      {confirmModal}
    </div>
  );
}

function NewUserModal({ roles, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "cashier" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/users", form);
      toast.success("User created");
      onCreated();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="section-title">Invite user</div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]"><X size={16} strokeWidth={1.5} /></button>
        </div>
        <div className="p-5 space-y-3">
          <F label="Name"><input required className="input" value={form.name} onChange={(e) => set("name", e.target.value)} /></F>
          <F label="Email"><input required type="email" className="input" value={form.email} onChange={(e) => set("email", e.target.value)} /></F>
          <F label="Temporary Password"><input required minLength={6} type="text" className="input font-mono" value={form.password} onChange={(e) => set("password", e.target.value)} /></F>
          <F label="Role">
            <select className="input capitalize" value={form.role} onChange={(e) => set("role", e.target.value)}>
              {roles.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
            </select>
          </F>
        </div>
        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? "Creating…" : "Create user"}</button>
        </div>
      </form>
    </div>
  );
}

function F({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

// ─── Devices Tab ──────────────────────────────────────────────────────────────

function deviceStatus(device) {
  if (device.status === "revoked") return "revoked";
  if (!device.last_seen_at) return "unknown";
  const diff = Date.now() - new Date(device.last_seen_at).getTime();
  if (diff < 2 * 60 * 1000) return "online";
  if (diff < 15 * 60 * 1000) return "idle";
  return "offline";
}

function StatusDot({ status }) {
  const colors = {
    online: "bg-green-500",
    idle: "bg-amber-400",
    offline: "bg-red-400",
    revoked: "bg-orange-500",
    unknown: "bg-gray-300",
  };
  const labels = {
    online: "Online",
    idle: "Idle",
    offline: "Offline",
    revoked: "Revoked",
    unknown: "Unknown",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || colors.unknown}`} />
      <span className="text-[12px] text-[#737373]">{labels[status] || "Unknown"}</span>
    </span>
  );
}

function StepRow({ step }) {
  const icons = {
    pending: <span className="w-5 h-5 rounded-full border-2 border-[#D1D5DB] flex items-center justify-center" />,
    active: <Loader2 size={18} className="animate-spin text-amber-500" />,
    done: <CheckCircle2 size={18} className="text-green-500" />,
    error: <XCircle size={18} className="text-red-500" />,
  };
  return (
    <div className={`flex items-center gap-3 py-2.5 px-3 rounded-lg transition-colors ${
      step.state === "active" ? "bg-amber-50" : step.state === "done" ? "bg-green-50" : step.state === "error" ? "bg-red-50" : "bg-transparent"
    }`}>
      <div className="flex-shrink-0">{icons[step.state] || icons.pending}</div>
      <span className={`text-[13px] font-medium ${
        step.state === "active" ? "text-amber-700" : step.state === "done" ? "text-green-700" : step.state === "error" ? "text-red-600" : "text-[#9CA3AF]"
      }`}>{step.label}</span>
    </div>
  );
}

function TransferModal({ device, onClose }) {
  const initialSteps = [
    { id: "init", label: "Preparing ownership transfer", state: "active" },
    { id: "db", label: "Preparing shop database for transfer", state: "pending" },
    { id: "wait", label: `Waiting for ${device.device_name} to acknowledge`, state: "pending" },
    { id: "pull", label: `${device.device_name} is downloading latest data`, state: "pending" },
    { id: "switch", label: "Confirming ownership switch", state: "pending" },
    { id: "reconnect", label: "This PC reconnecting as client", state: "pending" },
  ];
  const [steps, setSteps] = useState(initialSteps);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const pollRef = useRef(null);
  const cancelled = useRef(false);

  function setStep(id, state) {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, state } : s));
  }

  useEffect(() => {
    run();
    return () => {
      cancelled.current = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function run() {
    try {
      // Step 1 — initiate
      await api.post(`/devices/transfer/${device.id}`);
      if (cancelled.current) return;
      setStep("init", "done");
      setStep("db", "active");

      // Always use LAN file transfer — no cloud database
      setSteps(prev => prev.map(s => s.id === "db"
        ? { ...s, label: "Using direct LAN database transfer" }
        : s.id === "wait"
        ? { ...s, label: `Sending database file to ${device.device_name} over LAN` }
        : s.id === "pull"
        ? { ...s, label: `${device.device_name} importing database file` }
        : s
      ));
      await api.post("/devices/transfer/neon-ready", { offline: true });
      if (cancelled.current) return;
      setStep("db", "done");
      setStep("wait", "active");

      // Step 3 — poll until target accepts
      await new Promise((resolve, reject) => {
        let pullSignalled = false;
        const timeout = setTimeout(() => {
          clearInterval(pollRef.current);
          reject(new Error("Timed out — the other PC did not respond within 5 minutes"));
        }, 5 * 60 * 1000);

        pollRef.current = setInterval(async () => {
          if (cancelled.current) { clearInterval(pollRef.current); clearTimeout(timeout); return; }
          try {
            const { data } = await api.get("/devices/transfer-status");
            if (data.status === "complete") {
              clearInterval(pollRef.current); clearTimeout(timeout); resolve();
            } else if (data.status === "failed") {
              clearInterval(pollRef.current); clearTimeout(timeout);
              reject(new Error(data.error || "Transfer failed on the target PC"));
            } else if (data.status === "target_pulling" && !pullSignalled) {
              pullSignalled = true;
              setStep("wait", "done");
              setStep("pull", "active");
            }
          } catch { /* network hiccup — keep polling */ }
        }, 2500);
      });

      if (cancelled.current) return;
      setStep("pull", "done");
      setStep("switch", "active");
      await new Promise(r => setTimeout(r, 800));
      setStep("switch", "done");
      setStep("reconnect", "active");

      // Step 4 — switch this PC to client mode and reconnect to new owner
      if (window.jewelleryCRM) {
        try {
          const res = await fetch(`${getBackendUrl()}/api/devices/discover?timeout_ms=3000`);
          const discovered = await res.json().catch(() => ({ hosts: [] }));
          const newOwner = (discovered.hosts || []).find(h => h.addresses && h.addresses.length > 0);
          if (newOwner) {
            const newUrl = `http://${newOwner.addresses[0]}:${newOwner.api_port || 8080}`;
            await window.jewelleryCRM.setConfig({ mode: "join", branch_api_url: newUrl, setup_complete: true });
          }
        } catch { /* best effort */ }
      }

      setStep("reconnect", "done");
      setDone(true);
      setTimeout(() => {
        if (window.jewelleryCRM?.completeSetupAndReload) window.jewelleryCRM.completeSetupAndReload();
        else window.location.reload();
      }, 2000);

    } catch (err) {
      if (cancelled.current) return;
      setSteps(prev => prev.map(s => s.state === "active" ? { ...s, state: "error" } : s));
      setError(err.message || "Transfer failed");
    }
  }

  async function handleCancel() {
    cancelled.current = true;
    if (pollRef.current) clearInterval(pollRef.current);
    try { await api.post("/devices/transfer/cancel"); } catch { /* ignore */ }
    onClose();
  }

  async function handleRetry() {
    if (pollRef.current) clearInterval(pollRef.current);
    try { await api.post("/devices/transfer/cancel"); } catch { /* ignore */ }
    cancelled.current = false;
    setError(null);
    setSteps(initialSteps);
    run();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-full p-2">
              <ArrowLeftRight size={20} className="text-white" />
            </div>
            <div>
              <h2 className="text-white font-semibold text-[15px]">Transfer Shop Ownership</h2>
              <p className="text-amber-100 text-[12px] mt-0.5">Transferring to: <strong>{device.device_name}</strong></p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="px-6 py-5 space-y-1">
          {steps.map(step => <StepRow key={step.id} step={step} />)}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600 text-[13px] font-medium">{error}</p>
            <p className="text-red-500 text-[12px] mt-1">Make sure the other PC is on and connected, then try again.</p>
          </div>
        )}

        {/* Done */}
        {done && (
          <div className="mx-6 mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center gap-2">
            <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
            <p className="text-green-700 text-[13px] font-medium">Ownership transferred! Reloading in a moment…</p>
          </div>
        )}

        {/* Footer */}
        {!done && (
          <div className="px-6 pb-5 flex gap-2">
            {error && (
              <button
                onClick={handleRetry}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[13px] font-medium transition-colors"
              >
                Try Again
              </button>
            )}
            <button
              onClick={handleCancel}
              className={`py-2.5 border border-[#E5E7EB] rounded-lg text-[13px] text-[#737373] hover:bg-[#F9FAFB] hover:text-[#0A0A0A] transition-colors ${error ? "flex-1" : "w-full"}`}
            >
              {error ? "Cancel" : "Cancel Transfer"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DevicesTab({ canWrite = false }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [transferTarget, setTransferTarget] = useState(null);
  const [dbStatus, setDbStatus] = useState(null);
  const [lanAddresses, setLanAddresses] = useState([]);
  const [actionBusy, setActionBusy] = useState(null);
  const [confirm, confirmModal] = useConfirm();
  const { user } = useAuth();
  const isDesktop = !!window.jewelleryCRM?.isDesktop;

  const load = async ({ quiet = false } = {}) => {
    try {
      const { data } = await api.get("/devices");
      setDevices(Array.isArray(data) ? data : []);
      setLoadError("");
    } catch (err) {
      let msg = formatApiError(err) || "Could not load devices";
      if (err?.response?.status === 403 && err?.response?.data?.error === "HOST_ONLY") {
        msg = "Device approval only works on the Main PC (owner host). Sign in on the Main PC, not a staff PC.";
      }
      setLoadError(msg);
      if (!quiet) toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Load local DB size (desktop only via Electron IPC)
  useEffect(() => {
    if (window.jewelleryCRM?.getLocalDbStatus) {
      window.jewelleryCRM.getLocalDbStatus().then(setDbStatus).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (window.jewelleryCRM?.getLocalIp) {
          const { ips, port } = await window.jewelleryCRM.getLocalIp();
          if (!cancelled && ips?.length) {
            setLanAddresses(ips.map((ip) => `http://${ip}:${port || 8080}`));
            return;
          }
        }
        const base = getBackendUrl().replace(/\/$/, "");
        if (!cancelled && base && !base.includes("127.0.0.1") && !base.includes("localhost")) {
          setLanAddresses([base]);
        }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    load({ quiet: false });
    const id = setInterval(() => load({ quiet: true }), 5000);
    return () => clearInterval(id);
  }, []);

  const pending = devices.filter((d) => d.status === "pending" || d.status === "declined");
  const approved = devices.filter((d) => d.status === "active" || d.status === "approved");
  const revoked = devices.filter((d) => d.status === "revoked");
  const owner = approved.find((d) => d.role === "active_host" || d.device_number === 1);
  const clients = approved.filter((d) => d !== owner);
  const canManage = canWrite;
  const canTransfer = canWrite;

  const allowDevice = async (device) => {
    setActionBusy(device.id);
    try {
      await api.post(`/devices/${device.id}/approve`);
      toast.success(`Allowed ${device.device_name}`);
      load();
    } catch (err) {
      if (err?.response?.status === 403 && err?.response?.data?.error === 'HOST_ONLY') {
        toast.error('This action can only be performed on the main PC.');
        return;
      }
      toast.error(formatApiError(err) || "Could not allow device");
    } finally {
      setActionBusy(null);
    }
  };

  const declineDeviceReq = async (device) => {
    setActionBusy(device.id);
    try {
      await api.post(`/devices/${device.id}/decline`);
      toast.message(`Declined ${device.device_name}`);
      load();
    } catch (err) {
      if (err?.response?.status === 403 && err?.response?.data?.error === 'HOST_ONLY') {
        toast.error('This action can only be performed on the main PC.');
        return;
      }
      toast.error(formatApiError(err) || "Could not decline");
    } finally {
      setActionBusy(null);
    }
  };

  const renameDeviceReq = async (device) => {
    const name = window.prompt("Device name", device.device_name || "");
    if (!name || !name.trim()) return;
    try {
      await api.patch(`/devices/${device.id}`, { device_name: name.trim() });
      toast.success("Device renamed");
      load();
    } catch (err) {
      if (err?.response?.status === 403 && err?.response?.data?.error === 'HOST_ONLY') {
        toast.error('This action can only be performed on the main PC.');
        return;
      }
      toast.error(formatApiError(err) || "Rename failed");
    }
  };

  const deleteDevice = async (device) => {
    if (!(await confirm(`Permanently remove "${device.device_name}" from the shop? Prefer Revoke to block access while keeping history.`))) return;
    try {
      await api.delete(`/devices/${device.id}`);
      toast.success(`${device.device_name} removed`);
      load();
    } catch (err) {
      if (err?.response?.status === 403 && err?.response?.data?.error === 'HOST_ONLY') {
        toast.error('This action can only be performed on the main PC.');
        return;
      }
      toast.error(formatApiError(err) || "Failed to remove device");
    }
  };

  const revokeDevice = async (device) => {
    if (!(await confirm(`Revoke "${device.device_name}"? It will lose access until approved again.`))) return;
    try {
      await api.post(`/devices/${device.id}/revoke`);
      toast.success(`${device.device_name} revoked`);
      load();
    } catch (err) {
      if (err?.response?.status === 403 && err?.response?.data?.error === 'HOST_ONLY') {
        toast.error('This action can only be performed on the main PC.');
        return;
      }
      toast.error(formatApiError(err) || "Failed to revoke device");
    }
  };

  if (loading) return <PageLoadingBadge />;

  const dbMb = dbStatus?.fileSizeBytes != null
    ? (dbStatus.fileSizeBytes / (1024 * 1024)).toFixed(2)
    : null;

  return (
    <SettingsTabFrame>
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className="border border-[#E5E7EB] rounded-xl p-4 bg-white">
          <div className="flex items-center gap-2 mb-1">
            <Database size={13} strokeWidth={1.5} className="text-[#B49042]" />
            <span className="text-[10.5px] uppercase tracking-widest font-semibold text-[#737373]">Local Data Saved</span>
          </div>
          <div className="font-display text-[22px] font-bold text-[#0A0A0A] leading-none">
            {dbMb != null ? `${dbMb} MB` : "—"}
          </div>
          <div className="text-[11px] text-[#9CA3AF] mt-1">
            {dbStatus?.schemaVersion ? `Schema v${dbStatus.schemaVersion}` : "SQLite database"}
          </div>
        </div>
        <div className="border border-[#E5E7EB] rounded-xl p-4 bg-white">
          <div className="flex items-center gap-2 mb-1">
            <Monitor size={13} strokeWidth={1.5} className="text-[#737373]" />
            <span className="text-[10.5px] uppercase tracking-widest font-semibold text-[#737373]">Devices</span>
          </div>
          <div className="font-display text-[22px] font-bold text-[#0A0A0A] leading-none">
            {approved.length}
          </div>
          <div className="text-[11px] text-[#9CA3AF] mt-1">
            {pending.filter((d) => d.status === "pending").length} pending · {revoked.length} revoked
          </div>
        </div>
      </div>

      {lanAddresses.length > 0 && (
        <p className="text-[12px] text-[#737373]">
          Main PC address (diagnostic): <span className="font-mono text-[#0A0A0A]">{lanAddresses[0]}</span>
        </p>
      )}

      {/* Pending Requests */}
      <div className="border border-amber-200 rounded-xl bg-amber-50/70 overflow-hidden">
        <div className="px-4 py-3 border-b border-amber-200">
          <h3 className="text-[13px] font-semibold text-[#0A0A0A]">Pending Requests</h3>
          <p className="text-[12px] text-[#737373] mt-0.5">
            Computers on the local network that asked to join. Allow before staff can sign in.
          </p>
        </div>
        {loadError ? (
          <div className="px-4 py-5 text-[12px] text-red-800 space-y-2 bg-red-50/80">
            <p className="font-medium">{loadError}</p>
            <p className="text-red-700/80">
              Make sure this PC is the Main PC, Jewellery CRM backend is running, and you signed in as the shop owner.
            </p>
          </div>
        ) : pending.length === 0 ? (
          <div className="px-4 py-5 text-[12px] text-amber-900/80 space-y-2">
            <p className="font-medium">No pending requests yet.</p>
            <ol className="list-decimal pl-4 space-y-1 text-amber-900/70">
              <li>On the staff PC open Jewellery CRM → Sign in</li>
              <li>Click <span className="font-semibold">This is a staff PC — connect to Main PC</span></li>
              <li>Connect successfully (not “Main PC not found”)</li>
              <li>When it says device approval required — it appears here within a few seconds</li>
            </ol>
            {lanAddresses[0] && (
              <div className="pt-1 space-y-1">
                <p className="text-[11px] font-mono text-[#737373]">
                  Staff PC must reach: {lanAddresses[0]}
                </p>
                <p className="text-[11px] text-amber-800/70">
                  If the staff PC shows "Main PC found but can&apos;t connect", run this once on the Main PC (as Administrator):
                </p>
                <p className="text-[10.5px] font-mono bg-amber-100/60 rounded px-2 py-1 text-amber-900 select-all break-all">
                  netsh advfirewall firewall add rule name=&quot;Jewellery ERP LAN Port 8080&quot; protocol=TCP dir=in localport=8080 action=allow profile=any
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="divide-y divide-amber-100">
            {pending.map((d) => (
              <div key={d.id} className="px-4 py-3 flex items-start justify-between gap-3 bg-white/80">
                <div className="min-w-0">
                  <div className="font-semibold text-[13px] text-[#0A0A0A]">{d.device_name || "Staff PC"}</div>
                  <div className="text-[11px] text-[#737373] mt-0.5">
                    {d.meta?.platform ? `${d.meta.platform} · ` : ""}
                    First seen {d.meta?.requested_at ? new Date(d.meta.requested_at).toLocaleString() : (d.created_at ? new Date(d.created_at).toLocaleString() : "—")}
                  </div>
                  {d.meta?.network_address && (
                    <div className="text-[11px] font-mono text-[#9CA3AF] mt-0.5">{d.meta.network_address}</div>
                  )}
                  <div className="text-[11px] mt-1 font-medium text-amber-800">
                    Status: {d.status === "declined" ? "Declined" : "Waiting for approval"}
                  </div>
                </div>
                {canManage && d.status === "pending" && (
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={actionBusy === d.id}
                      onClick={() => allowDevice(d)}
                      className="px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-[#0A0A0A] text-white disabled:opacity-50"
                    >
                      {actionBusy === d.id ? "…" : "Allow Device"}
                    </button>
                    <button
                      type="button"
                      disabled={actionBusy === d.id}
                      onClick={() => declineDeviceReq(d)}
                      className="px-3 py-1.5 text-[12px] font-medium rounded-lg border border-[#E5E7EB] bg-white disabled:opacity-50"
                    >
                      Decline
                    </button>
                  </div>
                )}
                {!canManage && (d.status === "pending" || d.status === "declined") && (
                  <p className="text-[11px] text-amber-800 shrink-0 max-w-[140px] text-right">
                    Sign in as shop owner to Allow / Decline
                  </p>
                )}
                {canManage && d.status === "declined" && (
                  <button
                    type="button"
                    disabled={actionBusy === d.id}
                    onClick={() => allowDevice(d)}
                    className="px-3 py-1.5 text-[12px] font-semibold rounded-lg bg-[#0A0A0A] text-white disabled:opacity-50"
                  >
                    Allow Device
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Approved Devices */}
      <div>
        <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-2">Approved Devices</p>
        <div className="space-y-2">
          {owner && (
            <div className="border-2 border-amber-300 bg-gradient-to-r from-amber-50 to-orange-50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="bg-amber-100 rounded-full p-2.5">
                  <Crown size={18} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[14px] text-[#0A0A0A]">{owner.device_name}</span>
                    <span className="text-[10px] bg-amber-200 text-amber-800 px-2 py-0.5 rounded-full font-semibold">MAIN PC</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-[#737373]">
                    <StatusDot status={deviceStatus(owner)} />
                    <span className="font-mono truncate">{owner.device_identifier}</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {clients.map((device) => {
            const status = deviceStatus(device);
            return (
              <div key={device.id} className="border border-[#E5E7EB] bg-white rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="bg-[#F3F4F6] rounded-full p-2.5">
                    <Monitor size={18} className="text-[#6B7280]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[14px] text-[#0A0A0A]">{device.device_name}</span>
                      <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-semibold">CLIENT</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-[11px] text-[#9CA3AF]">
                      <StatusDot status={status} />
                      <span className="font-mono truncate max-w-[180px]">{device.device_identifier}</span>
                      {device.meta?.approved_at && (
                        <span>Approved {new Date(device.meta.approved_at).toLocaleDateString()}</span>
                      )}
                      {device.last_seen_at && (
                        <span>Last seen {new Date(device.last_seen_at).toLocaleString()}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => renameDeviceReq(device)}
                        className="px-2.5 py-1.5 border border-[#E5E7EB] rounded-lg text-[12px] text-[#374151] hover:bg-[#F9FAFB]"
                      >
                        Rename
                      </button>
                    )}
                    {canTransfer && status !== "offline" && (
                      <button
                        type="button"
                        onClick={() => setTransferTarget(device)}
                        className="flex items-center gap-1.5 px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-[12px] text-[#374151] hover:bg-amber-50 hover:border-amber-300 hover:text-amber-700 font-medium whitespace-nowrap"
                      >
                        <ArrowLeftRight size={12} />
                        Transfer Ownership
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => revokeDevice(device)}
                        className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-[12px] hover:bg-orange-50 hover:border-orange-300 hover:text-orange-700 font-medium"
                      >
                        Revoke
                      </button>
                    )}
                    {canManage && (
                      <button
                        type="button"
                        onClick={() => deleteDevice(device)}
                        className="px-2.5 py-1.5 border border-[#E5E7EB] rounded-lg text-[12px] hover:bg-red-50 hover:border-red-300 hover:text-red-600"
                        title="Remove this device"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {clients.length === 0 && !owner && (
            <div className="border border-dashed border-[#E5E7EB] rounded-xl p-8 text-center">
              <Monitor size={28} className="text-[#D1D5DB] mx-auto mb-2" />
              <p className="text-[13px] text-[#737373] font-medium">No approved client PCs yet</p>
              <p className="text-[12px] text-[#9CA3AF] mt-1">Staff PCs appear under Pending Requests when they open the ERP</p>
            </div>
          )}
        </div>
      </div>

      {/* Revoked */}
      {revoked.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-2">Revoked Devices</p>
          <div className="space-y-2">
            {revoked.map((device) => (
              <div key={device.id} className="border border-[#E5E7EB] bg-[#FAFAFA] rounded-xl p-4 opacity-80">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-[13px] text-[#0A0A0A]">{device.device_name}</div>
                    <div className="text-[11px] font-mono text-[#9CA3AF] mt-0.5">{device.device_identifier}</div>
                    <div className="text-[11px] text-red-700 mt-1">Revoked — must request access again</div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      onClick={() => deleteDevice(device)}
                      className="px-3 py-1.5 border border-[#E5E7EB] rounded-lg text-[12px] hover:bg-red-50 hover:text-red-600"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {transferTarget && (
        <TransferModal
          device={transferTarget}
          onClose={() => { setTransferTarget(null); load(); }}
        />
      )}
      {confirmModal}
    </SettingsTabFrame>
  );
}
