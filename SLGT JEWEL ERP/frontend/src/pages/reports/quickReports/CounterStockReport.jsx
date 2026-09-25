import { useMemo, useState } from "react";
import { fmtINR, fmtWeight } from "@/lib/format";
import { useFilterOptions } from "../useFilterOptions";
import { FilterBar, FilterMultiSelect } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";

export default function CounterStockReport({ onBack }) {
  const { categories, counters, purities, metalTypes } = useFilterOptions();
  const [counterIds, setCounterIds] = useState([]);
  const [categoryIds, setCategoryIds] = useState([]);
  const [metalIds, setMetalIds] = useState([]);
  const [purityIds, setPurityIds] = useState([]);

  const params = useMemo(() => ({
    counter_id: counterIds.length ? counterIds.join(",") : undefined,
    category_id: categoryIds.length ? categoryIds.join(",") : undefined,
    metal_type_id: metalIds.length ? metalIds.join(",") : undefined,
    purity_id: purityIds.length ? purityIds.join(",") : undefined,
  }), [counterIds, categoryIds, metalIds, purityIds]);

  const columns = [
    { key: "counter_name", label: "Counter Name" },
    { key: "items", label: "Total Items", align: "right" },
    { key: "pieces", label: "Pieces", align: "right" },
    { key: "gross_weight", label: "Gross Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.gross_weight) },
    { key: "stone_weight", label: "Stone Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.stone_weight) },
    { key: "net_weight", label: "Net Weight", align: "right", format: "weight", render: (r) => fmtWeight(r.net_weight) },
    { key: "stock_value", label: "Stock Value", align: "right", format: "currency", render: (r) => fmtINR(r.stock_value) },
  ];

  return (
    <QuickReportShell
      title="Counter Stock"
      description="Counter-wise stock availability"
      endpoint="/reports/inventory/counter-stock"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No products are assigned to a counter yet."
      filterBar={(
        <FilterBar>
          <FilterMultiSelect label="Counter" value={counterIds} onChange={setCounterIds} options={counters} />
          <FilterMultiSelect label="Category" value={categoryIds} onChange={setCategoryIds} options={categories} />
          <FilterMultiSelect label="Metal" value={metalIds} onChange={setMetalIds} options={metalTypes} />
          <FilterMultiSelect label="Purity" value={purityIds} onChange={setPurityIds} options={purities} />
        </FilterBar>
      )}
    />
  );
}
