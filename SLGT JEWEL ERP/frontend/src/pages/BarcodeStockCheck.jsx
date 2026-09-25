import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, RotateCcw, Download, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import { fmtDateTime } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { useFilterOptions } from "@/pages/reports/useFilterOptions";
import useConfirm from "@/hooks/useConfirm";
import ScanInput from "@/components/barcodeStockCheck/ScanInput";
import StockSummaryCards from "@/components/barcodeStockCheck/StockSummaryCards";
import StockFilters from "@/components/barcodeStockCheck/StockFilters";
import PendingStockTable from "@/components/barcodeStockCheck/PendingStockTable";
import ManualVerificationTable from "@/components/barcodeStockCheck/ManualVerificationTable";
import ScanHistoryPanel from "@/components/barcodeStockCheck/ScanHistoryPanel";
import CompletionModal from "@/components/barcodeStockCheck/CompletionModal";
import ScopeSelector from "@/components/barcodeStockCheck/ScopeSelector";

// Kept as the exact original key so an already-active "All Products" session
// survives this upgrade instead of silently starting a fresh one.
const SESSION_STORAGE_KEY_ALL = "ssj_barcode_stock_check_session_id";
const ACK_STORAGE_PREFIX = "ssj_barcode_stock_check_ack_";

const sessionKeyFor = (mode) =>
  mode.type === "category" ? `ssj_barcode_stock_check_session_id__cat_${mode.categoryId}` : SESSION_STORAGE_KEY_ALL;

const DEFAULT_FILTERS = {
  search: "",
  category_id: [],
  subcategory_id: [],
  counter_id: [],
  purity_id: [],
  metal_type_id: [],
  status: [],
  show_completed: false,
};

