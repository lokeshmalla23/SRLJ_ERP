import { useEffect, useState, useCallback, useRef } from "react";
import { KPISkeleton, SectionSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  AlertTriangle, Coins, Sparkles, ArrowRight,
  Edit2, Check, X, IndianRupee, Package, ChevronDown, ChevronUp,
  CalendarDays, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR, fmtDateTime, parseMoneyInput } from "@/lib/format";
import { asObject } from "@/lib/jsonFields";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import { useApplicationFeatures } from "@/context/ApplicationFeatureContext";
import { useDashboardHiddenUnlocked } from "@/lib/dashboardHiddenUnlock";
import { useHiddenBillUnlockGate } from "@/hooks/useHiddenBillUnlockGate";
import { hiddenUnlockBleedClass } from "@/lib/hiddenUnlockSurface";
import { JewelleryHeroArt, BullionArt } from "@/components/dashboard/JewelleryArt";
import { kpiTones } from "@/lib/theme";

function parseND(raw) {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw;
}

function getDashboardDayLine(now = new Date()) {
  const day = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(now);
  const hour = now.getHours();
  const salutation = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  return `${day} · ${salutation}. A clear view of today’s showroom activity.`;
}

/**
 * Greeting hero. The greeting, supporting line, title-click handler and lock
 * button all stay exactly as they were — only the frame and the decorative
 * jewellery artwork on the right are new.
 */
