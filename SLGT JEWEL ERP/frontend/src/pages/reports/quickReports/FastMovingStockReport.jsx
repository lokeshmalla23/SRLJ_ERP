import { useMemo, useState } from "react";
import { fmtINR } from "@/lib/format";
import { FilterBar, FilterInput } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";

const localYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localYmd(d); };
const todayStr = () => localYmd(new Date());

export default function FastMovingStockReport({ onBack, includeHidden = false }) {
  const [from, setFrom] = useState(daysAgo(90));
  const [to, setTo] = useState(todayStr());
  const params = useMemo(() => ({
    from,
    to,
    include_hidden: includeHidden ? 1 : undefined,
  }), [from, to, includeHidden]);

  const columns = [
    { key: "rank", label: "Rank", align: "right" },
    { key: "product_name", label: "Product" },
    { key: "category_name", label: "Category", render: (r) => r.category_name || "—" },
    { key: "quantity_sold", label: "Quantity Sold", align: "right" },
    { key: "revenue", label: "Revenue", align: "right", format: "currency", render: (r) => fmtINR(r.revenue) },
    { key: "avg_selling_price", label: "Avg Selling Price", align: "right", format: "currency", render: (r) => fmtINR(r.avg_selling_price) },
  ];

  return (
    <QuickReportShell
      title="Fast Moving Stock"
      description="Top selling products for the selected period"
      endpoint="/reports/inventory/fast-moving"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No sales recorded in this period."
      filterBar={(
        <FilterBar>
          <FilterInput label="From" type="date" value={from} onChange={setFrom} />
          <FilterInput label="To" type="date" value={to} onChange={setTo} />
        </FilterBar>
      )}
    />
  );
}
