import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, Gem, Landmark, Loader2, Receipt, Smartphone, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import {
  AccountsFilterBar,
  AccountsTable,
  fmtINR,
  useAccountsDateRange,
} from "./accountsShared";

/** A small, calm palette reused across every card on this screen — pastel
 * background + a matching border/text/icon tone, same visual language as
 * AccountsKpiCard's tone system elsewhere in Accounts, just with more hues so
 * Cash/UPI/Bank/Cheque/Old Gold read apart from each other at a glance. */
const THEME = {
  emerald: { bg: "bg-[#F1F6F2]", border: "border-[#CBDAD0]", text: "text-[#315C4A]", icon: "text-[#315C4A]", badge: "bg-[#DDE9E1]" },
  violet: { bg: "bg-[#F7F5FC]", border: "border-[#DDD6FE]", text: "text-[#5B4B86]", icon: "text-[#67549A]", badge: "bg-[#EAE5F8]" },
  sky: { bg: "bg-[#F4F2ED]", border: "border-[#D8D2C6]", text: "text-[#59635D]", icon: "text-[#59635D]", badge: "bg-[#E8E5DE]" },
  amber: { bg: "bg-[#FBF6E9]", border: "border-[#D8C28C]", text: "text-[#765A20]", icon: "text-[#8A6A2D]", badge: "bg-[#F1E6CA]" },
  gold: { bg: "bg-[#FBF6E9]", border: "border-[#D8C28C]", text: "text-[#765A20]", icon: "text-[#8A6A2D]", badge: "bg-[#F1E6CA]" },
  slate: { bg: "bg-[#F1F3F2]", border: "border-[#CDD2CF]", text: "text-[#5F6863]", icon: "text-[#5F6863]", badge: "bg-[#E1E5E3]" },
};

function themeForMetal(metal) {
  const m = String(metal || "").toLowerCase();
  if (m.includes("gold")) return "gold";
  if (m.includes("silver")) return "slate";
  return "violet";
}

