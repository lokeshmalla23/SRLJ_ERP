import { useCallback, useEffect, useState } from "react";
import { Scale, Coins, History } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { fmtINR, fmtDateTime } from "@/lib/format";
import { SimplePieChart } from "@/components/charts/SimpleCharts";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import MoneyInput from "@/components/ui/MoneyInput";
import WeightInput from "@/components/ui/WeightInput";
import OldGoldExchangeTab from "./OldGoldExchangeTab";
import PrintSummaryButton from "./PrintSummaryButton";

/** Buybook physical-custody trail: posted -> in_stock -> melted -> used. */
const BUYBOOK_STATUS_META = {
  posted: { label: "Posted", hint: "Recorded & journaled — not yet placed in stock", color: "#525252", bg: "#F3F4F6", hoverBg: "#E5E7EB" },
  in_stock: { label: "In Stock", hint: "Held as-is in the shop, unrefined", color: "#1D4ED8", bg: "#DBEAFE", hoverBg: "#BFDBFE" },
  melted: { label: "Melted", hint: "Sent for melting / refining", color: "#B45309", bg: "#FEF3C7", hoverBg: "#FDE68A" },
  used: { label: "Used", hint: "Refined gold consumed into new production", color: "#166534", bg: "#DCFCE7", hoverBg: "#BBF7D0" },
};
const BUYBOOK_STATUS_ORDER = ["posted", "in_stock", "melted", "used"];
/** Status this row's action button would advance it to, or null if terminal. */
const NEXT_BUYBOOK_STATUS = { posted: "in_stock", in_stock: "melted", melted: "used", used: null };
const NEXT_BUYBOOK_LABEL = { in_stock: "Move to Stock", melted: "Mark Melted", used: "Mark Used" };

function summarizeByStatus(rows) {
  const byStatus = {};
  for (const s of BUYBOOK_STATUS_ORDER) byStatus[s] = { count: 0, weight: 0 };
  for (const r of rows || []) {
    const s = BUYBOOK_STATUS_ORDER.includes(r.status) ? r.status : "posted";
    byStatus[s].count += 1;
    byStatus[s].weight += Number(r.weight_g) || 0;
  }
  return byStatus;
}

function subFromReportId(reportId) {
  if (reportId === "jew-oldsilver-exchange") return "oldsilverexchange";
  if (reportId === "jew-oldgold-exchange") return "oldgoldexchange";
  if (reportId === "jew-rates") return "rates";
  return "oldgoldexchange";
}

