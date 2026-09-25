import { useEffect, useState, useCallback, useRef } from "react";
import { KPISkeleton, SectionSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  AlertTriangle, Coins, Sparkles, ArrowRight,
  Edit2, Check, X, IndianRupee, Package, ChevronDown, ChevronUp,
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

function parseND(raw) {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw;
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
          className="flex items-center gap-2 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white pl-4 pr-3 py-2.5 rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
          style={{ transition: "background 0.15s, box-shadow 0.2s, transform 0.1s" }}
        >
          <AlertTriangle size={13} className="flex-shrink-0" />
          <span className="text-[12.5px] font-semibold tracking-wide">Low Stock Reminder</span>
          <span className="bg-white/25 border border-white/30 text-white text-[10px] font-bold px-2 py-0.5 rounded-full min-w-[20px] text-center leading-none">
            {alerts.length}
          </span>
          <ChevronUp size={13} className="flex-shrink-0 opacity-70" />
        </button>
      ) : (
        /* ── Expanded card ── */
        <div
          className="bg-white rounded-2xl shadow-2xl border border-[#E5E7EB] overflow-hidden"
          style={{ width: "312px", boxShadow: "0 20px 60px -12px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.04)" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-amber-100"
            style={{ background: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)" }}>
            <div className="flex items-center gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center flex-shrink-0">
                <AlertTriangle size={13} className="text-amber-600" />
              </div>
              <div>
                <div className="text-[12.5px] font-bold text-amber-900 leading-none">Low Stock Reminder</div>
                <div className="text-[10px] text-amber-600 mt-0.5">
                  {alerts.length} item{alerts.length !== 1 ? "s" : ""} need restocking
                </div>
              </div>
            </div>
            <button
              onClick={toggle}
              className="h-7 w-7 rounded-lg flex items-center justify-center text-amber-600 hover:bg-amber-200 transition-colors"
              title="Minimize"
            >
              <ChevronDown size={14} />
            </button>
          </div>

          {/* Items */}
          <div className="overflow-y-auto divide-y divide-[#F3F4F6]" style={{ maxHeight: "260px" }}>
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
                <div key={n.id} className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[#FAFAFA] ${isOut ? "bg-red-50/20" : ""}`}>
                  <div className={`h-8 w-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5 border ${isOut ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100"}`}>
                    <Package size={13} className={isOut ? "text-red-500" : "text-amber-600"} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold text-[#0A0A0A] leading-tight truncate">{productName}</div>
                    <div className="text-[11px] text-[#737373] mt-0.5 leading-tight line-clamp-1">{n.message}</div>
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${isOut ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                        {isOut ? "Out of stock" : stockQty != null ? `${stockQty} ${unit} left` : "Low stock"}
                      </span>
                      {d.threshold != null && (
                        <span className="text-[10px] text-[#a3a3a3]">min {d.threshold}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 border-t border-[#E5E7EB] bg-[#FAFAFA] flex items-center justify-between">
            <Link to="/inventory" className="text-[11px] text-amber-700 hover:text-amber-900 font-semibold flex items-center gap-1 transition-colors">
              View Inventory <ArrowRight size={11} />
            </Link>
            <span className="text-[10px] text-[#a3a3a3]">refreshes every 30s</span>
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
    <div className="flex flex-col items-center gap-0 px-6 border-l border-[#FDE68A] first:border-l-0">
      <div className="text-[10px] uppercase tracking-widest text-[#92400E] font-bold mb-1">{label}</div>
      <span className="font-bold text-[18px] text-[#78350F] leading-none">{fmtINR(value)}</span>
      <div className="text-[9px] text-[#B45309]/60 uppercase tracking-wider mt-0.5">per gram</div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(10,10,10,0.4)" }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl border border-[#F0F0F0]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#F0F0F0]">
          <div><h2 className="text-[14px] font-semibold text-[#0A0A0A]">Edit Gold Rates</h2><p className="text-[11px] text-[#737373] mt-0.5">Rates are per gram, in ₹.</p></div>
          <button onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]"><X size={16} strokeWidth={1.5} /></button>
        </div>
        <div className="px-6 py-5 space-y-3">
          {RATE_FIELDS.map(({ label, field }) => (
            <div key={field} className="flex items-center justify-between gap-4">
              <label className="text-[12.5px] text-[#525252]">{label}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-[#a3a3a3]">₹</span>
                <MoneyInput value={draft[field] ?? ""} onValueChange={(raw, numeric) => handleFieldChange(field, raw, numeric)} className="w-32 border border-[#E5E7EB] rounded-lg pl-6 pr-2.5 py-1.5 text-[13px] text-right font-mono text-[#0A0A0A] focus:outline-none focus:border-[#B49042] focus:ring-1 focus:ring-[#B49042]/30" />
              </div>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-[#F0F0F0]">
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
      <button type="button" onClick={() => setModalOpen(true)} className="w-full text-left rounded-2xl border border-[#FDE68A] px-6 py-4 flex items-center gap-6 hover:border-[#F59E0B] transition-colors cursor-pointer" style={{ background: "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)" }} data-testid={T.goldRateWidget}>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-[#F59E0B] to-[#D97706] flex items-center justify-center shadow-sm"><Coins size={16} strokeWidth={1.5} className="text-white" /></div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#92400E] font-bold">Live Gold Rates</div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" /></span>
              <span className="text-[9.5px] text-[#78350F]/60">Today</span>
            </div>
          </div>
        </div>
        <div className="flex items-center flex-1">{RATE_FIELDS.map(({ label, field }) => <RateItem key={field} label={label} value={gr[field]} />)}</div>
        <Edit2 size={12} strokeWidth={1.5} className="text-[#B45309]/60 flex-shrink-0" />
      </button>
      <EditRatesModal open={modalOpen} goldRate={gr} onClose={() => setModalOpen(false)} onSave={onSave} />
    </>
  );
}

// ─── Metal Summary Card ───────────────────────────────────────────────────────
function MetalCard({ metal, todayGross, todayNet, todayPieces, monthGross, monthNet, monthPieces }) {
  const isGold = metal === "gold";
  return (
    <div className={`rounded-2xl border p-5 ${isGold ? "border-[#F59E0B] bg-gradient-to-br from-[#FFFBEB] to-[#FEF9EC]" : "border-[#CBD5E1] bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9]"}`}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shadow-sm ${isGold ? "bg-gradient-to-br from-[#F59E0B] to-[#D97706]" : "bg-gradient-to-br from-[#64748B] to-[#475569]"}`}>
          <span className="text-white font-bold text-[15px]">{isGold ? "Au" : "Ag"}</span>
        </div>
        <div>
          <div className={`text-[15px] font-bold ${isGold ? "text-[#78350F]" : "text-[#1E293B]"}`}>{isGold ? "Gold" : "Silver"} Sales</div>
          <div className="text-[11px] text-[#737373]">Gross & net weight summary</div>
        </div>
      </div>

      {/* Today / Month columns */}
      <div className="grid grid-cols-2 gap-3">
        {/* Today */}
        <div className={`rounded-xl p-3.5 ${isGold ? "bg-[#FEF3C7]/60" : "bg-[#E2E8F0]/50"}`}>
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#737373] mb-3">Today</div>
          <div className="space-y-2.5">
            <div>
              <div className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Gross Wt</div>
              <div className={`text-[20px] font-bold leading-tight ${isGold ? "text-[#78350F]" : "text-[#1E293B]"}`}>{todayGross.toFixed(3)} <span className="text-[12px] font-normal text-[#737373]">g</span></div>
            </div>
            <div>
              <div className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Net Wt</div>
              <div className="text-[16px] font-semibold text-[#374151] leading-tight">{todayNet.toFixed(3)} <span className="text-[11px] font-normal text-[#737373]">g</span></div>
            </div>
            <div className={`text-[11px] font-medium pt-1 border-t ${isGold ? "border-[#FDE68A] text-[#92400E]" : "border-[#CBD5E1] text-[#475569]"}`}>{todayPieces} piece{todayPieces !== 1 ? "s" : ""}</div>
          </div>
        </div>

        {/* This Month */}
        <div className={`rounded-xl p-3.5 ${isGold ? "bg-[#FFFBEB]/60" : "bg-[#F8FAFC]/60"}`}>
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#737373] mb-3">This Month</div>
          <div className="space-y-2.5">
            <div>
              <div className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Gross Wt</div>
              <div className={`text-[20px] font-bold leading-tight ${isGold ? "text-[#78350F]" : "text-[#1E293B]"}`}>{monthGross.toFixed(3)} <span className="text-[12px] font-normal text-[#737373]">g</span></div>
            </div>
            <div>
              <div className="text-[10px] text-[#9CA3AF] uppercase tracking-wide">Net Wt</div>
              <div className="text-[16px] font-semibold text-[#374151] leading-tight">{monthNet.toFixed(3)} <span className="text-[11px] font-normal text-[#737373]">g</span></div>
            </div>
            <div className={`text-[11px] font-medium pt-1 border-t ${isGold ? "border-[#FDE68A] text-[#92400E]" : "border-[#CBD5E1] text-[#475569]"}`}>{monthPieces} piece{monthPieces !== 1 ? "s" : ""}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Daily Billing Bar Chart ──────────────────────────────────────────────────
const BillingTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const sales = payload.find((p) => p.dataKey === "sales")?.value ?? 0;
  const count = payload.find((p) => p.dataKey === "count")?.payload?.count ?? 0;
  return (
    <div className="bg-[#0A0A0A] text-white rounded-lg p-3 text-[11px] border border-[#262626] min-w-[150px]">
      <div className="font-medium mb-2 text-[#a3a3a3]">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <span className="text-[#D4A84B]">Billing</span>
        <span className="font-mono font-medium">{fmtINR(sales)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 mt-1">
        <span className="text-[#a3a3a3]">Bills</span>
        <span className="font-mono font-medium">{Number(count) || 0}</span>
      </div>
    </div>
  );
};

function BillingTrendChart({ data }) {
  const rows = Array.isArray(data) ? data : [];
  const hasSales = rows.some((d) => Number(d.sales) > 0 || Number(d.count) > 0);
  if (!rows.length || !hasSales) {
    return (
      <div className="h-[220px] flex items-center justify-center text-[12px] text-[#737373]">
        No billings in the last 7 days.
      </div>
    );
  }
  return (
    <div className="w-full min-w-0 h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="#F1F1F1" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" stroke="#a3a3a3" fontSize={10} tickLine={false} axisLine={false} />
          <YAxis
            stroke="#a3a3a3"
            fontSize={10}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={[0, "auto"]}
            tickFormatter={(v) => fmtINR(v, { decimals: 0 })}
          />
          <Tooltip content={<BillingTooltip />} cursor={{ fill: "#F9FAFB" }} />
          <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <Bar dataKey="sales" name="Billing ₹" fill="#B49042" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Purity Donut ─────────────────────────────────────────────────────────────
const PURITY_COLORS = { "24K Gold": "#F59E0B", "22K Gold": "#D97706", "18K Gold": "#B45309", "Silver": "#94A3B8" };
const FALLBACK_COLORS = ["#F59E0B", "#D97706", "#B45309", "#94A3B8", "#6B7280"];

function PurityDonut({ data }) {
  if (!data || data.length === 0) return <div className="h-48 flex items-center justify-center text-[12px] text-[#737373]">No data this month.</div>;
  const total = data.reduce((s, d) => s + d.gross_weight, 0);
  return (
    <div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} dataKey="gross_weight" nameKey="purity" cx="50%" cy="50%" innerRadius={50} outerRadius={75} paddingAngle={2}>
            {data.map((entry, i) => <Cell key={i} fill={PURITY_COLORS[entry.purity] || FALLBACK_COLORS[i % FALLBACK_COLORS.length]} />)}
          </Pie>
          <Tooltip
            contentStyle={{ background: "#fff", color: "#0A0A0A", border: "1px solid #E5E7EB", borderRadius: 6, fontSize: 11, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
            formatter={(v, name) => [`${Number(v).toFixed(3)} g`, name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-2 mt-1">
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.gross_weight / total) * 100) : 0;
          const color = PURITY_COLORS[d.purity] || FALLBACK_COLORS[i % FALLBACK_COLORS.length];
          return (
            <div key={d.purity} className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-[11.5px] text-[#525252] flex-1">{d.purity}</span>
              <span className="text-[11px] font-mono text-[#0A0A0A]">{Number(d.gross_weight).toFixed(3)} g</span>
              <span className="text-[10px] text-[#9CA3AF] w-8 text-right">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Top Categories ────────────────────────────────────────────────────────────
function CategoryBars({ categories }) {
  if (!categories || categories.length === 0) return <div className="text-[12px] text-[#737373] py-4">No category data this month.</div>;
  const max = Math.max(...categories.map((c) => c.total), 1);
  return (
    <div className="space-y-3">
      {categories.map(({ name, total }) => {
        const pct = Math.round((total / max) * 100);
        return (
          <div key={name}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-medium text-[#0A0A0A]">{name}</span>
              <span className="text-[11.5px] text-[#525252]">{fmtINR(total)}</span>
            </div>
            <div className="h-1.5 w-full bg-[#F5F5F5] rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #B49042, #F0C468)" }} />
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

  if (loading) {
    return (
      <>
      <div className={hiddenUnlockBleedClass(includeHidden)}>
      <div className="max-w-[1400px] space-y-4">
        <PageHeader
          title={`Namaste, ${user?.name?.split(" ")[0] || "there"}.`}
          subtitle="A calm summary of today's showroom activity."
          onTitleClick={handleTitleClick}
          titleHint={titleHint}
          actions={lockButton}
        />
        <PageLoadingBadge />
        <div className="h-14 shimmer rounded-2xl" />
        <KPISkeleton count={4} />
        <div className="grid grid-cols-3 gap-4"><SectionSkeleton height="h-56" /><SectionSkeleton height="h-56" /><SectionSkeleton height="h-56" /></div>
      </div>
      </div>
      {dialog}
      </>
    );
  }

  if (!data) {
    return (
      <>
      <div className={hiddenUnlockBleedClass(includeHidden)}>
        <PageHeader
          title={`Namaste, ${user?.name?.split(" ")[0] || "there"}.`}
          subtitle="A calm summary of today's showroom activity."
          onTitleClick={handleTitleClick}
          titleHint={titleHint}
          actions={lockButton}
        />
        <div className="card p-10 text-center text-[13px] text-[#737373]">Unable to load dashboard. Please refresh.</div>
      </div>
      {dialog}
      </>
    );
  }

  const { kpis, trend = [], purity_breakdown = [], low_stock = [], recent_invoices = [], top_categories = [] } = data;
  const gr = goldRateLocal ?? {};

  return (
    <>
    <div className={hiddenUnlockBleedClass(includeHidden)}>
    <div className="max-w-[1400px] space-y-4">

      {/* Header */}
      <PageHeader
        title={`Namaste, ${user?.name?.split(" ")[0] || "there"}.`}
        subtitle="A calm summary of today's showroom activity."
        onTitleClick={handleTitleClick}
        titleHint={titleHint}
        actions={lockButton}
      />

      {/* Live Gold Rates */}
      <GoldRatesBar goldRate={gr} onSave={handleRateSave} />

      {/* Revenue KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#737373]">Today Sales</div>
          <div className="text-[22px] font-bold text-[#0A0A0A] mt-1 leading-tight">{fmtINR(kpis.today_sales ?? 0)}</div>
          <div className="text-[11px] text-[#737373] mt-1">{kpis.today_invoices ?? 0} invoice{(kpis.today_invoices ?? 0) !== 1 ? "s" : ""}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#737373]">This Month</div>
          <div className="text-[22px] font-bold text-[#0A0A0A] mt-1 leading-tight">{fmtINR(kpis.month_sales ?? 0)}</div>
          <div className="text-[11px] text-[#737373] mt-1">{kpis.month_invoices ?? 0} invoice{(kpis.month_invoices ?? 0) !== 1 ? "s" : ""}</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#737373]">Today Cash</div>
          <div className="text-[22px] font-bold text-[#0A0A0A] mt-1 leading-tight">{fmtINR(kpis.today_cash ?? 0)}</div>
          <div className="text-[11px] text-[#737373] mt-1">Cash collections</div>
        </div>
        <div className="card p-4">
          <div className="text-[10px] uppercase tracking-widest font-bold text-[#737373]">Avg Daily</div>
          <div className="text-[22px] font-bold text-[#0A0A0A] mt-1 leading-tight">{fmtINR(kpis.avg_daily_sales ?? 0)}</div>
          <div className="text-[11px] text-[#737373] mt-1">This month so far</div>
        </div>
      </div>

      {/* ── Metal Summary Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
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
        <div className="lg:col-span-2 min-w-0 card p-4">
          <div className="mb-3">
            <div className="section-title text-[13px]">Daily Billing — Last 7 Days</div>
            <div className="text-[11px] text-[#737373] mt-0.5">Invoice total billed each day</div>
          </div>
          <BillingTrendChart data={trend} />
        </div>

        {/* Purity donut — 1/3 width */}
        <div className="card p-4">
          <div className="mb-3">
            <div className="section-title text-[13px]">Purity Breakdown</div>
            <div className="text-[11px] text-[#737373] mt-0.5">By gross weight this month</div>
          </div>
          <PurityDonut data={purity_breakdown} />
        </div>
      </div>

      {/* ── Bottom Row ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Recent Transactions */}
        <div className="card p-0 overflow-hidden" data-testid={T.recentInvoicesTable}>
          <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center justify-between">
            <div><div className="section-title text-[13px]">Recent Transactions</div><div className="text-[11px] text-[#737373] mt-0.5">Latest 5 invoices</div></div>
            {isEnabled("reports") && (
              <Link to="/reports" className="text-[11.5px] text-[#525252] hover:text-[#0A0A0A] inline-flex items-center gap-1">View all <ArrowRight size={11} strokeWidth={1.5} /></Link>
            )}
          </div>
          {recent_invoices.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-[#737373]">No invoices yet.</div>
          ) : (
            <div className="divide-y divide-[#F5F5F5]">
              {recent_invoices.map((inv) => (
                <div key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="h-7 w-7 rounded-lg bg-[#FAFAFA] border border-[#E5E7EB] flex items-center justify-center flex-shrink-0"><IndianRupee size={12} strokeWidth={1.5} className="text-[#B49042]" /></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-medium text-[#0A0A0A] truncate">{inv.customer_name || "Walk-in"}</span>
                      <span className="text-[12px] font-semibold text-[#0A0A0A] ml-2 flex-shrink-0">{fmtINR(inv.grand_total)}</span>
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10.5px] font-mono text-[#a3a3a3]">{inv.invoice_no}</span>
                      {inv.payment_mode && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${inv.payment_mode === "cash" ? "bg-[#F5F5F5] text-[#525252] border-[#E5E7EB]" : inv.payment_mode === "card" ? "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]" : "bg-[#F5F3FF] text-[#6D28D9] border-[#DDD6FE]"}`}>{inv.payment_mode}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Selling Categories */}
        <div className="card p-4">
          <div className="mb-4"><div className="section-title text-[13px]">Top Selling Categories</div><div className="text-[11px] text-[#737373] mt-0.5">By sales this month</div></div>
          <CategoryBars categories={top_categories} />
        </div>

        {/* Low Stock Alerts */}
        <div className="card p-0" data-testid={T.lowStockList}>
          <div className="px-4 py-3 border-b border-[#E5E7EB]">
            <div className="flex items-center gap-1.5"><AlertTriangle size={13} strokeWidth={1.5} className="text-[#9A3412]" /><div className="section-title text-[13px]">Low Stock Alerts</div></div>
            <div className="text-[11px] text-[#737373] mt-0.5">Sub-categories at or below their Catalog threshold.</div>
          </div>
          {low_stock.length === 0 ? (
            <div className="p-6 text-[12px] text-[#737373]">All sub-categories are well stocked.</div>
          ) : (
            <ul className="divide-y divide-[#F5F5F5]">
              {low_stock.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="h-8 w-8 rounded-lg bg-[#FAFAFA] border border-[#E5E7EB] flex items-center justify-center flex-shrink-0"><Sparkles size={12} className="text-[#a3a3a3]" strokeWidth={1.5} /></div>
                  <div className="flex-1 min-w-0"><div className="text-[12px] font-medium text-[#0A0A0A] truncate">{p.name}</div><div className="text-[10.5px] text-[#737373]">Threshold {p.low_stock_threshold}</div></div>
                  <div className="chip chip-warning flex-shrink-0 text-[10.5px]">{p.stock_qty} pcs</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
    </div>

    {/* Floating low-stock reminder panel — inventory-only content */}
    {isEnabled("inventory") && <LowStockPanel />}
    {dialog}
    </>
  );
}
