import { useEffect, useMemo, useRef, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { fmtINR, fmtWeight, fmtDate } from "@/lib/format";
import { useBusinessDate } from "@/context/BusinessDateContext";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import DataTable from "@/pages/reports/DataTable";
import PrintSummaryButton from "@/pages/reports/PrintSummaryButton";
import { exportReportCsv } from "@/lib/reportExport";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const LINE_COLUMNS = [
  { key: "invoice_no", label: "Invoice No." },
  { key: "customer_id", label: "Customer ID" },
  { key: "status", label: "Status" },
  { key: "tag_no", label: "Tag No" },
  { key: "metal_type", label: "Metal Type" },
  { key: "category", label: "Product Category" },
  { key: "subcategory", label: "Product Sub-Category" },
  { key: "gross_weight", label: "Gross Wt", align: "right", format: "weight" },
  { key: "net_weight", label: "Net Wt", align: "right", format: "weight" },
  { key: "invoice_amount", label: "Total invoice amount", align: "right", format: "currency" },
  { key: "by_cash", label: "By Cash", align: "right", format: "currency" },
  { key: "by_upi", label: "By UPI", align: "right", format: "currency" },
  { key: "by_bank", label: "By Bank", align: "right", format: "currency" },
  { key: "by_cheque", label: "By Cheque", align: "right", format: "currency" },
  { key: "by_old_gold", label: "By Old Gold Ex", align: "right", format: "currency" },
  { key: "by_old_silver", label: "By Old Silver Ex", align: "right", format: "currency" },
];

function moneyCell(n) {
  const v = Number(n) || 0;
  return v ? fmtINR(v) : "—";
}

function weightCell(n) {
  const v = Number(n) || 0;
  return v ? fmtWeight(v) : "—";
}

export default function DayClosingReportTab({ includeHidden = false }) {
  const [searchParams] = useSearchParams();
  const { date: transactionDate } = useBusinessDate();
  const dateFromQuery = /^\d{4}-\d{2}-\d{2}$/.test(String(searchParams.get("date") || ""))
    ? searchParams.get("date")
    : null;
  const defaultDate = dateFromQuery || transactionDate || todayStr();
  const [date, setDate] = useState(defaultDate);
  const userPicked = useRef(Boolean(dateFromQuery));
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (dateFromQuery && dateFromQuery !== date) {
      userPicked.current = true;
      setDate(dateFromQuery);
      return;
    }
    if (!userPicked.current && transactionDate) setDate(transactionDate);
  }, [transactionDate, dateFromQuery, date]);

  const load = async (forDate) => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/day-closing", {
        params: {
          date: forDate,
          include_hidden: includeHidden ? 1 : undefined,
        },
      });
      setPayload(data);
    } catch (err) {
      setPayload(null);
      toast.error(formatApiError(err) || "Failed to load day closing report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(date);
  }, [date, includeHidden]);

  const rows = payload?.data || [];
  const totals = payload?.totals || {};
  const dayClose = payload?.day_close || {};
  const metalRows = payload?.sales_by_metal || [];

  const pocketRows = useMemo(
    () => [
      { type: "Cash", opening: dayClose.cash?.opening, closing: dayClose.cash?.closing },
      { type: "UPI", opening: dayClose.upi?.opening, closing: dayClose.upi?.closing },
      { type: "Bank", opening: dayClose.bank?.opening, closing: dayClose.bank?.closing },
      { type: "Cheque", opening: dayClose.cheque?.opening, closing: dayClose.cheque?.closing },
    ],
    [dayClose],
  );

  const screenColumns = useMemo(
    () => [
      {
        key: "sno",
        label: "S.No",
        render: (_row, idx) => idx + 1,
      },
      ...LINE_COLUMNS.map((c) => {
        if (c.format === "currency") {
          return { ...c, render: (r) => moneyCell(r[c.key]) };
        }
        if (c.format === "weight") {
          return { ...c, render: (r) => weightCell(r[c.key]) };
        }
        if (c.key === "status") {
          return {
            ...c,
            render: (r) => (
              <span className="capitalize">{r.status || "—"}</span>
            ),
          };
        }
        return { ...c, render: (r) => r[c.key] || "—" };
      }),
    ],
    [],
  );

  const closingTables = useMemo(
    () => [
      {
        title: "Today's Day Close final info",
        columns: [
          { key: "type", label: "Type" },
          { key: "opening", label: "Opening", align: "right", format: "currency" },
          { key: "closing", label: "Closing", align: "right", format: "currency" },
        ],
        rows: pocketRows,
      },
      {
        title: "Today sales",
        columns: [
          { key: "metal_type", label: "Metal type" },
          { key: "gross_weight", label: "Gross Wt", align: "right", format: "weight" },
          { key: "net_weight", label: "Net Wt", align: "right", format: "weight" },
        ],
        rows: metalRows.length ? metalRows : [{ metal_type: "—", gross_weight: 0, net_weight: 0 }],
        totals: metalRows.length
          ? {
            metal_type: "Total",
            gross_weight: metalRows.reduce((s, r) => s + (Number(r.gross_weight) || 0), 0),
            net_weight: metalRows.reduce((s, r) => s + (Number(r.net_weight) || 0), 0),
          }
          : null,
      },
    ],
    [pocketRows, metalRows],
  );

  const printTotals = {
    invoice_no: "Total",
    gross_weight: totals.gross_weight,
    net_weight: totals.net_weight,
    invoice_amount: totals.invoice_amount,
    by_cash: totals.by_cash,
    by_upi: totals.by_upi,
    by_bank: totals.by_bank,
    by_cheque: totals.by_cheque,
    by_old_gold: totals.by_old_gold,
    by_old_silver: totals.by_old_silver,
  };

  const handleCsv = () => {
    exportReportCsv({
      title: "Day Closing Report",
      columns: LINE_COLUMNS,
      rows,
      totals: printTotals,
      options: { showTotals: true },
    });
  };

  const numKeys = [
    "gross_weight",
    "net_weight",
    "invoice_amount",
    "by_cash",
    "by_upi",
    "by_bank",
    "by_cheque",
    "by_old_gold",
    "by_old_silver",
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-2 rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] px-3.5 py-3 shadow-[0_1px_2px_rgba(38,52,43,0.04)] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-[#FFFDF9] [&_.input]:!rounded-[9px] [&_.input]:!border-[#CFC8BB]">
        <label className="flex items-center gap-2 text-[12px] text-[#525252]">
          <span className="font-medium">Date</span>
          <input
            type="date"
            className="input w-40"
            value={date}
            max={transactionDate || todayStr()}
            onChange={(e) => {
              userPicked.current = true;
              setDate(e.target.value);
            }}
          />
        </label>
        <button
          type="button"
          className="btn-secondary !py-1 !text-[11.5px]"
          onClick={() => load(date)}
          disabled={loading}
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} strokeWidth={1.5} />
          Refresh
        </button>
        <PrintSummaryButton
          reportName="Day Closing Report"
          filtersSummary={`Date: ${fmtDate(date)}${includeHidden ? " · Hidden bills included" : ""}`}
          columns={LINE_COLUMNS}
          rows={rows}
          totals={printTotals}
          defaultOrientation="landscape"
          closingTables={closingTables}
          allowEmpty
        />
        <button type="button" className="btn-secondary !py-1 !text-[11.5px]" onClick={handleCsv} disabled={!rows.length}>
          <Download size={12} strokeWidth={1.5} /> Download CSV
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <div className="h-72 rounded-xl border border-[#E1DBD0] shimmer" />
        </div>
      ) : (
        <>
          <DataTable
            columns={screenColumns}
            rows={rows}
            emptyMessage="No bills for this date."
            footer={
              rows.length ? (
                <tr className="table-head-row font-semibold">
                  <td className="table-td">Total</td>
                  {LINE_COLUMNS.map((c) => (
                    <td key={c.key} className={`table-td ${c.align === "right" ? "text-right tabular-nums" : ""}`}>
                      {numKeys.includes(c.key)
                        ? (c.format === "weight" ? fmtWeight(totals[c.key]) : fmtINR(totals[c.key]))
                        : ""}
                    </td>
                  ))}
                </tr>
              ) : null
            }
          />

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="table-shell overflow-x-auto">
              <div className="border-b border-[#DDD7CA] bg-[#FBF8F1] px-3 py-2.5 text-[12px] font-semibold text-[#24332B]">
                Today's Day Close final info
              </div>
              <table className="w-full">
                <thead>
                  <tr className="table-head-row">
                    <th className="table-th">Type</th>
                    <th className="table-th text-right">Opening</th>
                    <th className="table-th text-right">Closing</th>
                  </tr>
                </thead>
                <tbody>
                  {pocketRows.map((r) => (
                    <tr key={r.type} className="table-row">
                      <td className="table-td">{r.type}</td>
                      <td className="table-td text-right tabular-nums">{fmtINR(r.opening)}</td>
                      <td className="table-td text-right tabular-nums">{fmtINR(r.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="table-shell overflow-x-auto">
              <div className="border-b border-[#DDD7CA] bg-[#FBF8F1] px-3 py-2.5 text-[12px] font-semibold text-[#24332B]">Today sales</div>
              <table className="w-full">
                <thead>
                  <tr className="table-head-row">
                    <th className="table-th">Metal type</th>
                    <th className="table-th text-right">Gross Wt</th>
                    <th className="table-th text-right">Net Wt</th>
                  </tr>
                </thead>
                <tbody>
                  {metalRows.length ? (
                    metalRows.map((r) => (
                      <tr key={r.metal_type} className="table-row">
                        <td className="table-td">{r.metal_type}</td>
                        <td className="table-td text-right tabular-nums">{fmtWeight(r.gross_weight)}</td>
                        <td className="table-td text-right tabular-nums">{fmtWeight(r.net_weight)}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className="table-td text-center text-[#737373] py-6">
                        No sales for this date.
                      </td>
                    </tr>
                  )}
                </tbody>
                {metalRows.length ? (
                  <tfoot>
                    <tr className="table-head-row font-semibold">
                      <td className="table-td">Total</td>
                      <td className="table-td text-right tabular-nums">
                        {fmtWeight(metalRows.reduce((s, r) => s + (Number(r.gross_weight) || 0), 0))}
                      </td>
                      <td className="table-td text-right tabular-nums">
                        {fmtWeight(metalRows.reduce((s, r) => s + (Number(r.net_weight) || 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