export default function MoreReportsTab({ includeHidden = false, reportId }) {
  const [sub, setSub] = useState(() => subFromReportId(reportId));
  const [loading, setLoading] = useState(false);
  const [buybook, setBuybook] = useState(null);
  const [rateHist, setRateHist] = useState([]);
  const [rateEvents, setRateEvents] = useState([]);
  const [karigarId, setKarigarId] = useState("");
  const [karigars, setKarigars] = useState([]);
  const [karigarLedger, setKarigarLedger] = useState(null);
  const [metalForm, setMetalForm] = useState({ movement_type: "issue", weight: "", purity: "22K", notes: "" });

  const loadBuybook = useCallback(() => {
    setLoading(true);
    api.get("/reports/old-gold/buybook", {
      params: { include_hidden: includeHidden ? 1 : undefined },
    })
      .then(({ data }) => setBuybook(data))
      .catch((e) => toast.error(formatApiError(e)))
      .finally(() => setLoading(false));
  }, [includeHidden]);

  const loadRates = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get("/reports/gold-rate-history", { params: { limit: 40 } }),
      api.get("/reports/billing-rate-events", { params: { limit: 40 } }),
    ])
      .then(([h, e]) => {
        setRateHist(h.data?.data || []);
        setRateEvents(e.data?.data || []);
      })
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSub(subFromReportId(reportId));
  }, [reportId]);

  useEffect(() => {
    api.get("/vendors", { params: { type: "karigar" } })
      .then(({ data }) => setKarigars(Array.isArray(data) ? data : data?.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (sub === "oldgold") loadBuybook();
    if (sub === "rates") loadRates();
  }, [sub, loadBuybook, loadRates]);

  const loadKarigar = async () => {
    if (!karigarId) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/reports/karigar/${karigarId}/ledger`);
      setKarigarLedger(data);
    } catch (e) {
      toast.error(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  const postMetal = async (e) => {
    e.preventDefault();
    if (!karigarId) return toast.error("Select karigar");
    try {
      await api.post("/reports/metal-issues", {
        karigar_vendor_id: karigarId,
        movement_type: metalForm.movement_type,
        weight: Number(metalForm.weight),
        purity: metalForm.purity,
        notes: metalForm.notes,
      });
      toast.success("Metal movement saved");
      loadKarigar();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const tabs = [
    ["oldgoldexchange", "Old Gold Exchange", Coins],
    ["oldsilverexchange", "Old Silver Exchange", Coins],
    //["oldgold", "Old Gold Buybook", Coins],
    ["karigar", "Karigar Metal", Scale],
    ["rates", "Rate Audit", History],
  ];
  const hideInnerPills = reportId === "jew-oldgold-exchange" || reportId === "jew-oldsilver-exchange";

  return (
    <div className="space-y-4">
      {!hideInnerPills && (
      <div className="flex flex-wrap gap-1.5">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSub(id)}
            className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border ${sub === id ? "bg-[#0A0A0A] text-white border-[#0A0A0A]" : "bg-white text-[#525252] border-[#E5E7EB]"}`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      )}

      {loading && <PageLoadingBadge />}

      {sub === "oldgoldexchange" && <OldGoldExchangeTab includeHidden={includeHidden} metal="gold" />}
      {sub === "oldsilverexchange" && <OldGoldExchangeTab includeHidden={includeHidden} metal="silver" />}

      {sub === "oldgold" && buybook && (() => {
        const statusSummary = summarizeByStatus(buybook.data);
        return (
        <div className="space-y-4">
          <div className="flex justify-end">
            <PrintSummaryButton
              reportName="Old Gold Buybook"
              columns={[
                { key: "receipt_no", label: "Receipt" },
                { key: "weight_g", label: "Weight", format: "weight", align: "right" },
                { key: "purity", label: "Purity" },
                { key: "value", label: "Value", format: "currency", align: "right" },
                { key: "status", label: "Status", exportValue: (r) => (BUYBOOK_STATUS_META[r.status] || BUYBOOK_STATUS_META.posted).label },
              ]}
              rows={buybook.data || []}
              totals={{
                weight_g: (buybook.data || []).reduce((s, r) => s + (Number(r.weight_g) || 0), 0),
                value: (buybook.data || []).reduce((s, r) => s + (Number(r.value) || 0), 0),
              }}
              summaryParticulars={[
                { particular: "Total Value", total: (buybook.data || []).reduce((s, r) => s + (Number(r.value) || 0), 0) },
              ]}
            />
          </div>
          {/* Status trail: posted -> in stock -> melted -> used */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {BUYBOOK_STATUS_ORDER.map((s) => {
              const meta = BUYBOOK_STATUS_META[s];
              const stat = statusSummary[s];
              return (
                <div key={s} className="bg-white border rounded-xl p-3" style={{ borderColor: "#E5E7EB" }}>
                  <div className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: meta.color }}>
                    {meta.label}
                  </div>
                  <div className="text-lg font-semibold tabular-nums mt-0.5">
                    {(stat.weight || 0).toFixed(3)} g
                  </div>
                  <div className="text-[11px] text-[#737373] mt-0.5">
                    {stat.count} record{stat.count === 1 ? "" : "s"}
                  </div>
                  <div className="text-[10.5px] text-[#a3a3a3] mt-1">{meta.hint}</div>
                </div>
              );
            })}
          </div>

          <SimplePieChart
            data={(buybook.stock_by_purity || []).map((r) => ({ name: r.purity, value: r.weight }))}
          />
          <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#737373]">
                  <th className="px-3 py-2">Receipt</th>
                  <th className="px-3 py-2">Weight</th>
                  <th className="px-3 py-2">Purity</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {(buybook.data || []).map((r) => {
                  const meta = BUYBOOK_STATUS_META[r.status] || BUYBOOK_STATUS_META.posted;
                  const next = NEXT_BUYBOOK_STATUS[r.status] || null;
                  return (
                    <tr key={r.id} className="border-t" style={{ borderColor: "#E5E7EB" }}>
                      <td className="px-3 py-2 font-mono text-[12px]">{r.receipt_no}</td>
                      <td className="px-3 py-2">{r.weight_g}g</td>
                      <td className="px-3 py-2">{r.purity || "—"}</td>
                      <td className="px-3 py-2 text-right">{fmtINR(r.value)}</td>
                      <td className="px-3 py-2">
                        {next ? (
                          <button
                            type="button"
                            title={`Click to ${NEXT_BUYBOOK_LABEL[next]}`}
                            onClick={async () => {
                              await api.patch(`/reports/old-gold/${r.id}/trail`, { status: next });
                              loadBuybook();
                            }}
                            className="text-[11px] px-2.5 py-1 rounded-full font-semibold transition-colors"
                            style={{ color: meta.color, background: meta.bg }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = meta.hoverBg; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = meta.bg; }}
                          >
                            {meta.label} →
                          </button>
                        ) : (
                          <span
                            className="text-[11px] px-2.5 py-1 rounded-full font-semibold"
                            style={{ color: meta.color, background: meta.bg }}
                          >
                            {meta.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <OldGoldBuyForm onDone={loadBuybook} />
        </div>
        );
      })()}

      {sub === "karigar" && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            <select className="input w-56" value={karigarId} onChange={(e) => setKarigarId(e.target.value)}>
              <option value="">Select karigar</option>
              {karigars.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button type="button" className="btn-secondary text-xs" onClick={loadKarigar}>Load ledger</button>
          </div>
          {karigarLedger && (
            <div className="grid md:grid-cols-4 gap-3 text-sm">
              {Object.entries(karigarLedger.weight || {}).map(([k, v]) => (
                <div key={k} className="bg-white border rounded-xl p-3" style={{ borderColor: "#E5E7EB" }}>
                  <div className="text-[11px] text-[#737373] uppercase">{k}</div>
                  <div className="text-lg font-semibold">{v} g</div>
                </div>
              ))}
              <div className="bg-white border rounded-xl p-3" style={{ borderColor: "#E5E7EB" }}>
                <div className="text-[11px] text-[#737373] uppercase">Labour</div>
                <div className="text-lg font-semibold">{fmtINR(karigarLedger.labour_payable)}</div>
              </div>
            </div>
          )}
          <form onSubmit={postMetal} className="bg-white border rounded-2xl p-4 grid grid-cols-2 md:grid-cols-5 gap-2" style={{ borderColor: "#E5E7EB" }}>
            <select className="input" value={metalForm.movement_type} onChange={(e) => setMetalForm((f) => ({ ...f, movement_type: e.target.value }))}>
              <option value="issue">Issue</option>
              <option value="return">Return</option>
              <option value="scrap">Scrap</option>
            </select>
            <WeightInput className="input" placeholder="Weight g" required value={metalForm.weight} onValueChange={(raw) => setMetalForm((f) => ({ ...f, weight: raw }))} />
            <input className="input" placeholder="Purity" value={metalForm.purity} onChange={(e) => setMetalForm((f) => ({ ...f, purity: e.target.value }))} />
            <input className="input" placeholder="Notes" value={metalForm.notes} onChange={(e) => setMetalForm((f) => ({ ...f, notes: e.target.value }))} />
            <button type="submit" className="btn-primary text-sm">Save</button>
          </form>
        </div>
      )}

      {sub === "rates" && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <PrintSummaryButton
              reportName="Gold Rate History"
              columns={[
                { key: "occurred_at", label: "Date & Time", format: "datetime" },
                { key: "gold_24k", label: "24K", format: "currency", align: "right" },
                { key: "gold_22k", label: "22K", format: "currency", align: "right" },
                { key: "gold_18k", label: "18K", format: "currency", align: "right" },
                { key: "pure_silver", label: "Pure Silver", format: "currency", align: "right" },
                { key: "silver", label: "Silver", format: "currency", align: "right" },
                { key: "changed_by", label: "Changed by" },
                { key: "source", label: "Source" },
              ]}
              rows={rateHist}
            />
          </div>
        <div className="grid md:grid-cols-1 gap-4">
          <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
            <div className="px-3 py-2 text-xs font-semibold uppercase text-[#737373]">Gold rate history</div>
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-t bg-[#F9FAFB] text-[11px] uppercase text-[#737373]" style={{ borderColor: "#E5E7EB" }}>
                  <th className="px-3 py-2 text-left font-medium">Date & Time</th>
                  <th className="px-3 py-2 text-right font-medium">24K</th>
                  <th className="px-3 py-2 text-right font-medium">22K</th>
                  <th className="px-3 py-2 text-right font-medium">18K</th>
                  <th className="px-3 py-2 text-right font-medium">Pure Silver</th>
                  <th className="px-3 py-2 text-right font-medium">Silver</th>
                  <th className="px-3 py-2 text-left font-medium">Changed by</th>
                  <th className="px-3 py-2 text-left font-medium">Source</th>
                </tr>
              </thead>
              <tbody>
                {rateHist.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "#E5E7EB" }}>
                    <td className="px-3 py-2 text-[12px] whitespace-nowrap">{fmtDateTime(r.occurred_at || r.created_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.gold_24k != null ? fmtINR(r.gold_24k) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.gold_22k != null ? fmtINR(r.gold_22k) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.gold_18k != null ? fmtINR(r.gold_18k) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.pure_silver != null ? fmtINR(r.pure_silver) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.silver != null ? fmtINR(r.silver) : "—"}</td>
                    <td className="px-3 py-2 text-[12px]">{r.changed_by || "—"}</td>
                    <td className="px-3 py-2 text-[12px]">{r.source || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
          <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
            <div className="px-3 py-2 text-xs font-semibold uppercase text-[#737373]">Billing rate events</div>
            <table className="w-full text-sm">
              <tbody>
                {rateEvents.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: "#E5E7EB" }}>
                    <td className="px-3 py-2 text-[12px]">{fmtDateTime(r.created_at)}</td>
                    <td className="px-3 py-2 capitalize">{r.event_type}</td>
                    <td className="px-3 py-2 tabular-nums">{r.gold_rate ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        </div>
      )}

    </div>
  );
}

function OldGoldBuyForm({ onDone }) {
  const [form, setForm] = useState({ weight_g: "", purity: "22K", rate: "", description: "" });
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/reports/old-gold/buy", form);
      toast.success("Old gold buy recorded");
      setForm({ weight_g: "", purity: "22K", rate: "", description: "" });
      onDone?.();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={submit} className="bg-white border rounded-2xl p-4 grid grid-cols-2 md:grid-cols-5 gap-2" style={{ borderColor: "#E5E7EB" }}>
      <WeightInput className="input" required placeholder="Weight g" value={form.weight_g} onValueChange={(raw) => setForm((f) => ({ ...f, weight_g: raw }))} />
      <input className="input" placeholder="Purity" value={form.purity} onChange={(e) => setForm((f) => ({ ...f, purity: e.target.value }))} />
      <MoneyInput className="input" required placeholder="Rate" value={form.rate} onValueChange={(raw) => setForm((f) => ({ ...f, rate: raw }))} />
      <input className="input" placeholder="Notes" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <button type="submit" className="btn-primary text-sm" disabled={saving}>Cash buy</button>
    </form>
  );
}