/** Section container — colored icon badge + title, consistent card frame. */
function SectionCard({ icon: Icon, theme = "gold", title, sub, right, children }) {
  const c = THEME[theme] || THEME.gold;
  return (
    <div className="mb-6 rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-4 shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${c.badge} ${c.border}`}>
            {Icon ? <Icon className={`h-4 w-4 ${c.icon}`} /> : null}
          </span>
          <div>
            <h3 className="text-sm font-semibold text-[#0A0A0A]">{title}</h3>
            {sub ? <p className="text-xs text-[#737373]">{sub}</p> : null}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Colorful KPI card — a themed variant of AccountsKpiCard for this screen. */
function ColorKpiCard({ label, value, sub, icon: Icon, theme = "gold" }) {
  const c = THEME[theme] || THEME.gold;
  return (
    <div className={`rounded-xl border p-3.5 shadow-sm ${c.bg} ${c.border}`}>
      <div className="flex items-center gap-1.5">
        {Icon ? <Icon className={`h-3.5 w-3.5 ${c.icon}`} /> : null}
        <div className="text-[11px] font-medium uppercase tracking-wide text-[#737373]">{label}</div>
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${c.text}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-[#737373]">{sub}</div> : null}
    </div>
  );
}

/** Section 1 — Cash / UPI / Bank / Cheque / Old Gold Exchange, period-filtered.
 * Reuses the ERP Statement's own mode_totals so this can never disagree with
 * the ERP Statement's print summary for the same period. */
function LiquidTotalsSection() {
  const range = useAccountsDateRange("today");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/accounts/erp-statement", {
        params: { from: range.from, to: range.to },
        timeout: 60000,
      });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const mt = data?.mode_totals || {};

  return (
    <SectionCard
      icon={Wallet}
      theme="emerald"
      title="Liquid totals"
      sub="Net Cash / UPI / Bank / Cheque / Old Gold Exchange for the selected period"
    >
      <AccountsFilterBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        onFrom={(v) => range.setFrom(v)}
        onTo={(v) => range.setTo(v)}
        onPreset={range.applyPreset}
        onRefresh={load}
        loading={loading}
      />
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <ColorKpiCard label="Cash" value={fmtINR(mt.cash)} icon={Wallet} theme="emerald" />
        <ColorKpiCard label="UPI" value={fmtINR(mt.upi)} icon={Smartphone} theme="violet" />
        <ColorKpiCard label="Bank" value={fmtINR(mt.bank)} icon={Landmark} theme="sky" />
        <ColorKpiCard label="Cheque" value={fmtINR(mt.cheque)} icon={Receipt} theme="amber" />
        <ColorKpiCard label="Old Gold Exchange" value={fmtINR(mt.old_gold_exchange)} sub="Non-cash" icon={Gem} theme="gold" />
        <ColorKpiCard label="Old Silver Exchange" value={fmtINR(mt.old_silver_exchange)} sub="Non-cash" icon={Gem} theme="slate" />
      </div>
      {loading && !data ? (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[#737373]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : null}
    </SectionCard>
  );
}

/** Sections 2 & 3 — live "as of now" stock, no date filter (matches the
 * existing Metal panel's own convention: stock is a snapshot, not a period
 * total). Reuses GET /accounts/metal's by_purity for inventory, and
 * GET /pure-products (summed client-side) for pure metal. */
function StockSection() {
  const [metalData, setMetalData] = useState(null);
  const [pureRows, setPureRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [metalFilter, setMetalFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [metalRes, pureRes] = await Promise.all([
        api.get("/accounts/metal"),
        api.get("/pure-products"),
      ]);
      setMetalData(metalRes.data);
      setPureRows(Array.isArray(pureRes.data) ? pureRes.data : []);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byPurity = metalData?.by_purity || [];
  const metals = useMemo(
    () => [...new Set(byPurity.map((r) => r.metal))].sort(),
    [byPurity],
  );
  const visibleMetals = metalFilter === "all" ? metals : metals.filter((m) => m === metalFilter);

  const pureTotals = useMemo(() => {
    const totals = {};
    for (const r of pureRows) {
      const metal = r.metal || "unknown";
      const grams = r.form_type === "coin"
        ? (Number(r.stock_qty) || 0) * (Number(r.weight_g) || 0)
        : (Number(r.stock_qty) || 0);
      totals[metal] = (totals[metal] || 0) + grams;
    }
    return totals;
  }, [pureRows]);

  return (
    <>
      <SectionCard
        icon={Boxes}
        theme="violet"
        title="Inventory"
        sub="Current stock as of now, by purity — not a date range"
        right={
          <select
            value={metalFilter}
            onChange={(e) => setMetalFilter(e.target.value)}
            className="rounded-[9px] border border-[#CFC8BB] bg-white px-2.5 py-1.5 text-xs text-[#24332B] outline-none focus:border-[#3D6B5B] focus:ring-2 focus:ring-[#DDE8E0]"
          >
            <option value="all">All metals</option>
            {metals.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        }
      >
        {loading && !metalData ? (
          <div className="flex items-center gap-1.5 text-xs text-[#737373]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visibleMetals.map((metal) => {
              const rows = byPurity.filter((r) => r.metal === metal);
              const totalGross = rows.reduce((s, r) => s + (Number(r.gross_weight) || 0), 0);
              const totalNet = rows.reduce((s, r) => s + (Number(r.net_weight) || 0), 0);
              const c = THEME[themeForMetal(metal)];
              return (
                <div key={metal} className={`rounded-xl border ${c.border} ${c.bg} p-3`}>
                  <p className={`mb-2 text-xs font-semibold uppercase tracking-wide ${c.text}`}>{metal}</p>
                  <div className="overflow-hidden rounded-lg border border-white/60 bg-white/70">
                    <AccountsTable
                      columns={[
                        { key: "purity", label: "Purity" },
                        { key: "gross_weight", label: "Gross Wt (g)", render: (r) => Number(r.gross_weight).toFixed(3) },
                        { key: "net_weight", label: "Net Wt (g)", render: (r) => Number(r.net_weight).toFixed(3) },
                      ]}
                      rows={rows}
                      empty={`No ${metal} stock`}
                    />
                  </div>
                  {rows.length ? (
                    <p className={`mt-2 text-right text-xs font-medium ${c.text}`}>
                      Total gross {totalGross.toFixed(3)} g · Total net {totalNet.toFixed(3)} g
                    </p>
                  ) : null}
                </div>
              );
            })}
            {!visibleMetals.length ? (
              <p className="text-xs text-[#737373]">No inventory found.</p>
            ) : null}
          </div>
        )}
      </SectionCard>

      <SectionCard
        icon={Sparkles}
        theme="slate"
        title="Pure metal"
        sub="Current pure gold/silver stock — purity isn't tracked per pure-metal item today"
      >
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <ColorKpiCard label="Pure Gold" value={`${(pureTotals.gold || 0).toFixed(3)} g`} icon={Sparkles} theme="gold" />
          <ColorKpiCard label="Pure Silver" value={`${(pureTotals.silver || 0).toFixed(3)} g`} icon={Sparkles} theme="slate" />
        </div>
      </SectionCard>
    </>
  );
}

/** Section 4 — Old Gold collected, purity-wise, period-filtered. Reuses the
 * Old Gold Exchange report's own purity_totals. */
function OldGoldSection() {
  const range = useAccountsDateRange("this_month");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/reports/old-gold/exchange", {
        params: { from: range.from, to: range.to, limit: 1 },
      });
      setData(res.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const purityTotals = data?.purity_totals || [];

  return (
    <SectionCard icon={Gem} theme="gold" title="Old gold collected" sub="Purity-wise, for the selected period">
      <AccountsFilterBar
        from={range.from}
        to={range.to}
        preset={range.preset}
        onFrom={(v) => range.setFrom(v)}
        onTo={(v) => range.setTo(v)}
        onPreset={range.applyPreset}
        onRefresh={load}
        loading={loading}
      />
      <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
        <ColorKpiCard label="Weight (filtered)" value={`${Number(data?.summary?.filtered_weight || 0).toFixed(3)} g`} icon={Gem} theme="gold" />
        <ColorKpiCard label="Value (filtered)" value={fmtINR(data?.summary?.filtered_value)} icon={Wallet} theme="emerald" />
      </div>
      <div className="overflow-hidden rounded-[10px] border border-[#D8D2C6]">
        <AccountsTable
          columns={[
            { key: "purity", label: "Purity" },
            { key: "total_weight", label: "Total Weight (g)", render: (r) => Number(r.total_weight).toFixed(3) },
            { key: "total_value", label: "Total Value", render: (r) => fmtINR(r.total_value) },
          ]}
          rows={purityTotals}
          empty="No old gold collected in this period"
        />
      </div>
    </SectionCard>
  );
}

export default function InfoTab() {
  return (
    <div>
      <LiquidTotalsSection />
      <StockSection />
      <OldGoldSection />
    </div>
  );
}
