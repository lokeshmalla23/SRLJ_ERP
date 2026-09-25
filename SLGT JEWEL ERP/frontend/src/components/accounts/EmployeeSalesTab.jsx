import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Users, Eye, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { SimplePieChart, SimpleBarChart } from "@/components/charts/SimpleCharts";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import { fmtINR, fmtWeight } from "@/lib/format";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (iso) => {
  if (!iso) return "—";
  if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}/.test(iso)) {
    const [y, m, d] = iso.slice(0, 10).split("-");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${d} ${months[Number(m) - 1]} ${y}`;
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const PRESETS = [
  { label: "Today", from: () => today(), to: () => today() },
  { label: "7 days", from: () => daysAgo(6), to: () => today() },
  { label: "30 days", from: () => daysAgo(29), to: () => today() },
  { label: "This month", from: () => `${today().slice(0, 8)}01`, to: () => today() },
];

const METAL_ACCENTS = { gold: "#B49042", silver: "#8D9F87" };
const METAL_FALLBACK_ACCENTS = ["#C08552", "#8D9F87", "#A0785A", "#7B8794"];

function metalAccent(name, index) {
  const key = String(name || "").trim().toLowerCase();
  return METAL_ACCENTS[key] || METAL_FALLBACK_ACCENTS[index % METAL_FALLBACK_ACCENTS.length];
}

/**
 * One card per metal: net and gross weight side by side at equal size, plus
 * (when present) the per-purity breakdown underneath. Same shape as the metal
 * cards on a customer's page so both screens read identically.
 */
function MetalWeightCard({ metal, index = 0 }) {
  const accent = metalAccent(metal.metal, index);
  const rows = metal.rows || [];
  return (
    <div
      className="bg-white rounded-2xl border p-4 overflow-hidden"
      style={{ borderColor: "#E5E7EB", borderTop: `2px solid ${accent}` }}
    >
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-[#0A0A0A]">{metal.metal} sold</div>
        <div
          className="h-7 w-7 rounded-full flex-shrink-0"
          style={{ backgroundColor: `${accent}22`, border: `1px solid ${accent}55` }}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {[
          ["Net weight", metal.total_net_weight],
          ["Gross weight", metal.total_gross_weight],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="font-display text-[22px] font-semibold tabular-nums leading-none text-[#0A0A0A]">
              {Number(value || 0).toFixed(3)}
            </div>
            <div className="mt-1 text-[11px] text-[#a3a3a3]">{label} (g)</div>
          </div>
        ))}
      </div>

      {rows.length > 0 && (
        <div className="mt-3 rounded-lg border border-[#E5E7EB] overflow-hidden">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="bg-[#FAFAFA] border-b border-[#E5E7EB]">
                <th className="text-left px-2.5 py-1.5 font-semibold text-[#737373]">Purity</th>
                <th className="text-right px-2.5 py-1.5 font-semibold text-[#737373]">Gross Wt</th>
                <th className="text-right px-2.5 py-1.5 font-semibold text-[#737373]">Net Wt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F5F5F5]">
              {rows.map((r) => (
                <tr key={r.purity}>
                  <td className="px-2.5 py-1.5 font-medium text-[#0A0A0A]">{r.purity}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-[#525252]">
                    {Number(r.gross_weight || 0).toFixed(3)}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums text-[#0A0A0A]">
                    {Number(r.net_weight || 0).toFixed(3)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-[#FAFAFA] border-t border-[#E5E7EB]">
                <td className="px-2.5 py-1.5 font-semibold text-[#737373]">Total</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-[#525252]">
                  {Number(metal.total_gross_weight || 0).toFixed(3)}
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-[#0A0A0A]">
                  {Number(metal.total_net_weight || 0).toFixed(3)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

/** Muted note when some weight could not be called gold or silver. */
function UnclassifiedNote({ unclassified }) {
  const net = Number(unclassified?.net || 0);
  const gross = Number(unclassified?.gross || 0);
  if (!(net > 0 || gross > 0)) return null;
  return (
    <div className="text-[11.5px] text-[#a3a3a3]">
      Unclassified metal (bill line has no metal/purity): {fmtWeight(net)} net · {fmtWeight(gross)} gross
    </div>
  );
}

export default function EmployeeSalesTab({ includeHidden = false }) {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(today());
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [detailId, setDetailId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadSummary = useCallback(() => {
    if (!from || !to || from > to) return;
    setLoading(true);
    api
      .get("/accounts/employee-sales", {
        params: { from, to, include_hidden: includeHidden ? 1 : undefined },
      })
      .then(({ data }) => setSummary(data))
      .catch((err) => toast.error(formatApiError(err) || "Failed to load employee sales"))
      .finally(() => setLoading(false));
  }, [from, to, includeHidden]);

  useEffect(() => {
    if (!detailId) loadSummary();
  }, [loadSummary, detailId]);

  const openDetail = async (employeeId) => {
    setDetailId(employeeId);
    setDetailLoading(true);
    try {
      const { data } = await api.get("/accounts/employee-sales", {
        params: { from, to, employee_id: employeeId, include_hidden: includeHidden ? 1 : undefined },
      });
      setDetail(data);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to load details");
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const barData = useMemo(
    () => (summary?.data || []).slice(0, 8).map((r) => ({
      name: String(r.employee_name || "").split(" ")[0] || "—",
      sales: r.sales,
      bills: r.invoice_count,
    })),
    [summary],
  );

  const trendData = useMemo(
    () => (summary?.trend || []).map((r) => ({
      name: String(r.date).slice(5),
      sales: r.sales,
    })),
    [summary],
  );

  const detailTrend = useMemo(
    () => (detail?.trend || []).map((r) => ({
      name: String(r.date).slice(5),
      sales: r.sales,
    })),
    [detail],
  );

  if (detailId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            className="btn-secondary text-xs inline-flex items-center gap-1.5"
            onClick={() => { setDetailId(null); setDetail(null); }}
          >
            <ArrowLeft size={14} /> All employees
          </button>
          <div className="text-sm font-semibold text-[#0A0A0A]">
            {detail?.employee?.name || "Employee"}
            {detail?.employee?.job_title ? (
              <span className="text-[#737373] font-normal"> · {detail.employee.job_title}</span>
            ) : null}
          </div>
          <span className="text-[12px] text-[#a3a3a3] ml-auto">
            {from} → {to}
          </span>
        </div>

        {detailLoading || !detail ? (
          <PageLoadingBadge />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                ["Bills", detail.totals.invoice_count],
                ["Schemes", detail.totals.scheme_count || 0],
                ["Sales", fmtINR(detail.totals.sales)],
                ["GST", fmtINR(detail.totals.gst)],
                ["Avg ticket", fmtINR(detail.totals.avg_ticket)],
              ].map(([label, value]) => (
                <div key={label} className="bg-white rounded-xl border p-3" style={{ borderColor: "#E5E7EB" }}>
                  <div className="text-[11px] uppercase tracking-wide text-[#737373]">{label}</div>
                  <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              {(detail.metals || []).map((m, i) => (
                <MetalWeightCard key={m.metal} metal={m} index={i} />
              ))}
              {!(detail.metals || []).length && (
                <div
                  className="md:col-span-2 bg-white rounded-2xl border p-4 text-[13px] text-[#a3a3a3]"
                  style={{ borderColor: "#E5E7EB" }}
                >
                  No metal sold by this employee in the selected dates
                </div>
              )}
            </div>
            <UnclassifiedNote unclassified={detail.unclassified} />

            <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "#E5E7EB" }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#737373] mb-2">
                Daily sales — {detail.employee?.name}
              </div>
              <SimpleBarChart
                data={detailTrend}
                xKey="name"
                bars={[{ key: "sales", name: "Sales", color: "#B49042" }]}
                height={240}
              />
            </div>

            <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
              <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wide text-[#737373]" style={{ borderColor: "#E5E7EB" }}>
                Invoices ({detail.invoices?.length || 0})
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#737373]">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Invoice</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2 text-right">Items</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.invoices || []).map((inv) => (
                    <tr key={inv.id} className="border-t" style={{ borderColor: "#E5E7EB" }}>
                      <td className="px-3 py-2 text-[12px]">{fmtDate(inv.date)}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{inv.invoice_no}</td>
                      <td className="px-3 py-2">
                        <div className="text-[13px]">{inv.customer_name}</div>
                        {inv.customer_mobile && (
                          <div className="text-[11px] text-[#a3a3a3]">{inv.customer_mobile}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{inv.item_count}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: "#B49042" }}>
                        {fmtINR(inv.grand_total)}
                      </td>
                    </tr>
                  ))}
                  {!detail.invoices?.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-[#a3a3a3]">
                        No sales for this employee in the selected dates
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
              <div className="px-4 py-3 border-b text-xs font-semibold uppercase tracking-wide text-[#737373]" style={{ borderColor: "#E5E7EB" }}>
                Schemes registered ({detail.schemes?.length || 0})
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#737373]">
                    <th className="px-3 py-2">Start</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Plan</th>
                    <th className="px-3 py-2 text-right">Monthly</th>
                    <th className="px-3 py-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.schemes || []).map((s) => (
                    <tr key={s.id} className="border-t" style={{ borderColor: "#E5E7EB" }}>
                      <td className="px-3 py-2 text-[12px]">{fmtDate(s.date)}</td>
                      <td className="px-3 py-2">
                        <div className="text-[13px]">{s.customer_name}</div>
                        {s.customer_mobile && (
                          <div className="text-[11px] text-[#a3a3a3]">{s.customer_mobile}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-[13px]">{s.plan_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtINR(s.monthly_amount)}</td>
                      <td className="px-3 py-2 text-right capitalize text-[12px]">{s.status}</td>
                    </tr>
                  ))}
                  {!detail.schemes?.length && (
                    <tr>
                      <td colSpan={5} className="px-3 py-8 text-center text-[#a3a3a3]">
                        No schemes registered by this employee in the selected dates
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Users size={16} className="text-[#B49042]" />
        <span className="text-sm font-medium text-[#0A0A0A]">Employee sales</span>
        <div className="flex gap-1 ml-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="text-[11px] px-2.5 py-1 rounded-full border border-[#E5E7EB] hover:border-[#B49042] text-[#525252]"
              onClick={() => { setFrom(p.from()); setTo(p.to()); }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input type="date" className="input w-36 ml-auto" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" className="input w-36" value={to} min={from} max={today()} onChange={(e) => setTo(e.target.value)} />
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1" onClick={loadSummary} disabled={loading}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {loading && !summary ? (
        <PageLoadingBadge />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              ["Employees", summary?.totals?.employees || 0],
              ["Bills", summary?.totals?.invoice_count || 0],
              ["Schemes", summary?.totals?.scheme_count || 0],
              ["Total sales", fmtINR(summary?.totals?.sales)],
              ["GST", fmtINR(summary?.totals?.gst)],
            ].map(([label, value]) => (
              <div key={label} className="bg-white rounded-xl border p-3" style={{ borderColor: "#E5E7EB" }}>
                <div className="text-[11px] uppercase tracking-wide text-[#737373]">{label}</div>
                <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "#E5E7EB" }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#737373] mb-2">
                Sales by employee
              </div>
              <SimpleBarChart
                data={barData}
                xKey="name"
                bars={[
                  { key: "sales", name: "Sales ₹", color: "#B49042" },
                ]}
                height={260}
              />
            </div>
            <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "#E5E7EB" }}>
              <div className="text-xs font-semibold uppercase tracking-wide text-[#737373] mb-2">
                Share of sales
              </div>
              <SimplePieChart data={summary?.pie || []} height={260} />
            </div>
          </div>

          <div className="bg-white rounded-2xl border p-4" style={{ borderColor: "#E5E7EB" }}>
            <div className="text-xs font-semibold uppercase tracking-wide text-[#737373] mb-2">
              Daily sales trend
            </div>
            <SimpleBarChart
              data={trendData}
              xKey="name"
              bars={[{ key: "sales", name: "Sales", color: "#0A0A0A" }]}
              height={200}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <MetalWeightCard
              metal={{
                metal: "Gold",
                total_net_weight: summary?.totals?.gold_net,
                total_gross_weight: summary?.totals?.gold_gross,
                rows: [],
              }}
            />
            <MetalWeightCard
              metal={{
                metal: "Silver",
                total_net_weight: summary?.totals?.silver_net,
                total_gross_weight: summary?.totals?.silver_gross,
                rows: [],
              }}
            />
          </div>
          <UnclassifiedNote unclassified={summary?.unclassified} />

          <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#737373]">
                  <th className="px-4 py-2.5">Employee</th>
                  <th className="px-4 py-2.5 text-right">Bills</th>
                  <th className="px-4 py-2.5 text-right">Schemes</th>
                  <th className="px-4 py-2.5 text-right">
                    Gold wt
                    <span className="block text-[10px] font-normal text-[#a3a3a3]">net</span>
                  </th>
                  <th className="px-4 py-2.5 text-right">
                    Silver wt
                    <span className="block text-[10px] font-normal text-[#a3a3a3]">net</span>
                  </th>
                  <th className="px-4 py-2.5 text-right">Sales</th>
                  <th className="px-4 py-2.5 text-right">Avg ticket</th>
                  <th className="px-4 py-2.5 text-right">GST</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(summary?.data || []).map((r) => (
                  <tr key={r.employee_id} className="border-t hover:bg-[#FAFAFA]" style={{ borderColor: "#E5E7EB" }}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-[#0A0A0A]">{r.employee_name}</div>
                      {r.job_title && <div className="text-[11px] text-[#a3a3a3]">{r.job_title}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.invoice_count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.scheme_count || 0}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#525252]">
                      {Number(r.gold_net) > 0 ? fmtWeight(r.gold_net) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#525252]">
                      {Number(r.silver_net) > 0 ? fmtWeight(r.silver_net) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums" style={{ color: "#B49042" }}>
                      {fmtINR(r.sales)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmtINR(r.avg_ticket)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#737373]">{fmtINR(r.gst)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[12px] text-[#B49042] hover:underline"
                        onClick={() => openDetail(r.employee_id)}
                      >
                        <Eye size={13} /> Details
                      </button>
                    </td>
                  </tr>
                ))}
                {!summary?.data?.length && (
                  <tr>
                    <td colSpan={9} className="px-4 py-10 text-center text-[#a3a3a3]">
                      No employee sales in this date range. Ensure POS bills have a salesperson selected.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