function DashboardHeader({ firstName, supportingLine, onTitleClick, titleHint, lockButton }) {
  return (
    <section className="relative mb-5 overflow-hidden rounded-[20px] border border-[#EAE1CD] bg-[linear-gradient(118deg,#FDFBF6_0%,#FBF6EA_44%,#F4EAD8_100%)] px-5 py-9 shadow-[0_20px_48px_-34px_rgba(92,72,36,0.5)] sm:px-8 sm:py-11 lg:py-14">
      {/* layered atmosphere: champagne bloom + faint vertical silk texture */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(105%_120%_at_100%_0%,rgba(226,196,131,0.32),transparent_58%)]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60 [background-image:repeating-linear-gradient(102deg,rgba(178,139,72,0.045)_0px,rgba(178,139,72,0.045)_1px,transparent_1px,transparent_9px)]" />
      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-[linear-gradient(90deg,rgba(178,139,72,0.28),rgba(178,139,72,0)_62%)]" />

      {/* large premium jewellery visual, right side */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[-1%] hidden w-[56%] lg:block xl:w-[52%]">
        <JewelleryHeroArt className="h-full w-full" />
      </div>

      <div className="relative z-10 max-w-[100%] lg:max-w-[52%] xl:max-w-[48%] [&>div]:mb-0">
        <PageHeader
          title={(
            <span className="inline-flex flex-wrap items-baseline gap-x-2.5">
              <span className="font-sans text-[12px] font-semibold uppercase tracking-[0.24em] text-[#987A3A]">Namaste,</span>{" "}
              <span className="inline-flex items-baseline">
                <span className="text-[40px] font-normal leading-none tracking-[-0.025em] text-[#173C33] sm:text-[46px]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{firstName}</span>
                <span className="text-[30px] font-normal leading-none text-[#B28B48] sm:text-[34px]" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>.</span>
              </span>
            </span>
          )}
          subtitle={supportingLine}
          onTitleClick={onTitleClick}
          titleHint={titleHint}
          actions={lockButton}
        />
      </div>
    </section>
  );
}

function LowStockPanel() {
  const [alerts, setAlerts] = useState([]);
  const [minimized, setMinimized] = useState(() => localStorage.getItem("ls_panel_min") === "1");
  const [mounted, setMounted] = useState(false);
  const timerRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get("/notifications?limit=50");
      const active = (data.notifications || []).filter(
        (n) => !n.is_read && (n.type === "low_stock" || n.type === "out_of_stock")
      );
      setAlerts(active);
    } catch { /* silent */ }
  };

  useEffect(() => {
    load();
    timerRef.current = setInterval(load, 30000);
    // Slight delay so CSS transition plays on first render
    setTimeout(() => setMounted(true), 80);
    return () => clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail?.type;
      if (["invoice:created", "product:changed"].includes(t)) load();
    };
    window.addEventListener("realtime", handler);
    return () => window.removeEventListener("realtime", handler);
  }, []);

  const toggle = () => {
    const next = !minimized;
    setMinimized(next);
    localStorage.setItem("ls_panel_min", next ? "1" : "0");
  };

  if (alerts.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-40"
      style={{
        transition: "transform 0.45s cubic-bezier(0.34,1.56,0.64,1), opacity 0.35s ease",
        transform: mounted ? "translateY(0)" : "translateY(120%)",
        opacity: mounted ? 1 : 0,
      }}
    >
      {minimized ? (
        /* ── Minimized pill ── */
        <button
          onClick={toggle}
          className="flex items-center gap-2 bg-[#173C33] hover:bg-[#214C40] active:scale-95 text-white pl-4 pr-3 py-2.5 rounded-full shadow-[0_10px_30px_rgba(23,60,51,0.2)] hover:shadow-[0_12px_34px_rgba(23,60,51,0.24)] transition-all duration-200"
          style={{ transition: "background 0.15s, box-shadow 0.2s, transform 0.1s" }}
        >
          <AlertTriangle size={13} className="flex-shrink-0 text-[#D7BC7C]" />
          <span className="text-[12.5px] font-semibold tracking-wide">Low Stock Reminder</span>
          <span className="bg-white/10 border border-white/15 text-[#F2DFAF] text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center leading-none">
            {alerts.length}
          </span>
          <ChevronUp size={13} className="flex-shrink-0 opacity-70" />
        </button>
      ) : (
        /* ── Expanded card ── */
        <div
          className="bg-white rounded-[18px] shadow-[0_20px_60px_-18px_rgba(29,42,37,0.28)] border border-[#E3E0D8] overflow-hidden"
          style={{ width: "312px" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E9E1D1] bg-[#FBF8F0]">
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-[10px] bg-[#F4E9CF] border border-[#E6D3A8] flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={13} className="text-[#9A6C25]" />
              </div>
              <div>
                <div className="text-[12.5px] font-bold text-[#173C33] leading-none">Low Stock Reminder</div>
                <div className="text-[10px] text-[#9A6C25] mt-0.5">
                  {alerts.length} item{alerts.length !== 1 ? "s" : ""} need restocking
                </div>
              </div>
            </div>
            <button
              onClick={toggle}
              className="h-7 w-7 rounded-[9px] flex items-center justify-center text-[#9A6C25] hover:bg-[#F4E9CF] transition-colors"
              title="Minimize"
            >
              <ChevronDown size={14} />
            </button>
          </div>

          {/* Items */}
          <div className="overflow-y-auto divide-y divide-[#EEECE6]" style={{ maxHeight: "260px" }}>
            {alerts.map((n) => {
              const d = parseND(n.data);
              const isOut = n.type === "out_of_stock";
              const stockQty = d.stock_qty ?? d.qty_after;
              const unit = d.unit || "pcs";
              const productName = n.title
                .replace("Low Stock: ", "")
                .replace("Out of Stock: ", "")
                .replace("Low Stock Alert: ", "");
              return (
                <div key={n.id} className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[#FAF9F6] ${isOut ? "bg-red-50/20" : ""}`}>
                  <div className={`h-8 w-8 rounded-[10px] flex items-center justify-center flex-shrink-0 mt-0.5 border ${isOut ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100"}`}>
                    <Package size={13} className={isOut ? "text-red-500" : "text-amber-600"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-[#17231F] leading-tight truncate">{productName}</div>
                    <div className="text-[11px] text-[#737873] mt-0.5 leading-tight line-clamp-1">{n.message}</div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${isOut ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {isOut ? "Out of stock" : stockQty != null ? `${stockQty} ${unit} left` : "Low stock"}
                      </span>
                      {d.threshold != null && (
                        <span className="text-[10px] text-[#A0A49F]">min {d.threshold}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-[#E9E7E0] bg-[#FAF9F6] flex items-center justify-between">
            <Link to="/inventory" className="text-[11px] text-[#8B682C] hover:text-[#5E481F] font-semibold flex items-center gap-1 transition-colors">
              View Inventory <ArrowRight size={11} />
            </Link>
            <span className="text-[10px] text-[#A0A49F]">refreshes every 30s</span>
          </div>
        </div>
      )}
    </div>
  );
}

async function safeFetch(path, fallback) {
  try { const { data } = await api.get(path); return data; } catch { return fallback; }
}

// ─── Gold Rate Bar ────────────────────────────────────────────────────────────
const RATE_FIELDS = [
  { label: "24K Gold",    field: "gold_24k" },
  { label: "22K Gold",    field: "gold_22k" },
  { label: "18K Gold",    field: "gold_18k" },
  { label: "Pure Silver", field: "pure_silver" },
  { label: "Silver",      field: "silver" },
];

function RateItem({ label, value }) {
  return (
    <div className="min-w-0 bg-white/[0.05] px-2 py-2.5 text-center transition-colors duration-200 hover:bg-white/[0.09] sm:px-3">
      <div className="mb-1.5 truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#DCC79A]">{label}</div>
      <span className="font-display text-[17px] font-semibold leading-none tabular-nums text-[#FFF8E6]">{fmtINR(value)}</span>
      <div className="mt-1 text-[8.5px] uppercase tracking-[0.14em] text-[#DCC79A]/50">per gram</div>
    </div>
  );
}

function EditRatesModal({ open, goldRate, onClose, onSave }) {
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  // Same karat/fineness auto-fill as Settings → Gold Rate: typing 24K/999
  // derives the remaining purities, but once a derived field is hand-edited
  // it's left alone on further base-rate edits instead of being overwritten.
  const [touched, setTouched] = useState({});
  useEffect(() => {
    if (open) {
      setDraft(Object.fromEntries(RATE_FIELDS.map(({ field }) => [field, goldRate?.[field] ?? ""])));
      setTouched({});
    }
  }, [open, goldRate]);
  useEffect(() => { if (!open) return; const fn = (e) => e.key === "Escape" && onClose(); window.addEventListener("keydown", fn); return () => window.removeEventListener("keydown", fn); }, [open, onClose]);
  if (!open) return null;
  const handleFieldChange = (field, raw, numeric) => {
    if (field === "gold_24k") {
      setDraft((d) => ({
        ...d,
        gold_24k: raw,
        ...(touched.gold_22k ? {} : { gold_22k: Math.round((22 / 24) * numeric * 100) / 100 }),
        ...(touched.gold_18k ? {} : { gold_18k: Math.round((18 / 24) * numeric * 100) / 100 }),
      }));
      return;
    }
    if (field === "pure_silver") {
      setDraft((d) => ({
        ...d,
        pure_silver: raw,
        ...(touched.silver ? {} : { silver: Math.round((925 / 999) * numeric * 100) / 100 }),
      }));
      return;
    }
    setDraft((d) => ({ ...d, [field]: raw }));
    setTouched((t) => ({ ...t, [field]: true }));
  };
  const handleSave = async () => {
    setSaving(true);
    try { const payload = Object.fromEntries(RATE_FIELDS.map(({ field }) => [field, parseMoneyInput(draft[field])])); await onSave(payload); onClose(); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(18,29,25,0.48)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm bg-[#FFFEFB] rounded-[18px] shadow-[0_24px_70px_-20px_rgba(18,38,31,0.38)] border border-[#E4E0D6]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#ECE8DF]">
          <div><h2 className="font-display text-[16px] font-semibold text-[#173C33]">Edit Gold Rates</h2><p className="text-[11px] text-[#747A75] mt-0.5">Rates are per gram, in ₹.</p></div>
          <button onClick={onClose} className="h-8 w-8 rounded-[9px] flex items-center justify-center text-[#8B918C] hover:bg-[#F3F1EA] hover:text-[#173C33] transition-colors" aria-label="Close rate editor"><X size={16} strokeWidth={1.5} /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          {RATE_FIELDS.map(({ label, field }) => (
            <div key={field} className="flex items-center justify-between gap-4">
              <label className="text-[12.5px] text-[#4E5752]">{label}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#9A8A65]">₹</span>
                <MoneyInput value={draft[field] ?? ""} onValueChange={(raw, numeric) => handleFieldChange(field, raw, numeric)} className="w-32 border border-[#DFDDD5] rounded-[10px] pl-6 pr-2.5 py-1.5 text-[13px] text-right font-mono text-[#17231F] focus:outline-none focus:border-[#B28B48] focus:ring-1 focus:ring-[#B28B48]/25" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#ECE8DF] bg-[#FBFAF6] rounded-b-[18px]">
          <button onClick={onClose} className="btn-secondary text-[12.5px]">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary inline-flex items-center gap-1.5 text-[12.5px]"><Check size={13} strokeWidth={2} /> {saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </div>
  );
}

function GoldRatesBar({ goldRate, onSave }) {
  const [modalOpen, setModalOpen] = useState(false);
  const gr = goldRate ?? {};
  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="group relative flex w-full cursor-pointer flex-col items-stretch overflow-hidden rounded-[18px] border border-[#1D4A3B] bg-[linear-gradient(116deg,#255744_0%,#1B4538_32%,#143528_62%,#0E2A22_100%)] px-4 py-4 text-left shadow-[0_20px_46px_-28px_rgba(11,38,30,0.8)] transition-[border-color,box-shadow] duration-200 hover:border-[#37695A] hover:shadow-[0_24px_54px_-28px_rgba(11,38,30,0.85)] md:flex-row md:items-center md:gap-6 md:px-6 md:py-5"
        data-testid={T.goldRateWidget}
      >
        {/* layered depth: champagne bloom, silk texture, base vignette */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(115%_150%_at_8%_-10%,rgba(230,203,143,0.26),transparent_56%)]" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-70 [background-image:repeating-linear-gradient(114deg,rgba(255,255,255,0.032)_0px,rgba(255,255,255,0.032)_1px,transparent_1px,transparent_7px)]" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,rgba(232,214,166,0.34),rgba(232,214,166,0)_78%)]" />

        {/* gold bullion visual — left side */}
        <span aria-hidden="true" className="pointer-events-none relative z-10 hidden h-[86px] w-[112px] flex-shrink-0 sm:block">
          <BullionArt metal="gold" className="h-full w-full" />
        </span>

        <div className="relative z-10 order-1 min-w-0 md:order-none">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#F0DDAF]">Live Gold Rates</div>
          <div aria-hidden="true" className="mt-1.5 h-px w-16 bg-[linear-gradient(90deg,#E4C98C,rgba(228,201,140,0))]" />
          <div className="mt-1.5 flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#8FB8A7] opacity-60" /><span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[#8FB8A7]" /></span>
            <span className="text-[9.5px] text-[#DCC79A]/60">Today</span>
          </div>
        </div>

        <div className="order-2 col-span-2 grid min-w-0 flex-1 grid-cols-2 gap-px overflow-hidden rounded-[12px] border border-white/10 bg-white/10 sm:grid-cols-5 md:order-none">
          {RATE_FIELDS.map(({ label, field }) => <RateItem key={field} label={label} value={gr[field]} />)}
        </div>
        <Edit2 size={12} strokeWidth={1.5} className="order-3 flex-shrink-0 self-end text-[#DCC79A]/60 transition-colors group-hover:text-[#F0DDAF] md:order-none md:self-auto" />
      </button>
      <EditRatesModal open={modalOpen} goldRate={gr} onClose={() => setModalOpen(false)} onSave={onSave} />
    </>
  );
}

// ─── Metal Summary Card ───────────────────────────────────────────────────────
function MetalCard({ metal, todayGross, todayNet, todayPieces, monthGross, monthNet, monthPieces }) {
  const isGold = metal === "gold";
  return (
    <article
      className={`relative overflow-hidden rounded-[18px] border p-5 shadow-[0_14px_34px_-26px_rgba(32,43,38,0.45)] transition-[border-color,box-shadow] duration-200 ${
        isGold
          ? "border-[#E7D5AA] bg-[linear-gradient(148deg,#FEFBF4_0%,#FAF4E6_50%,#F3E7CF_100%)]"
          : "border-[#D7E0E4] bg-[linear-gradient(148deg,#FBFDFE_0%,#F2F7F9_50%,#E7EFF3_100%)]"
      }`}
    >
      {/* metal atmosphere + bar artwork on the right, blended into the surface */}
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 ${
          isGold
            ? "bg-[radial-gradient(85%_125%_at_100%_50%,rgba(214,168,74,0.22),transparent_62%)]"
            : "bg-[radial-gradient(85%_125%_at_100%_50%,rgba(126,158,175,0.2),transparent_62%)]"
        }`}
      />
      <span aria-hidden="true" className="pointer-events-none absolute -right-7 top-1/2 hidden h-[200%] w-[48%] -translate-y-1/2 sm:block">
        <BullionArt metal={metal} className="h-full w-full" />
      </span>

      <div className="relative z-10">
        {/* Header */}
        <div className="mb-5 flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-[12px] border text-white shadow-[0_8px_18px_-12px_rgba(32,43,38,0.6)] ${
              isGold
                ? "border-[#A87A29] bg-[linear-gradient(140deg,#E4C07C,#B28B48)]"
                : "border-[#607681] bg-[linear-gradient(140deg,#93A5AE,#6E838E)]"
            }`}
          >
            <span className="font-display text-[15px] font-semibold">{isGold ? "Au" : "Ag"}</span>
          </div>
          <div>
            <div className={`font-display text-[16px] font-semibold ${isGold ? "text-[#6E5420]" : "text-[#314A54]"}`}>{isGold ? "Gold" : "Silver"} Sales</div>
            <div className="text-[11px] text-[#747975]">Gross & net weight summary</div>
          </div>
        </div>

        {/* Today / Month columns */}
        <div className="grid grid-cols-2 gap-3">
          {/* Today */}
          <div className={`rounded-[12px] border p-3.5 backdrop-blur-[2px] ${isGold ? "border-[#E9DDBF] bg-white/70" : "border-[#DCE4E7] bg-white/75"}`}>
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6F7671]">Today</div>
            <div className="space-y-2.5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#969C97]">Gross Wt</div>
                <div className={`font-display text-[21px] font-semibold leading-tight tabular-nums ${isGold ? "text-[#76581D]" : "text-[#314A54]"}`}>{todayGross.toFixed(3)} <span className="font-sans text-[12px] font-normal text-[#7B817C]">g</span></div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#969C97]">Net Wt</div>
                <div className={`font-display text-[17px] font-semibold leading-tight tabular-nums ${isGold ? "text-[#8A6722]" : "text-[#49636E]"}`}>{todayNet.toFixed(3)} <span className="font-sans text-[11px] font-normal text-[#7B817C]">g</span></div>
              </div>
              <div className={`border-t pt-1 text-[11px] font-medium ${isGold ? "border-[#E7D7B2] text-[#806020]" : "border-[#D3DEE2] text-[#4B6671]"}`}>{todayPieces} piece{todayPieces !== 1 ? "s" : ""}</div>
            </div>
          </div>

          {/* This Month */}
          <div className={`rounded-[12px] border p-3.5 backdrop-blur-[2px] ${isGold ? "border-[#EEE3CB] bg-white/55" : "border-[#E0E7E9] bg-white/60"}`}>
            <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6F7671]">This Month</div>
            <div className="space-y-2.5">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#969C97]">Gross Wt</div>
                <div className={`font-display text-[21px] font-semibold leading-tight tabular-nums ${isGold ? "text-[#76581D]" : "text-[#314A54]"}`}>{monthGross.toFixed(3)} <span className="font-sans text-[12px] font-normal text-[#7B817C]">g</span></div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-[#969C97]">Net Wt</div>
                <div className={`font-display text-[17px] font-semibold leading-tight tabular-nums ${isGold ? "text-[#8A6722]" : "text-[#49636E]"}`}>{monthNet.toFixed(3)} <span className="font-sans text-[11px] font-normal text-[#7B817C]">g</span></div>
              </div>
              <div className={`border-t pt-1 text-[11px] font-medium ${isGold ? "border-[#E7D7B2] text-[#806020]" : "border-[#D3DEE2] text-[#4B6671]"}`}>{monthPieces} piece{monthPieces !== 1 ? "s" : ""}</div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone }) {
  const t = tone ? kpiTones[tone] : null;
  return (
    <article
      className={`relative min-w-0 overflow-hidden rounded-[16px] border p-5 shadow-[0_14px_32px_-26px_rgba(28,40,35,0.5)] transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 ${
        t ? t.surface : "border-[#E5E2DA] bg-white hover:border-[#D4D9D4]"
      }`}
    >
      {t && <span aria-hidden="true" className={`pointer-events-none absolute inset-0 ${t.glow}`} />}
      <div className="relative z-10 flex items-center gap-3">
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border ${t ? t.icon : "border-[#DCE4DF] bg-[#F3F7F4]"}`}>
          <Icon size={15} strokeWidth={1.6} className={t ? t.iconFg : "text-[#315B4E]"} />
        </div>
        <div className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${t ? t.label : "text-[#747A76]"}`}>{label}</div>
      </div>
      <div className={`relative z-10 mt-4 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em] tabular-nums ${t ? t.value : "text-[#18231F]"}`}>{value}</div>
      <div className={`relative z-10 mt-1.5 text-[11px] ${t ? t.detail : "text-[#818681]"}`}>{detail}</div>
    </article>
  );
}

// ─── Daily Billing Bar Chart ──────────────────────────────────────────────────
const BillingTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const sales = payload.find((p) => p.dataKey === "sales")?.value ?? 0;
  const count = payload.find((p) => p.dataKey === "count")?.payload?.count ?? 0;
  return (
    <div className="bg-white text-[#1D2924] rounded-[12px] p-3 text-[11px] border border-[#DDE2DE] min-w-[160px] shadow-[0_12px_30px_-16px_rgba(22,45,36,0.35)]">
      <div className="font-semibold mb-2 text-[#5F6B65]">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[#315B4E]">Billing</span>
        <span className="font-mono font-medium tabular-nums">{fmtINR(sales)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 mt-1.5 pt-1.5 border-t border-[#EEF0EC]">
        <span className="text-[#8A918C]">Bills</span>
        <span className="font-mono font-medium tabular-nums">{Number(count) || 0}</span>
      </div>
    </div>
  );
};

function BillingTrendChart({ data }) {
  const rows = Array.isArray(data) ? data : [];
  const hasSales = rows.some((d) => Number(d.sales) > 0 || Number(d.count) > 0);
  if (!rows.length || !hasSales) {
    return (
      <div className="h-[230px] flex flex-col items-center justify-center gap-2 text-[12px] text-[#7C837E]">
        <TrendingUp size={18} strokeWidth={1.4} className="text-[#9AA69F]" />
        No billings in the last 7 days.
      </div>
    );
  }
  return (
    <div className="w-full min-w-0 h-[230px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 10, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="#E7E8E3" strokeDasharray="2 5" vertical={false} />
          <XAxis dataKey="date" stroke="#A3A9A4" fontSize={10} tickLine={false} axisLine={{ stroke: "#E0E3DF" }} tickMargin={10} />
          <YAxis
            stroke="#A3A9A4"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={[0, "auto"]}
            tickFormatter={(v) => fmtINR(v, { decimals: 0 })}
            tickMargin={8}
          />
          <Tooltip content={<BillingTooltip />} cursor={{ fill: "rgba(33,78,66,0.05)" }} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 12, color: "#68716C" }} />
          <Bar dataKey="sales" name="Billing ₹" fill="#234F43" radius={[4, 4, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Purity Donut ─────────────────────────────────────────────────────────────
const PURITY_COLORS = { "24K Gold": "#234F43", "22K Gold": "#5D7E71", "18K Gold": "#C09A55", "Silver": "#8A9BA3" };
const FALLBACK_COLORS = ["#234F43", "#5D7E71", "#C09A55", "#8A9BA3", "#B8B2A5"];

function PurityDonut({ data }) {
  if (!data || data.length === 0) return <div className="h-48 flex items-center justify-center text-[12px] text-[#7C837E]">No data this month.</div>;
  const total = data.reduce((s, d) => s + d.gross_weight, 0);
  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="gross_weight" nameKey="purity" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}>
            {data.map((entry, i) => <Cell key={i} fill={PURITY_COLORS[entry.purity] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#FFFFFF", color: "#1D2924", border: "1px solid #DDE2DE", borderRadius: 12, fontSize: 11, boxShadow: "0 12px 30px -16px rgba(22,45,36,0.35)" }}
            formatter={(v, name) => [`${Number(v).toFixed(3)} g`, name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2.5 mt-2">
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.gross_weight / total) * 100) : 0;
          const color = PURITY_COLORS[d.purity] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
          return (
            <div key={d.purity} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-[11.5px] text-[#505A55] flex-1">{d.purity}</span>
              <span className="text-[11px] font-mono text-[#27332E] tabular-nums">{Number(d.gross_weight).toFixed(3)} g</span>
              <span className="text-[10px] text-[#939994] w-8 text-right tabular-nums">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top Categories ────────────────────────────────────────────────────────────
function CategoryBars({ categories }) {
  if (!categories || categories.length === 0) return <div className="text-[12px] text-[#7C837E] py-6 text-center">No category data this month.</div>;
  const max = Math.max(...categories.map((c) => c.total), 1);
  return (
    <div className="space-y-3.5">
      {categories.map(({ name, total }, i) => {
        const pct = Math.round((total / max) * 100);
        const color = ["#234F43", "#5D7E71", "#B28B48", "#899A91", "#B7B0A2"][i % 5];
        return (
          <div key={name}>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-[12px] font-medium text-[#27332E] truncate">{name}</span>
              <span className="text-[11.5px] text-[#59635E] font-mono tabular-nums">{fmtINR(total)}</span>
            </div>
            <div className="h-1.5 w-full bg-[#ECEEE9] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const { isEnabled } = useApplicationFeatures();
  const [includeHidden, setIncludeHidden] = useDashboardHiddenUnlocked();
  const { handleTitleClick, lockButton, dialog, titleHint } = useHiddenBillUnlockGate(
    includeHidden,
    setIncludeHidden,
  );
  const [data, setData]                   = useState(null);
  const [loading, setLoading]             = useState(true);
  const [goldRateLocal, setGoldRateLocal] = useState(null);
  const [rateSaving, setRateSaving]       = useState(false);
  useEffect(() => {
    let cancelled = false, attempts = 0;
    const params = { include_hidden: includeHidden ? 1 : undefined };
    const load = () => {
      api.get("/dashboard/summary", { params })
        .then(({ data: d }) => { if (cancelled) return; setData(d); setGoldRateLocal(asObject(d.gold_rate)); setLoading(false); })
        .catch((err) => {
          if (cancelled) return;
          const status = err?.response?.status;
          if (status === 401 || status === 403) { setLoading(false); return; }
          attempts += 1;
          if (attempts < 12) { setTimeout(load, 1000); return; }
          setLoading(false);
        });
    };
    load();
    const unsub = window.jewelleryCRM?.onBackendReady?.(() => { if (!cancelled) load(); });
    return () => { cancelled = true; unsub?.(); };
  }, [includeHidden]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail?.type;
      if (['invoice:created', 'product:changed', 'order:changed'].includes(t)) {
        api.get("/dashboard/summary", { params: { include_hidden: includeHidden ? 1 : undefined } })
          .then(({ data: d }) => { setData(d); setGoldRateLocal(asObject(d.gold_rate)); }).catch(() => {});
      }
    };
    window.addEventListener('realtime', handler);
    return () => window.removeEventListener('realtime', handler);
  }, [includeHidden]);

  const handleRateSave = useCallback(async (payload) => {
    setRateSaving(true);
    try { const { data: d } = await api.put("/settings/gold-rate", { ...payload, source: "dashboard" }); setGoldRateLocal(d); toast.success("Gold rates updated."); }
    catch (err) { toast.error(formatApiError(err)); throw err; }
    finally { setRateSaving(false); }
  }, []);

  const firstName = user?.name?.split(" ")[0] || "there";
  const supportingLine = getDashboardDayLine();
  const surfaceClassName = includeHidden
    ? hiddenUnlockBleedClass(includeHidden)
    : "-mx-5 -my-5 min-h-[calc(100vh-4rem)] bg-[#F7F5F0] px-5 py-5 xl:-mx-7 xl:-my-7 xl:px-7 xl:py-7";

  if (loading) {
    return (
      <>
      <div className={surfaceClassName}>
        <div className="max-w-[1400px] space-y-5">
          <DashboardHeader
            firstName={firstName}
            supportingLine={supportingLine}
            onTitleClick={handleTitleClick}
            titleHint={titleHint}
            lockButton={lockButton}
          />
          <div className="flex items-center justify-between gap-4 rounded-[14px] border border-[#E4E1D9] bg-white/70 px-4 py-3">
            <PageLoadingBadge />
            <span className="hidden text-[11px] text-[#8A908B] sm:inline">Preparing your showroom overview</span>
          </div>
          <div className="h-[86px] shimmer rounded-[18px]" />
          <KPISkeleton count={4} />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4"><SectionSkeleton height="h-60" /><SectionSkeleton height="h-60" /><SectionSkeleton height="h-60" /></div>
        </div>
      </div>
      {dialog}
      </>
    );
  }

  if (!data) {
    return (
      <>
      <div className={surfaceClassName}>
        <div className="max-w-[1400px]">
          <DashboardHeader
            firstName={firstName}
            supportingLine={supportingLine}
            onTitleClick={handleTitleClick}
            titleHint={titleHint}
            lockButton={lockButton}
          />
          <div role="alert" className="rounded-[18px] border border-[#E4D8D2] bg-white px-6 py-12 text-center shadow-[0_12px_34px_-26px_rgba(50,40,35,0.4)]">
            <div className="mx-auto h-10 w-10 rounded-[12px] border border-[#E7D6CC] bg-[#FBF2EC] flex items-center justify-center">
              <AlertTriangle size={17} strokeWidth={1.6} className="text-[#A35F3C]" />
            </div>
            <div className="mt-4 text-[13px] font-semibold text-[#3A332F]">Unable to load dashboard. Please refresh.</div>
          </div>
        </div>
      </div>
      {dialog}
      </>
    );
  }

  const { kpis, trend = [], purity_breakdown = [], low_stock = [], recent_invoices = [], top_categories = [] } = data;
  const gr = goldRateLocal ?? {};

  return (
    <>
    <div className={surfaceClassName}>
    <div className="max-w-[1400px] space-y-5">

      {/* Header */}
      <DashboardHeader
        firstName={firstName}
        supportingLine={supportingLine}
        onTitleClick={handleTitleClick}
        titleHint={titleHint}
        lockButton={lockButton}
      />

      {/* Live Gold Rates */}
      <GoldRatesBar goldRate={gr} onSave={handleRateSave} />

      {/* Revenue KPIs — four differentiated soft-gradient surfaces */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          tone="gold"
          icon={IndianRupee}
          label="Today Sales"
          value={fmtINR(kpis.today_sales ?? 0)}
          detail={`${kpis.today_invoices ?? 0} invoice${(kpis.today_invoices ?? 0) !== 1 ? "s" : ""}`}
        />
        <MetricCard
          tone="green"
          icon={CalendarDays}
          label="This Month"
          value={fmtINR(kpis.month_sales ?? 0)}
          detail={`${kpis.month_invoices ?? 0} invoice${(kpis.month_invoices ?? 0) !== 1 ? "s" : ""}`}
        />
        <MetricCard
          tone="blue"
          icon={Coins}
          label="Today Cash"
          value={fmtINR(kpis.today_cash ?? 0)}
          detail="Cash collections"
        />
        <MetricCard
          tone="lavender"
          icon={TrendingUp}
          label="Avg Daily"
          value={fmtINR(kpis.avg_daily_sales ?? 0)}
          detail="This month so far"
        />
      </div>

      {/* ── Metal Summary Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MetalCard
          metal="gold"
          todayGross={kpis.today_gold_gross ?? 0}
          todayNet={kpis.today_gold_net ?? 0}
          todayPieces={kpis.today_gold_pieces ?? 0}
          monthGross={kpis.month_gold_gross ?? 0}
          monthNet={kpis.month_gold_net ?? 0}
          monthPieces={kpis.month_gold_pieces ?? 0}
        />
        <MetalCard
          metal="silver"
          todayGross={kpis.today_silver_gross ?? 0}
          todayNet={kpis.today_silver_net ?? 0}
          todayPieces={kpis.today_silver_pieces ?? 0}
          monthGross={kpis.month_silver_gross ?? 0}
          monthNet={kpis.month_silver_net ?? 0}
          monthPieces={kpis.month_silver_pieces ?? 0}
        />
      </div>

      {/* ── Daily Billing + Purity Breakdown ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Bar chart — 2/3 width */}
        <section className="lg:col-span-2 min-w-0 rounded-[18px] border border-[#E4E2DB] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(28,40,35,0.42)]">
          <div className="mb-3">
            <div className="font-display text-[14px] font-semibold text-[#20352E]">Daily Billing — Last 7 Days</div>
            <div className="text-[11px] text-[#7C837E] mt-0.5">Invoice total billed each day</div>
          </div>
          <BillingTrendChart data={trend} />
        </section>

        {/* Purity donut — 1/3 width */}
        <section className="rounded-[18px] border border-[#E4E2DB] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(28,40,35,0.42)]">
          <div className="mb-3">
            <div className="font-display text-[14px] font-semibold text-[#20352E]">Purity Breakdown</div>
            <div className="text-[11px] text-[#7C837E] mt-0.5">By gross weight this month</div>
          </div>
          <PurityDonut data={purity_breakdown} />
        </section>
      </div>

      {/* ── Bottom Row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">

        {/* Recent Transactions */}
        <section className="rounded-[18px] border border-[#E4E2DB] bg-white overflow-hidden shadow-[0_10px_30px_-24px_rgba(28,40,35,0.42)]" data-testid={T.recentInvoicesTable}>
          <div className="px-5 py-4 border-b border-[#E9E7E0] flex items-center justify-between gap-3">
            <div><div className="font-display text-[14px] font-semibold text-[#20352E]">Recent Transactions</div><div className="text-[11px] text-[#7C837E] mt-0.5">Latest 5 invoices</div></div>
            {isEnabled("reports") && (
              <Link to="/reports" className="text-[11.5px] text-[#356052] hover:text-[#173C33] inline-flex items-center gap-1 font-medium">View all <ArrowRight size={11} strokeWidth={1.5} /></Link>
            )}
          </div>
          {recent_invoices.length === 0 ? (
            <div className="p-7 text-center text-[12px] text-[#7C837E]">No invoices yet.</div>
          ) : (
            <div className="divide-y divide-[#EEECE6]">
              {recent_invoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[#FAF9F6]">
                  <div className="h-8 w-8 rounded-[10px] bg-[#F3F7F4] border border-[#DCE4DF] flex items-center justify-center flex-shrink-0"><IndianRupee size={12} strokeWidth={1.5} className="text-[#356052]" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] font-medium text-[#25312C] truncate">{inv.customer_name || "Walk-in"}</span>
                      <span className="text-[12px] font-semibold text-[#25312C] ml-2 flex-shrink-0 font-mono tabular-nums">{fmtINR(inv.grand_total)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 mt-0.5">
                      <span className="text-[10.5px] font-mono text-[#969C97]">{inv.invoice_no}</span>
                      {inv.payment_mode && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${inv.payment_mode === "cash" ? "bg-[#F1F4F1] text-[#52615A] border-[#DDE4DF]" : inv.payment_mode === "card" ? "bg-[#EFF5F7] text-[#3E6474] border-[#CFDFE5]" : "bg-[#F5F2F8] text-[#6B557A] border-[#E1D8E8]"}`}>{inv.payment_mode}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Top Selling Categories */}
        <section className="rounded-[18px] border border-[#E4E2DB] bg-white p-5 shadow-[0_10px_30px_-24px_rgba(28,40,35,0.42)]">
          <div className="mb-4"><div className="font-display text-[14px] font-semibold text-[#20352E]">Top Selling Categories</div><div className="text-[11px] text-[#7C837E] mt-0.5">By sales this month</div></div>
          <CategoryBars categories={top_categories} />
        </section>

        {/* Low Stock Alerts */}
        <section className="rounded-[18px] border border-[#E4E2DB] bg-white overflow-hidden shadow-[0_10px_30px_-24px_rgba(28,40,35,0.42)]" data-testid={T.lowStockList}>
          <div className="px-5 py-4 border-b border-[#E9E7E0]">
            <div className="flex items-center gap-2"><div className="h-7 w-7 rounded-[9px] border border-[#E9D7C5] bg-[#FBF3EA] flex items-center justify-center"><AlertTriangle size={13} strokeWidth={1.5} className="text-[#A35F3C]" /></div><div className="font-display text-[14px] font-semibold text-[#20352E]">Low Stock Alerts</div></div>
            <div className="text-[11px] text-[#7C837E] mt-2">Sub-categories at or below their Catalog threshold.</div>
          </div>
          {low_stock.length === 0 ? (
            <div className="p-7 text-[12px] text-[#7C837E] text-center">All sub-categories are well stocked.</div>
          ) : (
            <ul className="divide-y divide-[#EEECE6]">
              {low_stock.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[#FAF9F6]">
                  <div className="h-8 w-8 rounded-[10px] bg-[#F7F5F0] border border-[#E5E2DA] flex items-center justify-center flex-shrink-0"><Sparkles size={12} className="text-[#9B7A40]" strokeWidth={1.5} /></div>
                  <div className="flex-1 min-w-0"><div className="text-[12px] font-medium text-[#25312C] truncate">{p.name}</div><div className="text-[10.5px] text-[#858B86]">Threshold {p.low_stock_threshold}</div></div>
                  <div className="chip chip-warning flex-shrink-0 text-[10.5px]">{p.stock_qty} pcs</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
    </div>

    {/* Floating low-stock reminder panel — inventory-only content */}
    {isEnabled("inventory") && <LowStockPanel />}
    {dialog}
    </>
  );
}