export default function BarcodeStockCheck() {
  const { user } = useAuth();
  const { categories, subcategoriesFor, counters, purities, metalTypes } = useFilterOptions();
  const [confirm, confirmModal] = useConfirm();

  const [mode, setMode] = useState({ type: "all" });
  const [session, setSession] = useState(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [summary, setSummary] = useState(null);
  const [stock, setStock] = useState(null);
  const [manual, setManual] = useState(null);
  const [history, setHistory] = useState([]);
  const [categorySummaries, setCategorySummaries] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [stockLoading, setStockLoading] = useState(true);
  const [scanBusy, setScanBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [showCompletion, setShowCompletion] = useState(false);
  const [resetting, setResetting] = useState(false);

  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  /* ── resolve/create the session for whichever scope is selected — each
   * scope (All Products, or a single category) keeps its own resumable
   * session, so switching modes never mixes their scan progress ── */
  const resolveSession = useCallback(async (targetMode) => {
    setSessionReady(false);
    const key = sessionKeyFor(targetMode);
    const storedId = localStorage.getItem(key);
    try {
      if (storedId) {
        const { data } = await api.get(`/barcode-stock-check/sessions/${storedId}`);
        setSession(data);
        return;
      }
      throw new Error("no stored session");
    } catch {
      try {
        const body = targetMode.type === "category" ? { category_id: targetMode.categoryId } : {};
        const { data } = await api.post("/barcode-stock-check/sessions", body);
        setSession(data);
        localStorage.setItem(key, data.id);
      } catch (err) {
        toast.error(formatApiError(err));
      }
    } finally {
      setSessionReady(true);
    }
  }, []);

  useEffect(() => {
    resolveSession(mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const switchMode = (targetMode) => {
    const same = targetMode.type === "all"
      ? mode.type === "all"
      : mode.type === "category" && mode.categoryId === targetMode.categoryId;
    if (same) return;
    setSession(null);
    setSummary(null);
    setStock(null);
    setLastResult(null);
    setFilters(DEFAULT_FILTERS);
    setPage(1);
    setMode(targetMode);
  };

  const sessionId = session?.id;

  const loadCategorySummaries = useCallback(async () => {
    try {
      const { data } = await api.get("/barcode-stock-check/category-summary");
      setCategorySummaries(data.items || []);
    } catch { /* non-critical — pill badges just stay blank */ }
  }, []);

  useEffect(() => { loadCategorySummaries(); }, [loadCategorySummaries]);

  /* ── data loaders ── */
  const loadSummary = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data } = await api.get(`/barcode-stock-check/sessions/${sessionId}/summary`);
      setSummary(data);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  }, [sessionId]);

  const loadStock = useCallback(async () => {
    if (!sessionId) return;
    setStockLoading(true);
    try {
      const params = { page, page_size: 50, show_completed: filters.show_completed ? "1" : "0" };
      if (filters.search) params.search = filters.search;
      if (filters.category_id?.length) params.category_id = filters.category_id.join(",");
      if (filters.subcategory_id?.length) params.subcategory_id = filters.subcategory_id.join(",");
      if (filters.counter_id?.length) params.counter_id = filters.counter_id.join(",");
      if (filters.purity_id?.length) params.purity_id = filters.purity_id.join(",");
      if (filters.metal_type_id?.length) params.metal_type_id = filters.metal_type_id.join(",");
      if (filters.status?.length) params.status = filters.status.join(",");
      const { data } = await api.get(`/barcode-stock-check/sessions/${sessionId}/stock`, { params });
      setStock(data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setStockLoading(false);
    }
  }, [sessionId, page, filters]);

  const loadManual = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data } = await api.get(`/barcode-stock-check/sessions/${sessionId}/manual-verification`, { params: { page_size: 200 } });
      setManual(data);
    } catch { /* non-critical */ }
  }, [sessionId]);

  const loadHistory = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data } = await api.get(`/barcode-stock-check/sessions/${sessionId}/history`, { params: { limit: 30 } });
      setHistory(data);
    } catch { /* non-critical */ }
  }, [sessionId]);

  const loadAll = useCallback(() => {
    loadSummary();
    loadStock();
    loadManual();
    loadHistory();
    loadCategorySummaries();
  }, [loadSummary, loadStock, loadManual, loadHistory, loadCategorySummaries]);

  useEffect(() => {
    if (sessionId) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /* ── refetch stock list when filters/page change (debounced for search) ── */
  useEffect(() => {
    if (!sessionId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadStock(), filters.search ? 300 : 0);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, page, filters]);

  useEffect(() => { setPage(1); }, [filters.search, filters.category_id, filters.subcategory_id, filters.counter_id, filters.purity_id, filters.metal_type_id, filters.status, filters.show_completed]);

  /* ── completion popup — once per session, acknowledged flag survives reload ── */
  useEffect(() => {
    if (!summary?.is_complete || !sessionId) return;
    const ackKey = `${ACK_STORAGE_PREFIX}${sessionId}`;
    if (localStorage.getItem(ackKey)) return;
    setShowCompletion(true);
  }, [summary?.is_complete, sessionId]);

  const acknowledgeCompletion = () => {
    if (sessionId) localStorage.setItem(`${ACK_STORAGE_PREFIX}${sessionId}`, "1");
    setShowCompletion(false);
  };

  /* ── scan handler ── */
  const handleScan = async (barcode) => {
    if (!sessionId) return;
    setScanBusy(true);
    try {
      const { data } = await api.post(`/barcode-stock-check/sessions/${sessionId}/scan`, { barcode });
      setLastResult(data);
      if (data.result === "matched") {
        toast.success(`${data.barcode} · ${data.scanned_quantity}/${data.expected_quantity}`);
      } else if (data.result === "already_completed") {
        toast.warning(`${data.barcode} already fully verified`);
      } else if (data.result === "wrong_category") {
        toast.error(`Belongs to ${data.actual_category_name || "another category"} — currently checking ${data.expected_category_name || "a different category"}`);
      } else {
        toast.error(`${data.barcode} not found in ERP stock`);
      }
      loadSummary();
      loadStock();
      loadHistory();
      loadCategorySummaries();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setScanBusy(false);
    }
  };

  /* ── reset session ── */
  const handleReset = async () => {
    if (!sessionId) return;
    const ok = await confirm(
      "All scan progress from this verification session will be cleared. Physical ERP inventory is not affected.",
      { title: "Reset Stock Check?", confirmLabel: "Reset", danger: true },
    );
    if (!ok) return;
    setResetting(true);
    try {
      await api.post(`/barcode-stock-check/sessions/${sessionId}/reset`, {});
      if (sessionId) localStorage.removeItem(`${ACK_STORAGE_PREFIX}${sessionId}`);
      setLastResult(null);
      toast.success("Stock check reset");
      loadAll();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setResetting(false);
    }
  };

  /* ── export CSV (fetches full unpaginated list) ── */
  const exportCsv = async () => {
    if (!sessionId) return;
    try {
      const { data } = await api.get(`/barcode-stock-check/sessions/${sessionId}/stock`, { params: { all: "1", show_completed: "1" } });
      const cols = ["barcode", "item_name", "category_name", "purity_name", "expected_quantity", "scanned_quantity", "pending_quantity", "gross_weight", "net_weight", "status"];
      const header = cols.join(",") + "\n";
      const escape = (v) => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const rows = (data.items || []).map((r) => cols.map((c) => escape(r[c])).join(",")).join("\n");
      const blob = new Blob([header + rows], { type: "text/csv" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "barcode-stock-check.csv";
      a.click();
      toast.success("Verification report exported");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const hasDiscrepancy = summary?.has_discrepancy;
  const scopeLabel = mode.type === "category" ? mode.categoryName : "All Products";

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Barcode Stock Check"
        subtitle={
          mode.type === "category"
            ? `Verifying ${mode.categoryName} stock against ERP inventory.`
            : "Verify physical jewellery stock against ERP inventory."
        }
        actions={
          <>
            <span className="text-[11px] text-[#a3a3a3] font-mono self-center mr-1">{fmtDateTime(new Date())}</span>
            {user?.name && <span className="text-[11.5px] text-[#737373] self-center mr-2">{user.name}</span>}
            <button type="button" className="btn-secondary" onClick={loadAll}>
              <RefreshCw size={14} strokeWidth={1.5} /> Refresh
            </button>
            <button type="button" className="btn-secondary" onClick={exportCsv}>
              <Download size={14} strokeWidth={1.5} /> Export
            </button>
            <button type="button" className="btn-secondary" onClick={handleReset} disabled={resetting}>
              <RotateCcw size={14} strokeWidth={1.5} /> Reset Check
            </button>
          </>
        }
      />

      <ScopeSelector
        mode={mode}
        onSelect={switchMode}
        categories={categories}
        categorySummaries={categorySummaries}
        allProductsSummary={mode.type === "all" ? summary : null}
      />

      {hasDiscrepancy && (
        <div className="mb-5 flex items-start gap-2.5 px-4 py-3 rounded-md bg-amber-50 border border-amber-200">
          <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
          <div className="text-[12.5px] text-amber-800">
            Inventory changed for {summary.discrepancy_barcodes} barcode{summary.discrepancy_barcodes !== 1 ? "s" : ""} since some scans were recorded.
            Consider <button className="underline font-medium" onClick={handleReset}>resetting</button> this check to avoid inconsistent results.
          </div>
        </div>
      )}

      <StockSummaryCards summary={summary} scopeLabel={scopeLabel} />

      <div className="grid grid-cols-[1fr_320px] gap-6 mb-8">
        <ScanInput
          onScan={handleScan}
          busy={scanBusy}
          disabled={!sessionReady || !sessionId}
          lastResult={lastResult}
          inputRef={inputRef}
        />
        <ScanHistoryPanel items={history} />
      </div>

      <StockFilters
        filters={filters}
        onChange={setFilters}
        categories={categories}
        subcategoriesFor={subcategoriesFor}
        counters={counters}
        purities={purities}
        metalTypes={metalTypes}
        hideCategory={mode.type === "category"}
      />

      <PendingStockTable data={stock} loading={stockLoading} page={page} onPageChange={setPage} />

      <ManualVerificationTable data={manual} loading={false} />

      {showCompletion && (
        <CompletionModal
          summary={summary}
          categoryName={mode.type === "category" ? mode.categoryName : null}
          onDone={acknowledgeCompletion}
        />
      )}
      {confirmModal}
    </div>
  );
}
