import { useMemo, useState } from "react";
import { fmtDateTime, fmtWeight } from "@/lib/format";
import { FilterBar, FilterInput } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function TodaysStockAddedReport({ onBack }) {
  const [date, setDate] = useState(todayStr());
  const [fromTime, setFromTime] = useState("");
  const [toTime, setToTime] = useState("");
  const params = useMemo(() => ({
    date,
    ...(fromTime ? { from_time: fromTime } : {}),
    ...(toTime ? { to_time: toTime } : {}),
  }), [date, fromTime, toTime]);

  const columns = [
    { key: "code", label: "Tag Number" },
    { key: "barcode", label: "Barcode" },
    { key: "name", label: "Product" },
    { key: "category_name", label: "Category", render: (r) => r.category_name || "—" },
    { key: "added_by", label: "Employee", render: (r) => r.added_by || "—" },
    { key: "counter_name", label: "Counter", render: (r) => r.counter_name || "—" },
    { key: "gross_weight", label: "Gross Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.gross_weight) },
    { key: "stone_weight", label: "Stone Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.stone_weight) },
    { key: "net_weight", label: "Net Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.net_weight) },
    { key: "time_added", label: "Time Added", format: "datetime", render: (r) => fmtDateTime(r.time_added) },
  ];

  return (
    <QuickReportShell
      title="Today's Stock Added"
      description="New tags entered into inventory on the selected date"
      endpoint="/reports/inventory/today-stock-added"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No stock was added in this window."
      filterBar={(
        <FilterBar>
          <FilterInput label="Date" type="date" value={date} onChange={setDate} />
          <FilterInput label="From Time" type="time" value={fromTime} onChange={setFromTime} />
          <FilterInput label="To Time" type="time" value={toTime} onChange={setToTime} />
        </FilterBar>
      )}
      afterTable={(extra) => {
        const categoryTotals = extra?.category_totals || [];
        if (!categoryTotals.length) return null;
        return (
          <div className="mt-6">
            <div className="text-[12px] font-semibold text-[#0A0A0A] mb-2">Category-wise Totals</div>
            <div className="table-shell">
              <table className="w-full">
                <thead>
                  <tr className="table-head-row">
                    <th className="table-th">Category</th>
                    <th className="table-th text-right">Items</th>
                    <th className="table-th text-right">Gross Wt</th>
                    <th className="table-th text-right">Stone Wt</th>
                    <th className="table-th text-right">Net Wt</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryTotals.map((c) => (
                    <tr key={c.category_id || c.category_name} className="table-row">
                      <td className="table-td">{c.category_name}</td>
                      <td className="table-td text-right tabular-nums">{c.items}</td>
                      <td className="table-td text-right tabular-nums">{fmtWeight(c.gross_weight)}</td>
                      <td className="table-td text-right tabular-nums">{fmtWeight(c.stone_weight)}</td>
                      <td className="table-td text-right tabular-nums">{fmtWeight(c.net_weight)}</td>
                    </tr>
                  ))}
                </tbody>
                {extra?.totals && (
                  <tfoot>
                    <tr className="table-row font-semibold bg-[#FAFAFA]">
                      <td className="table-td">TOTAL</td>
                      <td className="table-td text-right tabular-nums">{extra.totals.items}</td>
                      <td className="table-td text-right tabular-nums">{fmtWeight(extra.totals.gross_weight)}</td>
                      <td className="table-td text-right tabular-nums">{fmtWeight(extra.totals.stone_weight)}</td>
                      <td className="table-td text-right tabular-nums">{fmtWeight(extra.totals.net_weight)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        );
      }}
    />
  );
}
