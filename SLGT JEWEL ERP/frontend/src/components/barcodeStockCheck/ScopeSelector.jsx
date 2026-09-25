import { Layers, CheckCircle2 } from "lucide-react";

const FOREST = "#214F3A";

/**
 * "Stock Check Mode" — All Products vs. a single category. Each category
 * pill carries its own live progress badge (from the category-summary
 * endpoint) so the whole shop's verification status is visible at a glance
 * without leaving this screen or opening a separate report.
 */
export default function ScopeSelector({ mode, onSelect, categories, categorySummaries, allProductsSummary }) {
  const summaryFor = (categoryId) => categorySummaries.find((c) => c.category_id === categoryId);
  const isActive = (candidate) =>
    candidate.type === "all" ? mode.type === "all" : mode.type === "category" && mode.categoryId === candidate.categoryId;

  const Pill = ({ active, onClick, label, badge, complete }) => (
    <button
      type="button"
      onClick={onClick}
      className={`shrink-0 flex items-center gap-1.5 pl-3.5 pr-3 py-1.5 rounded-full text-[12.5px] font-medium transition-colors border ${
        active
          ? "text-white shadow-sm border-transparent"
          : "text-[#4E5A53] bg-[#FFFDF9] border-[#E2E7E2] hover:border-[#CBDED2] hover:bg-[#F1F4F0]"
      }`}
      style={active ? { background: FOREST } : undefined}
    >
      <span>{label}</span>
      {complete ? (
        <CheckCircle2 size={13} strokeWidth={2} className={active ? "text-white" : "text-green-600"} />
      ) : badge != null ? (
        <span className={`text-[10.5px] font-mono tabular-nums ${active ? "text-white/85" : "text-[#89928C]"}`}>{badge}</span>
      ) : null}
    </button>
  );

  return (
    <div className="mb-5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.1em] font-semibold text-[#89928C] mb-2">
        <Layers size={12} strokeWidth={1.5} />
        Stock Check Mode
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <Pill
          active={isActive({ type: "all" })}
          onClick={() => onSelect({ type: "all" })}
          label="All Products"
          complete={allProductsSummary?.is_complete}
          badge={
            allProductsSummary?.expected_pieces > 0
              ? `${Math.round((allProductsSummary.scanned_pieces / allProductsSummary.expected_pieces) * 100)}%`
              : null
          }
        />
        <span className="h-5 w-px bg-[#E2E7E2] shrink-0" />
        {categories.map((c) => {
          const s = summaryFor(c.id);
          return (
            <Pill
              key={c.id}
              active={isActive({ type: "category", categoryId: c.id })}
              onClick={() => onSelect({ type: "category", categoryId: c.id, categoryName: c.name })}
              label={c.name}
              complete={s?.is_complete}
              badge={s ? `${s.progress_pct}%` : null}
            />
          );
        })}
      </div>
    </div>
  );
}
