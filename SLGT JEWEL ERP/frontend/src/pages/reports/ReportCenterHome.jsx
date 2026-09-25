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

      <div className="relative mb-5 max-w-xl rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-1 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
        <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A837D]" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setCategory(null);
          }}
          placeholder="Search reports…"
          className="w-full rounded-[9px] border border-transparent bg-transparent py-2.5 pl-10 pr-3 text-sm text-[#24332B] outline-none placeholder:text-[#9AA19C] focus:border-[#9EB2A6] focus:ring-2 focus:ring-[#DDE8E0]"
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
                className="rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] p-4 text-left shadow-[0_1px_2px_rgba(38,52,43,0.04)] transition hover:-translate-y-0.5 hover:border-[#9EB2A6] hover:shadow-[0_10px_26px_rgba(42,71,55,0.08)]"
              >
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-[#0A0A0A]">{c.label}</div>
                  <ChevronRight className="h-4 w-4 text-[#8A6A2D]" />
                </div>
                <div className="mt-1 text-[11px] text-[#737373]">{c.description}</div>
                <div className="mt-3 text-[11px] font-medium text-[#65736B]">{count} reports</div>
              </button>
            );
          })}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              className="text-xs font-medium text-[#315C4A] hover:underline"
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
          <div className="overflow-hidden rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
            {results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  if (r.type === "tab") onOpenTab?.(r.tab);
                  else if (r.type === "quick") onOpenQuick?.(r.quick);
                  else onOpenReport?.(r);
                }}
                className="flex w-full items-center justify-between border-b border-[#E6E1D7] px-4 py-3 text-left last:border-0 hover:bg-[#F7F5EF]"
              >
                <div>
                  <div className="text-sm font-medium text-[#0A0A0A]">{r.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#737373]">
                    {r.source === "accounts" ? (
                      <span className="inline-flex items-center gap-1 text-[#8A6A2D]">
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
