import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { CardGridSkeleton, SectionSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import JsBarcode from "jsbarcode";
import { Tag, Printer, Search, Check, Zap, CheckSquare, Package, Pencil } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import { printHtml } from "@/lib/printHtml";
import { makePinTagBarcodeUrl, generateStripTagPrintPayload } from "@/lib/labelPrint";
import JewelleryTagPreview from "@/components/JewelleryTagPreview";
import { isOutOfStockProduct } from "@/lib/productStatus";

/** Zero qty, sold tags, deleted, or discontinued — shown only on the Out of Stock tab. */
const isOutOfStock = isOutOfStockProduct;

/** Tray unit: gross weight isn't collected per-piece — the tray's own pooled
 * weight (already reduced by every sale) is the real figure, and it isn't
 * per-tag either, so it's counted once regardless of print quantity. */
const isTrayProduct = (p) =>
  p?.unit_code === "tray" || (Number(p?.tray_total_weight) > 0 && !p?.unit_code);

/** Weight covered by the tags about to print for one product — tray's pooled
 * weight as-is, else per-piece weight × how many labels are being printed. */
const tagWeight = (p, printQty) =>
  isTrayProduct(p) ? (Number(p.tray_total_weight) || 0) : (Number(p.gross_weight) || 0) * printQty;

/** Default print quantity for a product — one tag per physical piece, so a
 * full select-all print run's total weight lines up with Inventory's stock
 * weight. A tray is one bulk lot on the showroom floor, not per-piece tagged,
 * so it always defaults to a single label regardless of how many pieces it holds. */
const defaultPrintQty = (p) =>
  isTrayProduct(p) ? 1 : Math.max(1, Number(p.stock_qty) || 1);

const PAGE_SIZE = 30;

const addedAtMs = (p) => {
  const d = new Date(p?.created_at || p?.purchase_date || 0);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
};

// Local (not UTC) date/time strings, matching what <input type="date"/"time">
// values mean — a straight ISO-string slice would drift by the shop's UTC offset.
const toLocalDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toLocalTimeStr = (d) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// ── Barcode preview (table cell) ──────────────────────────────────────────────
function BarcodePreview({ code, small = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !code) return;
    try {
      JsBarcode(ref.current, String(code), {
        format: "CODE128", width: small ? 1.2 : 1.5, height: small ? 28 : 40,
        displayValue: true, fontSize: small ? 8 : 10, margin: 2,
      });
    } catch {}
  }, [code, small]);
  if (!code) return <span className="text-[11px] text-[#89928C]">No barcode</span>;
  return <svg ref={ref} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function BarcodeManager() {
  const navigate = useNavigate();
  const [products, setProducts] = useState([]);
  const [shopName, setShopName] = useState("Sri Srinivasa Jewellers");
  const [loading, setLoading]   = useState(true);

  const [q, setQ]                     = useState("");
  const [stockTab, setStockTab]       = useState("in_stock"); // in_stock | out_of_stock
  const [dateFrom, setDateFrom]       = useState("");
  const [dateTo, setDateTo]           = useState("");
  const [timeFrom, setTimeFrom]       = useState("");
  const [timeTo, setTimeTo]           = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [quantities, setQuantities]   = useState({});
  const [printing, setPrinting]       = useState(false);
  const [generating, setGenerating]   = useState(false);
  const [page, setPage]               = useState(1);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [prods, settings] = await Promise.allSettled([
        api.get("/products?limit=500"),
        api.get("/settings"),
      ]);
      if (prods.status    === "fulfilled") setProducts(prods.value.data?.data || prods.value.data || []);
      if (settings.status === "fulfilled") {
        const arr = Array.isArray(settings.value.data) ? settings.value.data : [];
        const co  = arr.find(e => e.key === "company");
        if (co?.value?.name) setShopName(co.value.name);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const inStockProducts = useMemo(
    () => products.filter((p) => !isOutOfStock(p)),
    [products],
  );
  const outOfStockProducts = useMemo(
    () => products.filter((p) => isOutOfStock(p)),
    [products],
  );
  const tabProducts = stockTab === "out_of_stock" ? outOfStockProducts : inStockProducts;

  const tabStats = useMemo(() => {
    const list = tabProducts;
    const total = list.length;
    const withBarcode = list.filter((p) => p.barcode).length;
    return { total, with_barcode: withBarcode, missing: total - withBarcode };
  }, [tabProducts]);

  // Product's own added-on timestamp (purchase_date has no time component, so
  // fall back to created_at — the only field a time-of-day window can apply to).
  const matchesAddedWindow = (p) => {
    if (!dateFrom && !dateTo && !timeFrom && !timeTo) return true;
    const raw = p.created_at || p.purchase_date;
    if (!raw) return false;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return false;
    const dStr = toLocalDateStr(d);
    if (dateFrom && dStr < dateFrom) return false;
    if (dateTo && dStr > dateTo) return false;
    const tStr = toLocalTimeStr(d);
    if (timeFrom && tStr < timeFrom) return false;
    if (timeTo && tStr > timeTo) return false;
    return true;
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tabProducts
      .filter((p) =>
        (!needle ||
          p.name?.toLowerCase().includes(needle) ||
          p.code?.toLowerCase().includes(needle) ||
          p.barcode?.toLowerCase().includes(needle))
        && matchesAddedWindow(p)
      )
      .sort((a, b) => addedAtMs(b) - addedAtMs(a));
  }, [tabProducts, q, dateFrom, dateTo, timeFrom, timeTo]);

  useEffect(() => {
    setPage(1);
  }, [q, dateFrom, dateTo, timeFrom, timeTo, stockTab]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Explicit override from the Print Qty box if the user typed one, else the
  // per-product default (stock count for regular items, one label for trays).
  const getPrintQty = (p) => quantities[p.id] ?? defaultPrintQty(p);

  const toggleSelect = (id) =>
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const selectAll = () => setSelectedIds(new Set(filtered.map(p => p.id)));
  const clearSel  = () => setSelectedIds(new Set());

  const handlePrint = async () => {
    if (!selectedIds.size) { toast.error("Select at least one product"); return; }
    const selectedProducts = products.filter(p => selectedIds.has(p.id));
    setPrinting(true);
    try {
      const tagItems = selectedProducts.map(p => ({
        product:    p,
        barcodeUrl: makePinTagBarcodeUrl(p.barcode || p.code || String(p.id)),
        qty:        getPrintQty(p),
      }));
      const { html, rawTspl, rawTsplBase64 } = await generateStripTagPrintPayload(tagItems, shopName);
      await printHtml(html, {
        printerType: "label",
        rawTspl,
        rawTsplBase64,
      });
    } catch {
      /* printHtml already showed toast */
    } finally {
      setPrinting(false);
    }
  };

  const generateMissing = async () => {
    setGenerating(true);
    try {
      const res = await api.post("/barcodes/generate-missing");
      toast.success(res.data?.message || "Barcodes generated");
      loadAll();
    } catch (err) {
      toast.error(err?.message || "Failed to generate");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1400px] space-y-6">
        <PageLoadingBadge />
        <div className="h-8 w-48 shimmer rounded-md" />
        <div className="grid grid-cols-3 gap-4">
          <SectionSkeleton height="h-20" />
          <SectionSkeleton height="h-20" />
          <SectionSkeleton height="h-20" />
        </div>
        <CardGridSkeleton count={8} cols={4} />
      </div>
    );
  }

  const previewProduct = selectedIds.size === 1
    ? products.find(p => selectedIds.has(p.id))
    : null;

  const selectedProducts = products.filter(p => selectedIds.has(p.id));
  const totalTags = selectedProducts.reduce((s, p) => s + getPrintQty(p), 0);
  const totalWeight = selectedProducts.reduce((s, p) => s + tagWeight(p, getPrintQty(p)), 0);

  return (
    <div className="max-w-[1400px] [&>div:first-child]:mb-5">
      <PageHeader
        title="Barcode Manager"
        subtitle="Print jewellery barcode tags (G.W / N.W / St.W layout) for inventory."
        actions={
          tabStats.missing > 0 && (
            <button className="btn-secondary" onClick={generateMissing} disabled={generating}>
              <Zap size={14} strokeWidth={1.5} />
              {generating ? "Generating…" : `Auto-generate ${tabStats.missing} missing`}
            </button>
          )
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {[
          ["Total Products",  tabStats.total,        "text-[#17201C]"],
          ["Have Barcode",    tabStats.with_barcode,  "text-green-600"],
          ["Missing Barcode", tabStats.missing,       tabStats.missing > 0 ? "text-amber-600" : "text-[#17201C]"],
        ].map(([lbl, val, cls]) => (
          <div key={lbl} className="card">
            <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#6F7772]">{lbl}</div>
            <div className={`font-display text-[24px] font-semibold mt-2 tabular-nums ${cls}`}>{val}</div>
            {lbl === "Missing Barcode" && val > 0 &&
              <div className="text-[11px] text-amber-600 mt-1">Click "Auto-generate" to fix</div>}
          </div>
        ))}
      </div>

      {/* In Stock / Out of Stock tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-[#E2E7E2]">
        {[
          { key: "in_stock", label: "In Stock", count: inStockProducts.length },
          { key: "out_of_stock", label: "Out of Stock", count: outOfStockProducts.length },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStockTab(key);
              setSelectedIds(new Set());
              setPage(1);
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-medium whitespace-nowrap border-b-2 transition-colors ${
              stockTab === key
                ? "border-[#214F3A] text-[#214F3A] bg-[#FAF7EF]"
                : "border-transparent text-[#6F7772] hover:text-[#214F3A] hover:bg-[#FAF7EF]"
            }`}
          >
            <Package size={13} strokeWidth={1.5} />
            {label}
            <span
              className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                stockTab === key
                  ? key === "out_of_stock"
                    ? "bg-red-50 text-red-700"
                    : "bg-[#EAF2ED] text-[#214F3A]"
                  : "bg-[#F1F4F0] text-[#6F7772]"
              }`}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Product list + preview */}
      <div className="grid grid-cols-[1fr_280px] gap-6">

        {/* Left: product list */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#89928C]" strokeWidth={1.5} />
              <input className="input pl-9" placeholder="Search by name, code or barcode…" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            <button className="btn-secondary text-[12px]" onClick={selectAll}>Select All</button>
            <button className="btn-secondary text-[12px]" onClick={clearSel}>Clear</button>
          </div>

          {/* Added-on date / time window — filters which products are listed to select from */}
          <div className="flex flex-wrap items-end gap-2 mb-3 p-3 rounded-xl border border-[#E2E7E2] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(23,56,42,0.04)]">
            <div>
              <div className="text-[10px] uppercase tracking-[0.06em] text-[#89928C] mb-1">From Date</div>
              <input type="date" className="input !py-1.5 !text-[12.5px]" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.06em] text-[#89928C] mb-1">To Date</div>
              <input type="date" className="input !py-1.5 !text-[12.5px]" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.06em] text-[#89928C] mb-1">Start Time</div>
              <input type="time" className="input !py-1.5 !text-[12.5px]" value={timeFrom} onChange={e => setTimeFrom(e.target.value)} />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.06em] text-[#89928C] mb-1">End Time</div>
              <input type="time" className="input !py-1.5 !text-[12.5px]" value={timeTo} onChange={e => setTimeTo(e.target.value)} />
            </div>
            {(dateFrom || dateTo || timeFrom || timeTo) && (
              <button
                type="button"
                className="btn-secondary text-[12px]"
                onClick={() => { setDateFrom(""); setDateTo(""); setTimeFrom(""); setTimeTo(""); }}
              >
                Clear dates
              </button>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="mb-3 px-3 py-2 bg-[#EAF2ED] border border-[#CBDED2] rounded-lg text-[12.5px] text-[#214F3A] flex items-center gap-2">
              <CheckSquare size={14} />
              {selectedIds.size} product{selectedIds.size > 1 ? "s" : ""} selected — {totalTags} tag{totalTags !== 1 ? "s" : ""} to print
            </div>
          )}

          <div className="table-shell !rounded-[10px] !border-[#E2E7E2] shadow-[0_1px_2px_rgba(23,56,42,0.04)]">
            <table className="w-full">
              <thead>
                <tr className="table-head-row">
                  <th className="table-th w-8" />
                  <th className="table-th">Product</th>
                  <th className="table-th">Barcode Preview</th>
                  <th className="table-th">Purity</th>
                  <th className="table-th text-right">Gross Wt</th>
                  <th className="table-th text-center">Stock</th>
                  <th className="table-th text-center">Print Qty</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.map(p => {
                  const sel  = selectedIds.has(p.id);
                  const code = p.barcode || p.code;
                  return (
                    <tr key={p.id}
                      className={`table-row cursor-pointer transition-colors ${sel ? "bg-[#EAF2ED]" : ""}`}
                      onClick={() => toggleSelect(p.id)}
                    >
                      <td className="table-td">
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${sel ? "bg-[#214F3A] border-[#214F3A]" : "border-[#D3DCD5] bg-[#FFFDF9]"}`}>
                          {sel && <Check size={10} className="text-white" />}
                        </div>
                      </td>
                      <td className="table-td">
                        <div className="text-[13px] font-medium text-[#17201C]">{p.subcategory_name || p.name}</div>
                        <div className="text-[11px] text-[#6F7772]">{p.code} {p.category_name ? `· ${p.category_name}` : ""}</div>
                      </td>
                      <td className="table-td" onClick={e => e.stopPropagation()}>
                        {code
                          ? <BarcodePreview code={code} small />
                          : <span className="chip chip-warning text-[10px]">Missing</span>}
                      </td>
                      <td className="table-td text-[12.5px] text-[#4E5A53]">{p.purity_name || "—"}</td>
                      <td className="table-td text-right font-mono text-[12.5px]">{p.gross_weight ? `${p.gross_weight}g` : "—"}</td>
                      <td className="table-td text-center">
                        <span className={`chip ${p.stock_qty > 0 ? "chip-success" : "chip-danger"}`}>{p.stock_qty || 0}</span>
                      </td>
                      <td className="table-td text-center" onClick={e => e.stopPropagation()}>
                        <input
                          type="text" inputMode="decimal" min={1} max={100}
                          value={getPrintQty(p)}
                          onChange={e => setQuantities(prev => ({ ...prev, [p.id]: Math.max(1, Number(e.target.value)) }))}
                          className="input w-16 text-center text-[12px] py-1"
                        />
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={7} className="table-td text-center text-[#6F7772] py-8">
                      {q
                        ? "No products found"
                        : stockTab === "out_of_stock"
                          ? "No out-of-stock barcodes"
                          : "No in-stock products"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {filtered.length > 0 && (
            <div className="flex items-center justify-between mt-3 px-3 py-2 rounded-[10px] border border-[#E2E7E2] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(23,56,42,0.04)] text-[12px] text-[#6F7772]">
              <button
                type="button"
                className="btn-secondary !py-1.5 !px-3 disabled:opacity-40"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div>
                Page {safePage} of {totalPages} · showing {pagedRows.length} of {filtered.length}
              </div>
              <button
                type="button"
                className="btn-secondary !py-1.5 !px-3 disabled:opacity-40"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </div>
          )}
        </div>

        {/* Right: preview + print */}
        <div className="space-y-4">
          {/* Tag preview */}
          <div className="card">
            <div className="text-[12px] font-semibold text-[#17201C] mb-3">Label Preview</div>
            <div className="flex justify-center min-h-[80px] items-center">
              {previewProduct
                ? <JewelleryTagPreview product={previewProduct} shopName={shopName} className="w-full" />
                : (
                  <div className="flex flex-col items-center text-[#89928C] gap-2">
                    <Tag size={24} strokeWidth={1} />
                    <span className="text-[11px] text-center">Select one product<br/>to preview the label</span>
                  </div>
                )}
            </div>
            <div className="mt-3 pt-3 border-t border-[#E2E7E2] text-[10.5px] text-[#89928C] text-center">
              Preview shows fold + 4 mm padding guides · not printed on the tag
            </div>
          </div>

          {/* Print summary + button */}
          <div className="card space-y-3">
            <div className="text-[12px] font-semibold text-[#17201C]">Print</div>
            <div className="text-[12px] text-[#6F7772] space-y-1">
              <div>Selected: <span className="text-[#17201C] font-medium">{selectedIds.size} product{selectedIds.size !== 1 ? "s" : ""}</span></div>
              <div>Total tags: <span className="text-[#17201C] font-medium">{totalTags}</span></div>
              <div>Total weight: <span className="text-[#17201C] font-medium">{totalWeight.toFixed(3)}g</span></div>
            </div>
            <button
              className="btn-primary w-full justify-center"
              onClick={handlePrint}
              disabled={printing || !selectedIds.size}
            >
              <Printer size={14} strokeWidth={1.5} />
              {printing ? "Sending to printer…" : "Print Labels"}
            </button>
            {previewProduct && (
              <button
                className="btn-secondary w-full justify-center"
                onClick={() => navigate(`/inventory/${previewProduct.id}`)}
              >
                <Pencil size={14} strokeWidth={1.5} />
                Edit Product
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
