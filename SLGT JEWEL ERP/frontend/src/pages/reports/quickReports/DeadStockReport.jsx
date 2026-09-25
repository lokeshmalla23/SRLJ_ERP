import { useMemo, useState } from "react";
import { fmtINR, fmtWeight } from "@/lib/format";
import { FilterBar, FilterField } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";

const AGE_FILTERS = [
  { value: 30, label: "30 Days" },
  { value: 60, label: "60 Days" },
  { value: 90, label: "90 Days" },
  { value: 180, label: "180 Days" },
  { value: 365, label: "365+ Days" },
];

export default function DeadStockReport({ onBack }) {
  const [minDays, setMinDays] = useState(90);
  const params = useMemo(() => ({ min_days: minDays }), [minDays]);

  const columns = [
    { key: "code", label: "Tag Number" },
    { key: "name", label: "Product" },
    { key: "category_name", label: "Category", render: (r) => r.category_name || "—" },
    { key: "counter_name", label: "Counter", render: (r) => r.counter_name || "—" },
    { key: "gross_weight", label: "Gross Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.gross_weight) },
    { key: "stone_weight", label: "Stone Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.stone_weight) },
    { key: "net_weight", label: "Net Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.net_weight) },
    { key: "days_unsold", label: "Days Unsold", align: "right" },
    { key: "current_value", label: "Current Value", align: "right", format: "currency", render: (r) => fmtINR(r.current_value) },
  ];

  return (
    <QuickReportShell
      title="Dead Stock"
      description="Items not sold for a long time"
      endpoint="/reports/inventory/dead-stock"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No dead stock in this age range."
      filterBar={(
        <FilterBar>
          <FilterField label="Unsold For">
            <div className="flex gap-1.5">
              {AGE_FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={() => setMinDays(f.value)}
                  className={minDays === f.value ? "btn-primary !rounded-[9px] !border-[#315C4A] !bg-[#315C4A] !py-1 !text-[11.5px] hover:!bg-[#244A3A]" : "btn-secondary !rounded-[9px] !border-[#D2CCBF] !bg-[#FFFDF9] !py-1 !text-[11.5px] hover:!border-[#9EB2A6] hover:!bg-[#F1F5F1]"}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </FilterField>
        </FilterBar>
      )}
    />
  );
}
