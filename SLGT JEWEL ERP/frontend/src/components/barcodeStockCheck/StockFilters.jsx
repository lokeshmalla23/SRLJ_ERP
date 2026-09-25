import { Search } from "lucide-react";
import { FilterMultiSelect } from "@/pages/reports/FilterBar";

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
];

export default function StockFilters({
  filters,
  onChange,
  categories,
  subcategoriesFor,
  counters,
  purities,
  metalTypes = [],
  hideCategory = false,
}) {
  const set = (key, value) => onChange({ ...filters, [key]: value });
  const categoryIds = filters.category_id || [];
  const subcats = categoryIds.length ? categoryIds.flatMap((id) => subcategoriesFor(id)) : [];

  const setCategoryIds = (next) => {
    const allowed = new Set(next.flatMap((id) => subcategoriesFor(id)).map((c) => c.id));
    onChange({
      ...filters,
      category_id: next,
      subcategory_id: (filters.subcategory_id || []).filter((id) => allowed.has(id)),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4 p-3 rounded-xl border border-[#E2E7E2] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(23,56,42,0.04)]">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#89928C]" strokeWidth={1.5} />
        <input
          className="input pl-9"
          placeholder="Search item / barcode / tag…"
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
        />
      </div>

      {!hideCategory && (
        <FilterMultiSelect
          value={categoryIds}
          onChange={setCategoryIds}
          options={categories}
          placeholder="All categories"
          className="max-w-[160px]"
        />
      )}

      {!hideCategory && subcats.length > 0 && (
        <FilterMultiSelect
          value={filters.subcategory_id || []}
          onChange={(v) => set("subcategory_id", v)}
          options={subcats}
          placeholder="All sub-categories"
          className="max-w-[160px]"
        />
      )}

      <FilterMultiSelect
        value={filters.metal_type_id || []}
        onChange={(v) => set("metal_type_id", v)}
        options={metalTypes}
        placeholder="All metals"
        className="max-w-[140px]"
      />

      <FilterMultiSelect
        value={filters.counter_id || []}
        onChange={(v) => set("counter_id", v)}
        options={counters}
        placeholder="All counters"
        className="max-w-[140px]"
      />

      <FilterMultiSelect
        value={filters.purity_id || []}
        onChange={(v) => set("purity_id", v)}
        options={purities}
        placeholder="All purities"
        className="max-w-[130px]"
      />

      <FilterMultiSelect
        value={filters.status || []}
        onChange={(v) => set("status", v)}
        options={STATUS_OPTIONS}
        placeholder="All statuses"
        className="max-w-[150px]"
      />

      <label className="flex items-center gap-1.5 text-[12px] text-[#4F5B54] px-2 select-none cursor-pointer">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-[#BFC8C1] accent-[#214F3A]"
          checked={filters.show_completed}
          onChange={(e) => set("show_completed", e.target.checked)}
        />
        Show Completed
      </label>
    </div>
  );
}
