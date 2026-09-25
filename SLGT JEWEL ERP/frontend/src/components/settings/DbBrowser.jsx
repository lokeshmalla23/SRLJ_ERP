import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Loader2,
  RefreshCw,
  Search,
  Table2,
  X,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";

const PAGE_SIZES = [100, 200, 500, 1000, 2000];
/** Max chars shown inline in the grid (full value on click / title). */
const CELL_PREVIEW_LEN = 120;

function formatCell(v) {
  if (v === null || v === undefined) return { kind: "null", text: "" };
  if (typeof Buffer !== "undefined" && Buffer.isBuffer?.(v)) {
    return { kind: "text", text: `<blob ${v.length} bytes>` };
  }
  if (typeof v === "object") {
    try {
      return { kind: "text", text: JSON.stringify(v) };
    } catch {
      return { kind: "text", text: String(v) };
    }
  }
  return { kind: "text", text: String(v) };
}

function previewText(text) {
  if (!text || text.length <= CELL_PREVIEW_LEN) return text;
  return `${text.slice(0, CELL_PREVIEW_LEN)}…`;
}

function prettyCellText(text) {
  if (!text) return text;
  const t = text.trim();
  if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      /* keep raw */
    }
  }
  return text;
}

/**
 * Full-screen MySQL-like read-only DB browser (shop owner).
 * Opened via 5 clicks on Settings → Backup & Export.
 */
