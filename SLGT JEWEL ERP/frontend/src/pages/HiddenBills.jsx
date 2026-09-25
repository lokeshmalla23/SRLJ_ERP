import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, RefreshCw, Shield } from "lucide-react";
import { toast } from "sonner";
import { Navigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { fmtINR, fmtDate, getShowTransactionTime } from "@/lib/format";
import { asArray } from "@/lib/jsonFields";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import PageHeader from "@/components/common/PageHeader";
import { invoiceOccurredAt } from "@/lib/occurredAt";
import { hiddenUnlockBleedClass } from "@/lib/hiddenUnlockSurface";

function isOwnerRole(role) {
  const r = String(role || "");
  return r === "shop_owner" || r === "owner" || r === "super_admin";
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Same transaction-date + real-clock-time rule as everywhere else in the ERP
 * (invoiceOccurredAt) — hidden bills used to show ~05:30 for every bill
 * because business_date has no time-of-day and was parsed as UTC midnight.
 */
function parseBillDate(inv) {
  return invoiceOccurredAt(inv);
}

function formatBillDate(inv) {
  const d = parseBillDate(inv);
  if (!d) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function formatBillTime(inv, withSeconds = false) {
  if (!getShowTransactionTime()) return "";
  const d = parseBillDate(inv);
  if (!d) return "";
  return d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

function isPureMetalInvoice(inv) {
  const items = asArray(inv?.items);
  if (!items.length) return false;
  return items.some((it) => it?.is_pure_metal || it?.line_type === "pure_metal");
}

function billKind(inv) {
  return isPureMetalInvoice(inv) ? "pure_metal" : "jewellery";
}

function KindBadge({ kind }) {
  if (kind === "pure_metal") {
    return (
      <span
        className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide"
        style={{ background: "#FDF8EC", color: "#8A6D2F" }}
      >
        Pure Gold/Silver
      </span>
    );
  }
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: "#F3F4F6", color: "#525252" }}
    >
      Jewellery
    </span>
  );
}

export default function HiddenBills() {
  const { user } = useAuth();
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [kindFilter, setKindFilter] = useState("all"); // all | jewellery | pure_metal

  const load = useCallback(() => {
    setLoading(true);
    const params = { hidden_only: "1" };
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;

    Promise.all([
      api.get("/invoices", { params }),
      api.get("/employees").catch(() => ({ data: [] })),
    ])
      .then(([invRes, empRes]) => {
        setRows(Array.isArray(invRes.data) ? invRes.data : invRes.data?.data || []);
        const emps = Array.isArray(empRes.data) ? empRes.data : empRes.data?.data || [];
        setEmployees(emps);
      })
      .catch((err) => toast.error(formatApiError(err) || "Failed to load hidden bills"))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    if (kindFilter === "all") return rows;
    return rows.filter((inv) => billKind(inv) === kindFilter);
  }, [rows, kindFilter]);

  if (!isOwnerRole(user?.role)) {
    return <Navigate to="/" replace />;
  }

  const empName = (id) => {
    if (!id) return "—";
    const e = employees.find((x) => x.id === id || x.user_id === id);
    return e?.name || id.slice(0, 8);
  };

  const clearDates = () => {
    setFromDate("");
    setToDate("");
  };

  return (
    <div className={hiddenUnlockBleedClass(true)}>
    <div className="max-w-6xl mx-auto space-y-4">
      <PageHeader
        title="Hidden Bills"
        subtitle="Owner-only · Jewellery & Pure Gold/Silver POS · excluded from normal records until unlocked"
        actions={
          <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" onClick={load}>
            <RefreshCw size={13} /> Refresh
          </button>
        }
      />

      <div className="flex items-center gap-2 text-[12px] text-[#737373] bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
        <Shield size={14} className="text-amber-700 shrink-0" />
        Works from both POS tabs (Jewellery and Pure Gold/Silver). Shows each bill&apos;s own date, salesperson, customer, items and payments.
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border px-4 py-3 space-y-3" style={{ borderColor: "#E5E7EB" }}>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: "All" },
            { id: "jewellery", label: "Jewellery" },
            { id: "pure_metal", label: "Pure Gold / Silver" },
          ].map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setKindFilter(opt.id)}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-colors"
              style={{
                borderColor: kindFilter === opt.id ? "#0A0A0A" : "#E5E7EB",
                background: kindFilter === opt.id ? "#0A0A0A" : "#fff",
                color: kindFilter === opt.id ? "#fff" : "#525252",
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-1.5">
              From date
            </span>
            <input
              type="date"
              className="input !w-auto"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-[#737373] mb-1.5">
              To date
            </span>
            <input
              type="date"
              className="input !w-auto"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
          <button type="button" className="btn-secondary text-xs" onClick={load}>
            Apply
          </button>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={() => {
              const t = todayStr();
              setFromDate(t);
              setToDate(t);
            }}
          >
            Today
          </button>
          <button
            type="button"
            className="text-[12px] text-[#737373] hover:text-[#0A0A0A] underline"
            onClick={clearDates}
          >
            Show all
          </button>
          <div className="text-[12px] text-[#a3a3a3] ml-auto tabular-nums">
            {filteredRows.length} bill{filteredRows.length === 1 ? "" : "s"}
            {fromDate || toDate
              ? ` · ${fromDate ? fmtDate(fromDate) : "…"} → ${toDate ? fmtDate(toDate) : "…"}`
              : " · all dates"}
          </div>
        </div>
      </div>

      {loading ? (
        <PageLoadingBadge />
      ) : (
        <div className="bg-white rounded-2xl border overflow-hidden" style={{ borderColor: "#E5E7EB" }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#F9FAFB] text-left text-[12px] text-[#737373]">
                <th className="px-3 py-2.5">Bill date</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5">Invoice</th>
                <th className="px-3 py-2.5">Customer</th>
                <th className="px-3 py-2.5">Salesperson</th>
                <th className="px-3 py-2.5 text-right">Amount</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((inv) => {
                const kind = billKind(inv);
                return (
                  <tr key={inv.id} className="border-t" style={{ borderColor: "#E5E7EB" }}>
                    <td className="px-3 py-2">
                      <div className="text-[13px] font-medium text-[#0A0A0A]">{formatBillDate(inv)}</div>
                      <div className="text-[11px] text-[#a3a3a3] font-mono">
                        {formatBillTime(inv) || "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <KindBadge kind={kind} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px]">{inv.invoice_no}</td>
                    <td className="px-3 py-2">
                      <div>{inv.customer_name || "Walk-in"}</div>
                      {inv.customer_mobile && <div className="text-[11px] text-[#a3a3a3]">{inv.customer_mobile}</div>}
                    </td>
                    <td className="px-3 py-2">{empName(inv.salesperson_id)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: "#B49042" }}>
                      {fmtINR(inv.grand_total)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[12px] text-[#B49042] hover:underline"
                        onClick={() => setSelected(inv)}
                      >
                        {selected?.id === inv.id ? <EyeOff size={13} /> : <Eye size={13} />} Details
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!filteredRows.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[#a3a3a3]">
                    No hidden bills{fromDate || toDate || kindFilter !== "all" ? " for this filter" : " yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="bg-white rounded-2xl border p-4 space-y-3" style={{ borderColor: "#E5E7EB" }}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="font-semibold text-[#0A0A0A] flex items-center gap-2 flex-wrap">
              {selected.invoice_no}
              <KindBadge kind={billKind(selected)} />
              <span className="text-[12px] font-normal text-[#737373]">
                by {empName(selected.salesperson_id)}
              </span>
            </div>
            <button type="button" className="btn-secondary text-xs" onClick={() => setSelected(null)}>Close</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2 text-[13px]">
            <div>
              Bill date:{" "}
              <strong>{formatBillDate(selected)}</strong>
              <span className="text-[#737373] ml-1.5">{formatBillTime(selected, true)}</span>
            </div>
            <div>Customer: <strong>{selected.customer_name || "Walk-in"}</strong></div>
            <div>Mobile: <strong>{selected.customer_mobile || "—"}</strong></div>
            <div>Subtotal: {fmtINR(selected.subtotal)}</div>
            <div>GST: {fmtINR(selected.gst_amount)}</div>
            <div>Grand total: <strong>{fmtINR(selected.grand_total)}</strong></div>
            <div>Created by user: <strong>{selected.created_by || "—"}</strong></div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[#737373] mb-1">Items</div>
            <ul className="text-[13px] space-y-1">
              {asArray(selected.items).map((it, i) => (
                <li key={i} className="flex justify-between border-b py-1" style={{ borderColor: "#F3F4F6" }}>
                  <span>
                    {it.name || it.product_name || it.description || "Item"}
                    {" · "}
                    {it.net_weight || it.gross_weight || "—"}g
                    {(it.is_pure_metal || it.line_type === "pure_metal") ? " · pure metal" : ""}
                  </span>
                  <span className="tabular-nums">{fmtINR(it.line_total || it.amount || it.price_override)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-[#737373] mb-1">Payments</div>
            <ul className="text-[13px] space-y-1">
              {asArray(selected.payments).map((p, i) => (
                <li key={i} className="flex justify-between">
                  <span className="capitalize">{String(p.mode || "").replace(/_/g, " ")}</span>
                  <span className="tabular-nums">{fmtINR(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
