import { useEffect, useRef, useState } from "react";
import { X, Printer, FileSpreadsheet, Download, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { printHtml, downloadPdf, generatePdfPreviewUrl } from "@/lib/printHtml";
import { buildReportPrintHTML } from "@/lib/reportPrint";
import { exportReportCsv, exportReportExcel, exportReportPdf } from "@/lib/reportExport";
import { sanitizeReportColumns } from "@/lib/reportColumns";

/**
 * Global "View Report" modal — every Quick Report / report export button opens
 * this instead of generating a file directly. Consumes the same
 * {reportName, columns, rows, totals, filtersSummary} contract from any report
 * view, so it never needs per-report custom code.
 */
export default function ReportViewModal({ open, onClose, reportName, columns, rows, totals, filtersSummary, defaultOrientation = "portrait", directPreview = false, summaryParticulars = null, closingTables = [] }) {
  const [outputType, setOutputType] = useState("print");
  const [exportFormat, setExportFormat] = useState("xlsx");
  const [paperSize, setPaperSize] = useState("A4");
  const [orientation, setOrientation] = useState(defaultOrientation);
  const [options, setOptions] = useState({
    showTotals: true,
    showGeneratedDate: true,
    showLogo: true,
    showSignature: true,
  });
  const [company, setCompany] = useState({});
  const [companyReady, setCompanyReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewHtml, setPreviewHtml] = useState(null);
  const [printing, setPrinting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const autoBuiltRef = useRef(false);
  const pdfIframeRef = useRef(null);
  const pdfUrlRef = useRef(null);

  const revokePdfPreview = () => {
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = null;
    setPdfPreviewUrl(null);
  };

  useEffect(() => {
    if (!open) {
      setPreviewHtml(null);
      setPrinting(false);
      autoBuiltRef.current = false;
      setCompanyReady(false);
      revokePdfPreview();
      return;
    }
    setOrientation(defaultOrientation);
    api.get("/settings/company")
      .then(({ data }) => setCompany(data || {}))
      .catch(() => setCompany({}))
      .finally(() => setCompanyReady(true));
  }, [open, defaultOrientation]);

  // Render the actual PDF (real page breaks, Chromium's own viewer/print
  // button) for the preview instead of the raw un-paginated HTML — falls
  // back to the HTML srcDoc iframe below if this isn't available (plain
  // browser) or fails for any reason.
  useEffect(() => {
    if (!previewHtml) return;
    let cancelled = false;
    revokePdfPreview();
    setPdfGenerating(true);
    generatePdfPreviewUrl(previewHtml)
      .then((url) => {
        if (cancelled) { if (url) URL.revokeObjectURL(url); return; }
        pdfUrlRef.current = url;
        setPdfPreviewUrl(url);
      })
      .catch(() => { /* falls back to the HTML preview below */ })
      .finally(() => { if (!cancelled) setPdfGenerating(false); });
    return () => { cancelled = true; };
  }, [previewHtml]);

  useEffect(() => () => revokePdfPreview(), []);

  useEffect(() => {
    if (!open || !directPreview || !companyReady || autoBuiltRef.current) return;
    autoBuiltRef.current = true;
    const exportColumns = sanitizeReportColumns(columns || []).filter((c) => !c.printHide);
    setPreviewHtml(buildReportPrintHTML({
      title: reportName,
      columns: exportColumns,
      rows,
      totals,
      options,
      company,
      filtersSummary,
      orientation: defaultOrientation,
      paperSize: "A4",
      summaryParticulars,
      closingTables,
    }));
  }, [open, directPreview, companyReady, reportName, columns, rows, totals, options, company, filtersSummary, defaultOrientation, summaryParticulars, closingTables]);

  if (!open) return null;

  const toggleOption = (key) => setOptions((o) => ({ ...o, [key]: !o[key] }));

  const exportColumns = sanitizeReportColumns(columns).filter((c) => !c.printHide);

  const generate = async () => {
    setBusy(true);
    try {
      const payload = { title: reportName, columns: exportColumns, rows, totals, options, company, filtersSummary, summaryParticulars, closingTables };
      if (outputType === "print") {
        // Print path is always A4 (ISO). Legal is PDF-export only.
        setPreviewHtml(buildReportPrintHTML({ ...payload, orientation, paperSize: "A4" }));
        return;
      }
      if (exportFormat === "xlsx") {
        await exportReportExcel(payload);
        toast.success("Excel file downloaded");
      } else if (exportFormat === "pdf") {
        await exportReportPdf({ ...payload, orientation, paperSize });
        toast.success("PDF file downloaded");
      } else {
        exportReportCsv(payload);
        toast.success("CSV file downloaded");
      }
      onClose();
    } catch (err) {
      toast.error(err?.message || "Failed to generate report");
    } finally {
      setBusy(false);
    }
  };

  const confirmPrint = async () => {
    if (!previewHtml) return;
    // The PDF is already showing in Chromium's own built-in viewer — its
    // print button is right there, but this button triggers the same thing
    // without making the user hunt for the viewer's own toolbar icon.
    if (pdfPreviewUrl && pdfIframeRef.current?.contentWindow) {
      try {
        pdfIframeRef.current.contentWindow.focus();
        pdfIframeRef.current.contentWindow.print();
      } catch {
        toast.error("Could not open the print dialog — try the printer icon in the preview above");
      }
      return;
    }
    setPrinting(true);
    try {
      // Fallback when the inline PDF preview isn't available (plain browser,
      // or PDF generation failed) — opens a real PDF externally instead of
      // the single-page screenshot path invoices use, since a multi-page
      // report can't be represented as one screenshot squeezed onto one sheet.
      await printHtml(previewHtml, { printerType: "report" });
    } catch {
      /* printHtml already toasted */
    } finally {
      setPrinting(false);
    }
  };

  const downloadPreview = async () => {
    if (!previewHtml || downloading) return;
    setDownloading(true);
    try {
      await downloadPdf(previewHtml, {
        fileName: String(reportName || "report").replace(/\s+/g, "-").toLowerCase(),
      });
    } catch {
      /* downloadPdf already toasted */
    } finally {
      setDownloading(false);
    }
  };

  if (previewHtml) {
    const wide = orientation === "landscape";
    // A4 sheet: 210×297mm. Preview uses mm so the sheet matches print paper.
    const sheetWidth = wide ? "297mm" : "210mm";
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1C2621]/70 backdrop-blur-sm">
        <div
          className="flex flex-col rounded-xl border border-white/20 bg-[#FFFDF9] shadow-[0_24px_70px_rgba(20,31,25,0.28)]"
          style={{ width: wide ? "min(98vw, 1200px)" : "min(94vw, 900px)", maxHeight: "94vh" }}
        >
          <div className="flex flex-shrink-0 items-center justify-between border-b border-[#DDD7CA] bg-[#FFFDF9] px-5 py-3.5">
            <div>
              <p className="text-[14px] font-semibold text-[#0A0A0A]">{reportName} — Print Preview</p>
              <p className="text-[11px] text-[#737373] mt-0.5">
                A4 {orientation} · {rows.length} record{rows.length === 1 ? "" : "s"} · review before printing
              </p>
            </div>
            <button
              onClick={() => { setPreviewHtml(null); onClose(); }}
              className="p-1.5 rounded-lg hover:bg-[#F5F5F5] text-[#737373]"
              disabled={printing || downloading}
            >
              <X size={16} strokeWidth={1.5} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-[#D8D5CE] p-5">
            {pdfGenerating ? (
              <div className="flex items-center justify-center gap-2 text-[13px] text-[#525252] py-24">
                <RefreshCw size={15} strokeWidth={1.5} className="animate-spin" /> Generating PDF preview…
              </div>
            ) : pdfPreviewUrl ? (
              <iframe
                ref={pdfIframeRef}
                key={pdfPreviewUrl}
                src={pdfPreviewUrl}
                title={`${reportName} Preview`}
                style={{ width: "100%", height: "72vh", border: "none", display: "block", background: "#fff" }}
              />
            ) : (
              <div className="bg-white shadow-md mx-auto" style={{ width: sheetWidth, maxWidth: "100%" }}>
                <iframe
                  key={previewHtml}
                  srcDoc={previewHtml}
                  title={`${reportName} Preview`}
                  scrolling="no"
                  style={{ width: "100%", minHeight: wide ? 560 : 720, border: "none", display: "block" }}
                  onLoad={(e) => {
                    try {
                      const doc = e.target.contentDocument || e.target.contentWindow?.document;
                      if (doc?.body) e.target.style.height = `${doc.body.scrollHeight + 20}px`;
                    } catch { /* iframe height best-effort */ }
                  }}
                />
              </div>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-[#DDD7CA] bg-[#FFFDF9] px-5 py-3.5 [&_.btn-primary]:!rounded-[9px] [&_.btn-primary]:!border-[#315C4A] [&_.btn-primary]:!bg-[#315C4A] [&_.btn-primary]:hover:!bg-[#244A3A] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-white">
            {directPreview ? null : (
              <button onClick={() => setPreviewHtml(null)} className="btn-secondary" disabled={printing || downloading}>
                Back
              </button>
            )}
            {directPreview ? (
              <button
                onClick={() => { setPreviewHtml(null); onClose(); }}
                className="btn-secondary"
                disabled={printing || downloading}
              >
                Close
              </button>
            ) : null}
            <button onClick={downloadPreview} className="btn-secondary flex items-center gap-1.5" disabled={printing || downloading || pdfGenerating}>
              {downloading
                ? <><RefreshCw size={13} strokeWidth={1.5} className="animate-spin" /> Generating PDF…</>
                : <><Download size={13} strokeWidth={1.5} /> Download PDF</>}
            </button>
            <button onClick={confirmPrint} className="btn-primary flex items-center gap-1.5" disabled={printing || downloading || pdfGenerating}>
              {printing
                ? <><RefreshCw size={13} strokeWidth={1.5} className="animate-spin" /> Generating PDF…</>
                : <><Printer size={13} strokeWidth={1.5} /> Print</>}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (directPreview) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1C2621]/50 backdrop-blur-[2px]">
        <div className="rounded-xl border border-[#DDD7CA] bg-[#FFFDF9] px-6 py-4 text-sm text-[#59635D] shadow-[0_18px_50px_rgba(20,31,25,0.20)]">
          Generating preview…
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C2621]/50 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_22px_60px_rgba(20,31,25,0.22)]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#DDD7CA] bg-[#FBF8F1] px-5 py-4">
          <div className="text-[15px] font-display font-semibold text-[#0A0A0A]">Print Summary</div>
          <button onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto p-5">
          <div>
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6F7772] mb-1">Report Name</div>
            <div className="text-[14px] font-medium text-[#0A0A0A]">{reportName}</div>
            <div className="text-[11.5px] text-[#a3a3a3] mt-0.5">{rows.length} record{rows.length === 1 ? "" : "s"}</div>
          </div>

          <FieldGroup label="Output Type">
            <RadioRow name="output" value={outputType} onChange={setOutputType} options={[
              { value: "print", label: "Print Preview" },
              { value: "export", label: "Export" },
            ]} />
          </FieldGroup>

          {outputType === "export" && (
            <>
              <FieldGroup label="Export Format">
                <RadioRow name="format" value={exportFormat} onChange={setExportFormat} options={[
                  { value: "xlsx", label: "Excel (.xlsx)" },
                  { value: "pdf", label: "PDF" },
                  { value: "csv", label: "CSV" },
                ]} />
              </FieldGroup>
              {exportFormat === "pdf" && (
                <>
                  <FieldGroup label="Paper Size">
                    <RadioRow name="paper" value={paperSize} onChange={setPaperSize} options={[
                      { value: "A4", label: "A4" },
                      { value: "Legal", label: "Legal" },
                    ]} />
                  </FieldGroup>
                  <FieldGroup label="Orientation">
                    <RadioRow name="orientation" value={orientation} onChange={setOrientation} options={[
                      { value: "portrait", label: "Portrait" },
                      { value: "landscape", label: "Landscape" },
                    ]} />
                  </FieldGroup>
                </>
              )}
            </>
          )}

          {outputType === "print" && (
            <>
              <FieldGroup label="Paper Size">
                <div className="text-[12.5px] text-[#0A0A0A]">A4 (210 × 297 mm)</div>
              </FieldGroup>
              <FieldGroup label="Orientation">
                <RadioRow name="orientation-print" value={orientation} onChange={setOrientation} options={[
                  { value: "portrait", label: "Portrait" },
                  { value: "landscape", label: "Landscape" },
                ]} />
              </FieldGroup>
            </>
          )}

          <FieldGroup label="Additional Options">
            <div className="space-y-2">
              {[
                { key: "showTotals", label: "Show Totals" },
                { key: "showGeneratedDate", label: "Show Generated Date" },
                { key: "showLogo", label: "Show Showroom Logo" },
                { key: "showSignature", label: "Show Signature Section" },
              ].map((o) => (
                <label key={o.key} className="flex items-center gap-2 text-[12.5px] text-[#0A0A0A] cursor-pointer">
                  <input type="checkbox" checked={options[o.key]} onChange={() => toggleOption(o.key)} className="accent-[#315C4A]" />
                  {o.label}
                </label>
              ))}
            </div>
          </FieldGroup>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#DDD7CA] bg-[#FBF8F1] p-4 [&_.btn-primary]:!rounded-[9px] [&_.btn-primary]:!border-[#315C4A] [&_.btn-primary]:!bg-[#315C4A] [&_.btn-primary]:hover:!bg-[#244A3A] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-white">
          <button className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={generate} disabled={busy}>
            {outputType === "print" ? <Printer size={13} strokeWidth={1.5} /> : <FileSpreadsheet size={13} strokeWidth={1.5} />}
            {busy ? "Generating…" : "Generate Report"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldGroup({ label, children }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#6F7772] mb-2">{label}</div>
      {children}
    </div>
  );
}

function RadioRow({ name, value, onChange, options }) {
  return (
    <div className="flex flex-wrap gap-3">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-1.5 text-[12.5px] text-[#0A0A0A] cursor-pointer">
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="accent-[#315C4A]"
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}