export default function DbBrowser({ open, onClose }) {
  const [tables, setTables] = useState([]);
  const [dialect, setDialect] = useState("");
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tableFilter, setTableFilter] = useState("");
  const [activeTable, setActiveTable] = useState(null);

  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(500);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [orderBy, setOrderBy] = useState(null);
  const [orderDir, setOrderDir] = useState("ASC");
  const [rowsLoading, setRowsLoading] = useState(false);
  /** { col, rowIndex, kind, text } | null — MySQL-style cell viewer */
  const [cellView, setCellView] = useState(null);

  const loadTables = useCallback(async () => {
    setTablesLoading(true);
    try {
      const { data } = await api.get("/db-browser/tables");
      setDialect(data.dialect || "");
      setTables(data.tables || []);
      setActiveTable((prev) => {
        if (prev && (data.tables || []).some((t) => t.name === prev)) return prev;
        return data.tables?.[0]?.name || null;
      });
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to load tables");
    } finally {
      setTablesLoading(false);
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!activeTable) return;
    setRowsLoading(true);
    try {
      const { data } = await api.get(`/db-browser/tables/${encodeURIComponent(activeTable)}/rows`, {
        params: {
          q: search || undefined,
          limit: pageSize,
          offset,
          order_by: orderBy || undefined,
          order_dir: orderDir,
        },
        timeout: 60000,
      });
      setColumns(data.columns || []);
      setRows(data.rows || []);
      setTotal(Number(data.total) || 0);
    } catch (err) {
      toast.error(formatApiError(err) || "Failed to load rows");
      setRows([]);
      setTotal(0);
    } finally {
      setRowsLoading(false);
    }
  }, [activeTable, search, offset, orderBy, orderDir, pageSize]);

  useEffect(() => {
    if (!open) return;
    loadTables();
  }, [open, loadTables]);

  useEffect(() => {
    if (!open || !activeTable) return;
    setCellView(null);
    loadRows();
  }, [open, activeTable, search, offset, orderBy, orderDir, pageSize, loadRows]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    if (!q) return tables;
    return tables.filter((t) => t.name.toLowerCase().includes(q));
  }, [tables, tableFilter]);

  const page = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const fromRow = total === 0 ? 0 : offset + 1;
  const toRow = Math.min(offset + rows.length, total);

  const selectTable = (name) => {
    setActiveTable(name);
    setSearch("");
    setSearchInput("");
    setOffset(0);
    setOrderBy(null);
    setOrderDir("ASC");
    setCellView(null);
  };

  const toggleSort = (colName) => {
    if (orderBy === colName) {
      setOrderDir((d) => (d === "ASC" ? "DESC" : "ASC"));
    } else {
      setOrderBy(colName);
      setOrderDir("ASC");
    }
    setOffset(0);
  };

  const runSearch = (e) => {
    e?.preventDefault?.();
    setSearch(searchInput.trim());
    setOffset(0);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-[#151A16] text-[#E8EDE7]"
      data-testid="db-browser"
      role="dialog"
      aria-modal="true"
      aria-label="Database browser"
    >
      <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[#334139] bg-[#1C241E] px-4">
        <Database size={16} className="text-[#D0B15F]" strokeWidth={1.5} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold tracking-wide">Database Browser</div>
          <div className="text-[11px] text-[#96A198]">
            Read-only · {dialect || "sql"} · Esc to close
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            loadTables();
            if (activeTable) loadRows();
          }}
          className="inline-flex items-center gap-1.5 rounded-[7px] border border-[#334139] bg-[#202A22] px-2.5 py-1.5 text-[12px] text-[#C5CEC5] transition-colors hover:bg-[#29362C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#86A18D]/35"
          title="Refresh tables"
        >
          <RefreshCw size={12} strokeWidth={1.5} />
          Refresh
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] border border-[#334139] bg-[#202A22] text-[#C5CEC5] transition-colors hover:bg-[#29362C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#86A18D]/35"
          aria-label="Close"
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-[#334139] bg-[#111711]">
          <div className="border-b border-[#334139] p-2">
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#718076]" />
              <input
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
                placeholder="Filter tables…"
                className="w-full rounded-[7px] border border-[#334139] bg-[#202A22] py-1.5 pl-7 pr-2 text-[12px] text-[#E8EDE7] outline-none transition-colors placeholder:text-[#718076] focus:border-[#86A18D] focus:ring-2 focus:ring-[#86A18D]/15"
              />
            </div>
            <div className="mt-1.5 px-0.5 text-[10px] text-[#718076]">
              {tables.length} table{tables.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {tablesLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-[#96A198]">
                <Loader2 size={14} className="animate-spin" /> Loading tables…
              </div>
            ) : filteredTables.length === 0 ? (
              <div className="px-2 py-3 text-[12px] text-[#96A198]">No tables</div>
            ) : (
              filteredTables.map((t) => {
                const active = t.name === activeTable;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => selectTable(t.name)}
                    className={`mb-0.5 flex w-full items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#86A18D]/35 ${
                      active
                        ? "bg-[#2C503A] text-[#E8EDE7]"
                        : "text-[#C5CEC5] hover:bg-[#202A22]"
                    }`}
                  >
                    <Table2 size={12} className="shrink-0 opacity-70" strokeWidth={1.5} />
                    <span className="min-w-0 flex-1 truncate font-mono">{t.name}</span>
                    <span className="shrink-0 tabular-nums text-[10px] text-[#96A198]">
                      {t.row_count == null ? "—" : Number(t.row_count).toLocaleString()}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#334139] bg-[#1C241E] px-3 py-2">
            <div className="font-mono text-[13px] font-semibold text-[#D0B15F]">
              {activeTable || "—"}
            </div>
            <div className="text-[11px] text-[#96A198]">
              {total.toLocaleString()} total row{total === 1 ? "" : "s"}
              {search ? " · filtered" : ""}
              {columns.length ? ` · ${columns.length} columns` : ""}
            </div>
            <form onSubmit={runSearch} className="ml-auto flex min-w-[220px] max-w-md flex-1 items-center gap-2">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#718076]" />
                <input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search all columns…"
                  className="w-full rounded-[7px] border border-[#334139] bg-[#202A22] py-1.5 pl-7 pr-2 text-[12px] text-[#E8EDE7] outline-none transition-colors placeholder:text-[#718076] focus:border-[#86A18D] focus:ring-2 focus:ring-[#86A18D]/15"
                />
              </div>
              <button
                type="submit"
                className="rounded-[7px] border border-[#334139] bg-[#202A22] px-3 py-1.5 text-[12px] hover:bg-[#29362C]"
              >
                Search
              </button>
              {search ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setOffset(0);
                  }}
                  className="rounded-[7px] border border-[#334139] px-2 py-1.5 text-[12px] text-[#96A198] hover:bg-[#29362C]"
                >
                  Clear
                </button>
              ) : null}
            </form>
          </div>

          <div className="relative min-h-0 flex-1 overflow-auto">
            {rowsLoading ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#151A16]/70">
                <Loader2 size={22} className="animate-spin text-[#D0B15F]" />
              </div>
            ) : null}
            {!activeTable ? (
              <div className="p-6 text-[13px] text-[#96A198]">Select a table</div>
            ) : (
              <table className="w-max border-collapse text-left text-[12px]">
                <thead className="sticky top-0 z-[1]">
                  <tr className="bg-[#202A22]">
                    <th className="sticky left-0 z-[2] w-12 border-b border-r border-[#334139] bg-[#202A22] px-2 py-1.5 font-medium text-[#96A198]">
                      #
                    </th>
                    {columns.map((col) => {
                      const sorted = orderBy === col.name;
                      return (
                        <th
                          key={col.name}
                          className="max-w-[220px] whitespace-nowrap border-b border-[#334139] px-2 py-1.5 font-medium text-[#C5CEC5]"
                        >
                          <button
                            type="button"
                            onClick={() => toggleSort(col.name)}
                            className="inline-flex max-w-full items-center gap-1 overflow-hidden hover:text-white"
                            title={`${col.type}${col.primary_key ? " · PK" : ""}`}
                          >
                            <span className="truncate font-mono">{col.name}</span>
                            {sorted ? (
                              <span className="shrink-0 text-[10px] text-[#D0B15F]">{orderDir === "ASC" ? "▲" : "▼"}</span>
                            ) : null}
                            {col.sensitive ? (
                              <span className="shrink-0 text-[9px] uppercase tracking-wide text-amber-400/80">masked</span>
                            ) : null}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={Math.max(columns.length + 1, 2)}
                        className="px-3 py-8 text-center text-[13px] text-[#96A198]"
                      >
                        No rows
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => {
                      const odd = i % 2 === 0;
                      const rowBg = odd ? "bg-[#111711]" : "bg-[#151A16]";
                      return (
                        <tr key={i} className={`h-8 hover:bg-[#1E2A21] ${rowBg}`}>
                          <td
                            className={`sticky left-0 z-[1] whitespace-nowrap border-b border-r border-[#202A22] px-2 py-0.5 tabular-nums text-[#718076] ${rowBg}`}
                          >
                            {offset + i + 1}
                          </td>
                          {columns.map((col) => {
                            const cell = formatCell(row[col.name]);
                            const selected =
                              cellView &&
                              cellView.rowIndex === i &&
                              cellView.col === col.name;
                            return (
                              <td
                                key={col.name}
                                role="button"
                                tabIndex={0}
                                onClick={() =>
                                  setCellView({
                                    col: col.name,
                                    rowIndex: i,
                                    kind: cell.kind,
                                    text: cell.text,
                                  })
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    setCellView({
                                      col: col.name,
                                      rowIndex: i,
                                      kind: cell.kind,
                                      text: cell.text,
                                    });
                                  }
                                }}
                                className={`max-w-[220px] cursor-default overflow-hidden text-ellipsis whitespace-nowrap border-b border-[#202A22] px-2 py-0.5 font-mono text-[11.5px] text-[#D6DDD5] ${
                                  selected ? "bg-[#2C503A] text-white" : ""
                                }`}
                                title={
                                  cell.kind === "null"
                                    ? "NULL — click to view"
                                    : `${cell.text}\n\n(Click to view full value)`
                                }
                              >
                                {cell.kind === "null" ? (
                                  <span className="text-[#5A685E]">NULL</span>
                                ) : (
                                  previewText(cell.text)
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            )}
          </div>

          {cellView ? (
            <div className="flex max-h-[40%] min-h-[120px] shrink-0 flex-col border-t border-[#334139] bg-[#111711]">
              <div className="flex items-center gap-2 border-b border-[#334139] px-3 py-1.5">
                <span className="font-mono text-[12px] text-[#D0B15F]">{cellView.col}</span>
                <span className="text-[11px] text-[#718076]">
                  row {offset + cellView.rowIndex + 1}
                  {cellView.kind === "null"
                    ? " · NULL"
                    : ` · ${cellView.text.length.toLocaleString()} chars`}
                </span>
                <div className="ml-auto flex items-center gap-1.5">
                  {cellView.kind !== "null" && cellView.text ? (
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(cellView.text);
                          toast.success("Copied");
                        } catch {
                          toast.error("Copy failed");
                        }
                      }}
                      className="rounded-[7px] border border-[#334139] bg-[#202A22] px-2 py-1 text-[11px] hover:bg-[#29362C]"
                    >
                      Copy
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setCellView(null)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-[7px] border border-[#334139] text-[#96A198] hover:bg-[#29362C]"
                    aria-label="Close cell viewer"
                  >
                    <X size={12} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[12px] text-[#E8EDE7]">
                {cellView.kind === "null" ? (
                  <span className="text-[#5A685E]">NULL</span>
                ) : (
                  prettyCellText(cellView.text)
                )}
              </pre>
            </div>
          ) : null}

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#334139] bg-[#1C241E] px-3 py-2 text-[12px]">
            <div className="text-[#96A198]">
              Showing {fromRow.toLocaleString()}–{toRow.toLocaleString()} of {total.toLocaleString()}
              {" · "}Page {page} / {pageCount}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5 text-[#96A198]">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setOffset(0);
                  }}
                  className="rounded-[7px] border border-[#334139] bg-[#202A22] px-2 py-1 text-[#E8EDE7] outline-none"
                >
                  {PAGE_SIZES.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={offset <= 0 || rowsLoading}
                onClick={() => setOffset((o) => Math.max(0, o - pageSize))}
                className="inline-flex items-center gap-1 rounded-[7px] border border-[#334139] bg-[#202A22] px-2.5 py-1 disabled:opacity-40 hover:bg-[#29362C]"
              >
                <ChevronLeft size={14} /> Prev
              </button>
              <button
                type="button"
                disabled={offset + pageSize >= total || rowsLoading}
                onClick={() => setOffset((o) => o + pageSize)}
                className="inline-flex items-center gap-1 rounded-[7px] border border-[#334139] bg-[#202A22] px-2.5 py-1 disabled:opacity-40 hover:bg-[#29362C]"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
