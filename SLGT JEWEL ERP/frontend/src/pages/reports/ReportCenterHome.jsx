import { useMemo, useState } from "react";
import { Search, ChevronRight, BookOpen, Landmark } from "lucide-react";
import {
  REPORT_CATEGORIES,
  reportsInCategory,
  searchReports,
} from "./reportCatalog";

export default function ReportCenterHome({
  onOpenReport,
  onOpenQuick,
  onOpenTab,
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState(null);

  const results = useMemo(() => {
    if (q.trim()) return searchReports(q);
    if (category) return reportsInCategory(category);
    return [];
  }, [q, category]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-[#0A0A0A]">Reports & Analytics</h1>
        <p className="mt-1 text-sm text-[#737373]">
          One report center — operational reports and accounting statements. Financial P&L / BS / TB come from journals.
        </p>
      </div>

      <div className="relative mb-5 max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#a3a3a3]" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCategory(null);
          }}
          placeholder="Search reports…"
          className="w-full rounded-xl border border-[#EADFBF] bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[#B49042]"
        />
      </div>

      {!q && !category ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {REPORT_CATEGORIES.map((c) => {
            const count = reportsInCategory(c.id).length;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className="rounded-xl border border-[#EADFBF] bg-[#FDFBF7] p-4 text-left transition hover:border-[#B49042] hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-[#0A0A0A]">{c.label}</div>
                  <ChevronRight className="h-4 w-4 text-[#B49042]" />
                </div>
                <div className="mt-1 text-[11px] text-[#737373]">{c.description}</div>
                <div className="mt-3 text-[11px] font-medium text-[#B49042]">{count} reports</div>
              </button>
            );
          })}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              className="text-xs text-[#B49042] hover:underline"
              onClick={() => {
                setCategory(null);
                setQ("");
              }}
            >
              ← All categories
            </button>
            {category ? (
              <span className="text-xs text-[#737373]">
                / {REPORT_CATEGORIES.find((c) => c.id === category)?.label}
              </span>
            ) : null}
          </div>
          <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  if (r.type === "tab") onOpenTab?.(r.tab);
                  else if (r.type === "quick") onOpenQuick?.(r.quick);
                  else onOpenReport?.(r);
                }}
                className="flex w-full items-center justify-between border-b border-[#F3F4F6] px-4 py-3 text-left last:border-0 hover:bg-[#FDFBF7]"
              >
                <div>
                  <div className="text-sm font-medium text-[#0A0A0A]">{r.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#737373]">
                    {r.source === "accounts" ? (
                      <span className="inline-flex items-center gap-1 text-[#B49042]">
                        <Landmark className="h-3 w-3" /> Accounting
                      </span>
                    ) : r.type === "tab" || r.type === "quick" ? (
                      <span className="inline-flex items-center gap-1">
                        <BookOpen className="h-3 w-3" /> Workspace
                      </span>
                    ) : (
                      <span>Operational</span>
                    )}
                    {r.description ? <span>· {r.description}</span> : null}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-[#a3a3a3]" />
              </button>
            ))}
            {!results.length ? (
              <div className="p-6 text-center text-sm text-[#737373]">No matching reports</div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
