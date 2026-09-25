import { useMemo, useState } from "react";
import { fmtDate, fmtWeight } from "@/lib/format";
import { useFilterOptions } from "../useFilterOptions";
import { FilterBar, FilterMultiSelect, FilterInput } from "../FilterBar";
import QuickReportShell from "../QuickReportShell";

const STATUS_OPTIONS = [
  { value: "available", label: "Available" },
  { value: "on_display", label: "On Display" },
  { value: "reserved", label: "Reserved" },
];

export default function StockCheckReport({ onBack }) {
  const { categories, subcategoriesFor, counters, purities, vendors, metalTypes } = useFilterOptions();
  const [categoryIds, setCategoryIds] = useState([]);
  const [subcategoryIds, setSubcategoryIds] = useState([]);
  const [counterIds, setCounterIds] = useState([]);
  const [purityIds, setPurityIds] = useState([]);
  const [metalIds, setMetalIds] = useState([]);
  const [vendorIds, setVendorIds] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [q, setQ] = useState("");
  const [checked, setChecked] = useState(() => new Set());

  const subcategoryOptions = categoryIds.length
    ? categoryIds.flatMap((id) => subcategoriesFor(id))
    : [];

  const params = useMemo(() => ({
    category_id: categoryIds.length ? categoryIds.join(",") : undefined,
    subcategory_id: subcategoryIds.length ? subcategoryIds.join(",") : undefined,
    counter_id: counterIds.length ? counterIds.join(",") : undefined,
    purity_id: purityIds.length ? purityIds.join(",") : undefined,
    metal_type_id: metalIds.length ? metalIds.join(",") : undefined,
    vendor_id: vendorIds.length ? vendorIds.join(",") : undefined,
    status: statuses.length ? statuses.join(",") : undefined,
    q: q || undefined,
    sort_by: "created_at",
  }), [categoryIds, subcategoryIds, counterIds, purityIds, metalIds, vendorIds, statuses, q]);

  const toggleChecked = (id) => setChecked((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const columns = [
    {
      key: "sno",
      label: "S.No",
      align: "right",
      printHide: true,
      exportValue: () => "",
      render: (_r, idx, meta) => ((meta?.page || 1) - 1) * (meta?.pageSize || 25) + idx + 1,
    },
    { key: "code", label: "Tag No", render: (r) => r.code || "—" },
    { key: "name", label: "Product" },
    { key: "category_name", label: "Category", render: (r) => r.category_name || "—" },
    { key: "purity_name", label: "Purity", render: (r) => r.purity_name || "—" },
    {
      key: "stock_qty",
      label: "Pcs",
      align: "right",
      exportValue: (r) => (r.inventory_mode === "unique_tag" ? 1 : Number(r.stock_qty) || 0),
      render: (r) => (r.inventory_mode === "unique_tag" ? 1 : Number(r.stock_qty) || 0),
    },
    { key: "gross_weight", label: "Gross Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.gross_weight) },
    { key: "stone_weight", label: "Stone Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.stone_weight) },
    { key: "net_weight", label: "Net Wt", align: "right", format: "weight", render: (r) => fmtWeight(r.net_weight) },
    { key: "counter_name", label: "Counter", render: (r) => r.counter_name || "—" },
    {
      key: "stock_in_date",
      label: "Stock in Date",
      format: "date",
      render: (r) => {
        const d = r.stock_in_date || r.purchase_date || r.created_at || r.createdAt;
        return d ? fmtDate(d) : "—";
      },
      exportValue: (r) => r.stock_in_date || r.purchase_date || r.created_at || r.createdAt || "",
    },
    {
      key: "verified",
      label: "✓",
      format: "checkbox",
      exportValue: () => "☐",
      render: (r) => (
        <input type="checkbox" className="accent-[#315C4A]" checked={checked.has(r.id)} onChange={() => toggleChecked(r.id)} />
      ),
    },
  ];

  return (
    <QuickReportShell
      title="Stock Check"
      description="Physical stock verification worksheet"
      endpoint="/reports/inventory/stock-check"
      params={params}
      columns={columns}
      onBack={onBack}
      emptyMessage="No stock matches these filters."
      exportLimit={5000}
      defaultOrientation="landscape"
      filterBar={(
        <>
          <FilterBar>
            <FilterMultiSelect
              label="Category"
              value={categoryIds}
              onChange={(next) => {
                setCategoryIds(next);
                const allowed = new Set(next.flatMap((id) => subcategoriesFor(id)).map((c) => c.id));
                setSubcategoryIds((prev) => prev.filter((id) => allowed.has(id)));
              }}
              options={categories}
            />
            <FilterMultiSelect label="Sub Category" value={subcategoryIds} onChange={setSubcategoryIds} options={subcategoryOptions} />
            <FilterMultiSelect label="Metal" value={metalIds} onChange={setMetalIds} options={metalTypes} />
            <FilterMultiSelect label="Counter" value={counterIds} onChange={setCounterIds} options={counters} />
            <FilterMultiSelect label="Purity" value={purityIds} onChange={setPurityIds} options={purities} />
            <FilterMultiSelect label="Vendor" value={vendorIds} onChange={setVendorIds} options={vendors} />
            <FilterMultiSelect label="Status" value={statuses} onChange={setStatuses} options={STATUS_OPTIONS} />
            <FilterInput label="Search Tag / Barcode" value={q} onChange={setQ} placeholder="Tag no. or barcode" />
          </FilterBar>
          <div className="text-[12px] text-[#737373] mb-3">
            Verified on screen: <span className="font-semibold text-[#166534]">{checked.size}</span> · Remaining: <span className="font-semibold text-[#92400E]">{"—"}</span>
            <span className="text-[11px] text-[#a3a3a3] ml-2">(printed sheet always shows an empty checkbox for the physical count)</span>
          </div>
        </>
      )}
    />
  );
}
