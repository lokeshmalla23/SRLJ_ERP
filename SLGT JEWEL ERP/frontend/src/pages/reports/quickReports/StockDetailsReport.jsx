import { useState, useCallback, useEffect, useRef } from "react";
import { ArrowLeft, FileText, Printer, Download, X, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { printHtml, downloadPdf, generatePdfPreviewUrl } from "@/lib/printHtml";
import { fmtDate } from "@/lib/format";
import { useFilterOptions } from "../useFilterOptions";
import { FilterBar, FilterMultiSelect, FilterField } from "../FilterBar";

function stockDetailsDate(it) {
  if (it?.date) return it.date;
  const raw = it?.stock_in_date || it?.purchase_date_str || it?.stock_added_at;
  if (!raw) return "—";
  // Backend may already send DD/MM/YY; otherwise format ISO / DATEONLY.
  if (/^\d{2}\/\d{2}\/\d{2}/.test(String(raw))) return String(raw);
  return fmtDate(raw);
}

// ── Print HTML — A4 portrait stock details ────────────────────────────────────
function generateStockDetailsPrintHTML({ categories, totals, company, fromDate, toDate }) {
  const shopName  = (company?.name  || "").toUpperCase();
  const shopCity  = (company?.city  || company?.address?.split(",")[0] || "").toUpperCase();
  const shopPhone = company?.phone  || "";

  const fmt = (d) => {
    if (!d) return "";
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2,"0")}/${String(dt.getMonth()+1).padStart(2,"0")}/${dt.getFullYear()}`;
  };
  const fromStr = fromDate ? fmt(fromDate) : "—";
  const toStr   = toDate   ? fmt(toDate)   : fmt(new Date());
  const dateRange = `From ${fromStr} to ${toStr}`;

  const categoryBlocks = categories.map((cat) => {
    const itemRows = cat.items.map((it) => `
<tr>
  <td class="c">${it.sno}</td>
  <td class="l">${it.tag_no}</td>
  <td class="l">${it.subcategory_name || "—"}</td>
  <td class="l">${it.purity_name || "—"}</td>
  <td class="c">${it.pcs}</td>
  <td class="r">${Number(it.gross_weight).toFixed(3)}</td>
  <td class="r">${Number(it.net_weight).toFixed(3)}</td>
  <td class="c">${stockDetailsDate(it)}</td>
</tr>`).join("");

    return `
<tr class="cat-header"><td colspan="8">${cat.category_name.toUpperCase()}</td></tr>
<tr class="col-header">
  <th class="c">SNO</th>
  <th class="l">TAG NO</th>
  <th class="l">SUB-CATEGORY</th>
  <th class="l">PURITY</th>
  <th class="c">PCS</th>
  <th class="r">G.WT</th>
  <th class="r">N.W</th>
  <th class="c">DATE</th>
</tr>
${itemRows}
<tr class="subtotal">
  <td colspan="4" class="l bold">${cat.total_pcs} items</td>
  <td class="c bold">${cat.total_pcs}</td>
  <td class="r bold">${Number(cat.total_gross_weight).toFixed(3)}</td>
  <td class="r bold">${Number(cat.total_net_weight).toFixed(3)}</td>
  <td></td>
</tr>
<tr class="spacer"><td colspan="8"></td></tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Stock Details</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  width: 100%;
  background: #fff;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 9pt;
  color: #000;
  line-height: 1.35;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

@page { size: A4 portrait; margin: 12mm; }

.page {
  width: 210mm;
  min-height: 297mm;
  max-width: 100%;
  margin: 0 auto;
  padding: 12mm;
  background: #fff;
}

.frame {
  border: 1.5px solid #000;
  padding: 8mm 10mm 10mm;
  min-height: calc(297mm - 24mm);
}

.header-block {
  text-align: center;
  padding-bottom: 8px;
  margin-bottom: 8px;
  border-bottom: 1.5px solid #000;
}
.shop-name {
  font-size: 13pt;
  font-weight: bold;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.shop-city,
.shop-phone {
  font-size: 9pt;
  margin-top: 3px;
  color: #333;
}

.title-band {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  padding: 7px 4px 9px;
  margin-bottom: 10px;
  border-bottom: 1px solid #ccc;
}
.title-band .title {
  font-size: 11pt;
  font-weight: bold;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}
.title-band .date-range {
  font-size: 8.5pt;
  color: #444;
  white-space: nowrap;
}

.table-wrap { margin-bottom: 8px; }

table.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  border: 1px solid #000;
}

col.sno { width: 6%; }
col.tag { width: 16%; }
col.subcat { width: 15%; }
col.purity { width: 15%; }
col.pcs { width: 8%; }
col.gwt { width: 13%; }
col.nw  { width: 13%; }
col.dt  { width: 14%; }

td, th {
  padding: 5px 6px;
  font-size: 8.5pt;
  vertical-align: middle;
  border: 1px solid #ccc;
  word-wrap: break-word;
}
th {
  font-weight: bold;
  font-size: 8pt;
  background: #f0f0f0;
  border-color: #999;
}
.l { text-align: left; }
.c { text-align: center; }
.r { text-align: right; font-variant-numeric: tabular-nums; }
.bold { font-weight: bold; }

.cat-header td {
  padding: 9px 6px 5px;
  font-weight: bold;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  border: 1px solid #000;
  border-bottom: none;
  background: #f7f7f7;
  text-align: left;
}
.col-header th {
  background: #1a1a1a;
  color: #fff;
  border: 1px solid #000;
  padding: 5px 6px;
}
.subtotal td {
  background: #f5f5f5;
  border-top: 1.5px solid #000;
  border-bottom: 1.5px solid #000;
  font-weight: bold;
  padding: 5px 6px;
}
.spacer td {
  height: 6px;
  border: none;
  background: transparent;
  padding: 0;
}
.grand-total td {
  background: #ececec;
  border-top: 2px solid #000;
  border-bottom: 2px solid #000;
  font-weight: bold;
  font-size: 9pt;
  padding: 7px 6px;
}

.footer {
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid #bbb;
  font-size: 7.5pt;
  color: #666;
  text-align: center;
}

@media print {
  html, body { background: #fff; }
  .page {
    width: auto;
    min-height: auto;
    max-width: none;
    margin: 0;
    padding: 0;
  }
  .frame {
    min-height: auto;
    padding: 7mm 9mm 9mm;
  }
}
</style>
</head>
<body>
<div class="page">
  <div class="frame">

    <div class="header-block">
      ${shopName ? `<div class="shop-name">${shopName}</div>` : ""}
      ${shopCity ? `<div class="shop-city">${shopCity}</div>` : ""}
      ${shopPhone ? `<div class="shop-phone">Tel: ${shopPhone}</div>` : ""}
    </div>

    <div class="title-band">
      <span class="title">Stock Details</span>
      <span class="date-range">${dateRange}</span>
    </div>

    <div class="table-wrap">
      <table class="data-table">
        <colgroup>
          <col class="sno" /><col class="tag" /><col class="subcat" /><col class="purity" /><col class="pcs" />
          <col class="gwt" /><col class="nw" /><col class="dt" />
        </colgroup>
${categoryBlocks}
        <tr class="grand-total">
          <td colspan="4" class="l">GRAND TOTAL</td>
          <td class="c">${totals.total_pcs}</td>
          <td class="r">${Number(totals.total_gross_weight).toFixed(3)}</td>
          <td class="r">${Number(totals.total_net_weight).toFixed(3)}</td>
          <td></td>
        </tr>
      </table>
    </div>

    <div class="footer">${shopName || "Jewellery Showroom"} — Stock Details Report</div>

  </div>
</div>
</body>
</html>`;
}

// ── Print Preview Modal ───────────────────────────────────────────────────────
function ReportPrintPreview({ html, onPrint, onDownload, onClose, printing, downloading }) {
  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const pdfIframeRef = useRef(null);
  const pdfUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
    setPdfUrl(null);
    setPdfGenerating(true);
    generatePdfPreviewUrl(html)
      .then((url) => {
        if (cancelled) { if (url) URL.revokeObjectURL(url); return; }
        pdfUrlRef.current = url;
        setPdfUrl(url);
      })
      .catch(() => { /* falls back to the HTML preview below */ })
      .finally(() => { if (!cancelled) setPdfGenerating(false); });
    return () => {
      cancelled = true;
      if (pdfUrlRef.current) { URL.revokeObjectURL(pdfUrlRef.current); pdfUrlRef.current = null; }
    };
  }, [html]);

  const handlePrint = () => {
    if (pdfUrl && pdfIframeRef.current?.contentWindow) {
      try {
        pdfIframeRef.current.contentWindow.focus();
        pdfIframeRef.current.contentWindow.print();
      } catch {
        toast.error("Could not open the print dialog — try the printer icon in the preview above");
      }
      return;
    }
    onPrint();
  };

  const busy = printing || downloading || pdfGenerating;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col" style={{ width: "min(92vw, 820px)", maxHeight: "94vh" }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB] flex-shrink-0">
          <div>
            <p className="text-[14px] font-semibold text-[#0A0A0A]">Stock Details — Print Preview</p>
            <p className="text-[11px] text-[#737373] mt-0.5">A4 portrait · review before printing</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F5F5F5] text-[#737373]" disabled={printing || downloading}>
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-[#D9D9D9] p-5">
          {pdfGenerating ? (
            <div className="flex items-center justify-center gap-2 text-[13px] text-[#525252] py-24">
              <RefreshCw size={15} strokeWidth={1.5} className="animate-spin" /> Generating PDF preview…
            </div>
          ) : pdfUrl ? (
            <iframe
              ref={pdfIframeRef}
              key={pdfUrl}
              src={pdfUrl}
              title="Stock Details Preview"
              style={{ width: "100%", height: "72vh", border: "none", display: "block", background: "#fff" }}
            />
          ) : (
            <div className="bg-white shadow-md mx-auto" style={{ width: "210mm", maxWidth: "100%" }}>
              <iframe
                key={html}
                srcDoc={html}
                title="Stock Details Preview"
                scrolling="no"
                style={{ width: "100%", minHeight: 720, border: "none", display: "block" }}
                onLoad={e => {
                  try {
                    const doc = e.target.contentDocument || e.target.contentWindow?.document;
                    if (doc?.body) e.target.style.height = (doc.body.scrollHeight + 20) + "px";
                  } catch (_) {}
                }}
              />
            </div>
          )}
        </div>
        <div className="flex-shrink-0 px-5 py-3.5 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-secondary" disabled={printing || downloading}>Close</button>
          <button onClick={onDownload} className="btn-secondary flex items-center gap-1.5" disabled={busy}>
            {downloading
              ? <><RefreshCw size={13} strokeWidth={1.5} className="animate-spin" /> Generating PDF…</>
              : <><Download size={13} strokeWidth={1.5} /> Download PDF</>}
          </button>
          <button onClick={handlePrint} className="btn-primary flex items-center gap-1.5" disabled={busy}>
            {printing
              ? <><RefreshCw size={13} strokeWidth={1.5} className="animate-spin" /> Generating PDF…</>
              : <><Printer size={13} strokeWidth={1.5} /> Print</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function StockDetailsReport({ onBack }) {
  const { categories, counters, purities, metalTypes } = useFilterOptions();
  const [categoryIds, setCategoryIds] = useState([]);
  const [counterIds,  setCounterIds]  = useState([]);
  const [purityIds,   setPurityIds]   = useState([]);
  const [metalIds,    setMetalIds]    = useState([]);
  const [fromDate,   setFromDate]     = useState("");
  const [toDate,     setToDate]       = useState("");
  const [loading,    setLoading]      = useState(false);
  const [data,       setData]         = useState(null);   // { categories, totals }
  const [company,    setCompany]      = useState({});
  const [previewHtml, setPreviewHtml] = useState(null);
  const [printing,    setPrinting]    = useState(false);
  const [downloading, setDownloading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (categoryIds.length) params.category_id   = categoryIds.join(",");
      if (counterIds.length)  params.counter_id    = counterIds.join(",");
      if (purityIds.length)   params.purity_id     = purityIds.join(",");
      if (metalIds.length)    params.metal_type_id = metalIds.join(",");
      if (fromDate)   params.from        = fromDate;
      if (toDate)     params.to          = toDate;

      const [{ data: rpt }, { data: co }] = await Promise.all([
        api.get("/reports/inventory/stock-details", { params }),
        api.get("/settings/company").catch(() => ({ data: {} })),
      ]);
      setData({ categories: rpt.data || [], totals: rpt.totals || {} });
      setCompany(co || {});
    } catch {
      toast.error("Failed to load stock details");
    } finally {
      setLoading(false);
    }
  }, [categoryIds, counterIds, purityIds, metalIds, fromDate, toDate]);

  const buildHtml = () => generateStockDetailsPrintHTML({
    categories: data.categories,
    totals: data.totals,
    company,
    fromDate,
    toDate,
  });

  const openPreview = () => {
    if (!data) return toast.error("Load the report first");
    setPreviewHtml(buildHtml());
  };

  const confirmPrint = async () => {
    setPrinting(true);
    try {
      // "report" routes to the real OS print dialog (correct page count/
      // pagination) instead of the single-page screenshot path — this report
      // can run to many rows across multiple A4 pages.
      await printHtml(previewHtml, { printerType: "report" });
      setPreviewHtml(null);
    } catch {
      /* printHtml already showed success/error toast */
    } finally {
      setPrinting(false);
    }
  };

  const handleDownload = async () => {
    if (!data || downloading) return;
    setDownloading(true);
    try {
      const html = previewHtml || buildHtml();
      await downloadPdf(html, { fileName: `stock-details-${new Date().toISOString().slice(0, 10)}` });
    } catch {
      /* downloadPdf already toasted */
    } finally {
      setDownloading(false);
    }
  };

  // Pieces in stock (not product rows) — matches Inventory's "Total Items in Stock",
  // since a row can represent several identical pieces (stock_qty > 1).
  const totalItems = data?.totals?.total_pcs ?? 0;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="text-[#737373] hover:text-[#0A0A0A]">
              <ArrowLeft size={16} strokeWidth={1.5} />
            </button>
          )}
          <div>
            <div className="text-[15px] font-display font-semibold text-[#0A0A0A]">Stock Details</div>
            <div className="text-[12px] text-[#737373] mt-0.5">Per-item listing grouped by category</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary flex items-center gap-1.5" onClick={fetchData} disabled={loading}>
            <FileText size={13} strokeWidth={1.5} /> {loading ? "Loading…" : "Generate"}
          </button>
          {data && (
            <>
              <button className="btn-secondary flex items-center gap-1.5" onClick={handleDownload}>
                <Download size={13} strokeWidth={1.5} /> Download
              </button>
              <button className="btn-primary flex items-center gap-1.5" onClick={openPreview}>
                <Printer size={13} strokeWidth={1.5} /> Print
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <FilterBar>
        <FilterField label="From Date">
          <input type="date" className="input text-[12px] py-1.5" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </FilterField>
        <FilterField label="To Date">
          <input type="date" className="input text-[12px] py-1.5" value={toDate} onChange={e => setToDate(e.target.value)} />
        </FilterField>
        <FilterMultiSelect label="Category" value={categoryIds} onChange={setCategoryIds} options={categories} />
        <FilterMultiSelect label="Metal"    value={metalIds}    onChange={setMetalIds}    options={metalTypes} />
        <FilterMultiSelect label="Counter"  value={counterIds}  onChange={setCounterIds}  options={counters} />
        <FilterMultiSelect label="Purity"   value={purityIds}   onChange={setPurityIds}   options={purities} />
      </FilterBar>

      {/* On-screen preview table */}
      {loading && (
        <div className="text-center py-12 text-[13px] text-[#737373]">Loading…</div>
      )}

      {!loading && data && data.categories.length === 0 && (
        <div className="text-center py-12 text-[13px] text-[#737373]">No stock matches these filters.</div>
      )}

      {!loading && data && data.categories.length > 0 && (
        <div className="mt-4 space-y-6">
          {/* Summary bar */}
          <div className="flex items-center gap-6 px-4 py-2.5 bg-[#FDFBF7] border border-[#EADFBF] rounded-lg text-[12.5px]">
            <span className="text-[#737373]">Categories: <strong className="text-[#0A0A0A]">{data.categories.length}</strong></span>
            <span className="text-[#737373]">Total Items: <strong className="text-[#0A0A0A]">{totalItems}</strong></span>
            <span className="text-[#737373]">Total G.Wt: <strong className="text-[#0A0A0A]">{Number(data.totals.total_gross_weight).toFixed(3)} g</strong></span>
            <span className="text-[#737373]">Total N.Wt: <strong className="text-[#0A0A0A]">{Number(data.totals.total_net_weight).toFixed(3)} g</strong></span>
          </div>

          {data.categories.map((cat) => (
            <div key={cat.category_name} className="table-shell">
              {/* Category subheader */}
              <div className="px-4 py-2 bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <span className="text-[12px] font-bold text-[#0A0A0A] uppercase tracking-wide">{cat.category_name}</span>
                <span className="ml-3 text-[11px] text-[#737373]">{cat.items.length} items · {Number(cat.total_gross_weight).toFixed(3)} g gross</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="table-head-row">
                      <th className="table-th w-12 text-center">SNO</th>
                      <th className="table-th">TAG NO</th>
                      <th className="table-th">SUB-CATEGORY</th>
                      <th className="table-th">PURITY</th>
                      <th className="table-th text-center">PCS</th>
                      <th className="table-th text-right">G.WT</th>
                      <th className="table-th text-right">N.W</th>
                      <th className="table-th text-center">DATE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cat.items.map((it) => (
                      <tr key={it.sno} className="table-row">
                        <td className="table-td text-center text-[12px] text-[#737373]">{it.sno}</td>
                        <td className="table-td font-mono text-[12px]">{it.tag_no}</td>
                        <td className="table-td text-[12px]">{it.subcategory_name || "—"}</td>
                        <td className="table-td text-[12px]">{it.purity_name || "—"}</td>
                        <td className="table-td text-center text-[12px]">{it.pcs}</td>
                        <td className="table-td text-right font-mono text-[12px]">{Number(it.gross_weight).toFixed(3)}</td>
                        <td className="table-td text-right font-mono text-[12px]">{Number(it.net_weight).toFixed(3)}</td>
                        <td className="table-td text-center text-[12px]">{stockDetailsDate(it)}</td>
                      </tr>
                    ))}
                    <tr className="bg-[#FAFAFA] font-semibold">
                      <td className="table-td text-[12px]" colSpan={4}>{cat.total_pcs} items</td>
                      <td className="table-td text-center text-[12px]">{cat.total_pcs}</td>
                      <td className="table-td text-right font-mono text-[12px]">{Number(cat.total_gross_weight).toFixed(3)}</td>
                      <td className="table-td text-right font-mono text-[12px]">{Number(cat.total_net_weight).toFixed(3)}</td>
                      <td className="table-td" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          {/* Grand total */}
          <div className="flex items-center gap-8 px-4 py-3 bg-[#0A0A0A] text-white rounded-lg text-[13px] font-semibold">
            <span>GRAND TOTAL</span>
            <span>PCS: {data.totals.total_pcs}</span>
            <span>G.Wt: {Number(data.totals.total_gross_weight).toFixed(3)} g</span>
            <span>N.Wt: {Number(data.totals.total_net_weight).toFixed(3)} g</span>
          </div>
        </div>
      )}

      {previewHtml && (
        <ReportPrintPreview
          html={previewHtml}
          onPrint={confirmPrint}
          onDownload={handleDownload}
          onClose={() => setPreviewHtml(null)}
          printing={printing}
          downloading={downloading}
        />
      )}
    </div>
  );
}
