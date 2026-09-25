import { toast } from "sonner";

// Host relay + local GDI usually finish in a few seconds; allow headroom for slow LAN.
const PRINT_IPC_TIMEOUT_MS = 45_000;
// Reports render to a real PDF (can take a few seconds for a long report)
// then hand off to the default PDF viewer — printing itself happens there.
const REPORT_PRINT_IPC_TIMEOUT_MS = 30_000;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.code = "PRINT_TIMEOUT";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function readAuthToken() {
  try {
    return (
      localStorage.getItem("ssj_token")
      || localStorage.getItem("token")
      || localStorage.getItem("access_token")
      || sessionStorage.getItem("token")
      || null
    );
  } catch {
    return null;
  }
}

function successMessage(result) {
  const name = result?.deviceName ? ` on ${result.deviceName}` : "";
  if (result?.mode === "label-raw" || result?.mode === "label-silent") {
    return `Label printed successfully${name}`;
  }
  if (result?.mode === "host-relay") {
    return `Printed successfully on main PC${name}`;
  }
  if (
    result?.mode === "windows-pdf"
    || result?.mode === "windows-image"
    || result?.mode === "host-gdi"
    || result?.mode === "silent"
    || result?.mode === "silent-default"
    || result?.mode === "invoice-pdf"
    || result?.mode === "label-raw"
    || result?.mode === "label-silent"
  ) {
    if (result?.mode === "label-raw") {
      return `Printed label (same as Live Preview)${name}`;
    }
    return `Printed successfully${name}`;
  }
  if (result?.mode === "dialog") {
    return "Printed successfully";
  }
  if (result?.mode === "pdf-view") {
    return "Report opened as a PDF — use its Print button to print";
  }
  return `Printed successfully${name}`;
}

/**
 * printerType: 'invoice' (default) | 'label' | 'estimation'
 * opts.rawTspl: optional TSPL string (ASCII fallback)
 * opts.rawTsplBase64: preferred binary TSPL (bitmap) for TSC printers — matches Live Preview 1:1
 *
 * Success toast only when desktop/host confirms the job; failures throw with a clear message.
 * Never treat legacy "queued" as success (old builds lied for Canon CAPT / network shares).
 */
export async function printHtml(html, { printerType = "invoice", rawTspl = null, rawTsplBase64 = null, invoicePdfLayout = false } = {}) {
  if (window.jewelleryCRM?.printHtml) {
    const isReport = printerType === "report";
    const ipcTimeoutMs = isReport
      ? REPORT_PRINT_IPC_TIMEOUT_MS
      : invoicePdfLayout
        ? 35_000
        : PRINT_IPC_TIMEOUT_MS;
    const toastId = toast.loading(
      printerType === "label"
        ? "Sending label to printer…"
        : printerType === "estimation"
          ? "Sending estimation to printer…"
          : isReport
            ? "Generating report PDF…"
            : "Sending to printer…",
      { duration: ipcTimeoutMs + 5_000 },
    );
    let result;
    try {
      result = await withTimeout(
        window.jewelleryCRM.printHtml(html, {
          printerType,
          rawTspl,
          rawTsplBase64,
          invoicePdfLayout: Boolean(invoicePdfLayout),
          authToken: readAuthToken(),
        }),
        ipcTimeoutMs,
        isReport
          ? "Report PDF generation timed out — try again."
          : "Print timed out — printer may be offline or not responding. Try again or check Settings → Printers.",
      );
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Print failed");
      throw err;
    } finally {
      toast.dismiss(toastId);
    }

    // Legacy Electron builds returned success+queued without a real job.
    if (result?.queued && result?.mode !== "host-relay" && result?.mode !== "windows-image" && result?.mode !== "host-gdi") {
      const msg = "Print did not reach the printer (legacy queued response). Restart ERP on this PC to update printing.";
      toast.error(msg);
      throw new Error(msg);
    }

    if (!result?.success) {
      const reason = result?.failureReason || "";
      const detail = result?.detail || "";
      const combined = `${reason} ${detail}`.trim();

      if (reason === "cancelled" || /cancel/i.test(combined)) {
        toast.error("Print cancelled");
        return { ok: false, cancelled: true };
      }

      let message = detail || reason || "Print failed";
      if (
        reason === "no_printer"
        || /no printer|not connected|offline|not assigned|not installed|not available/i.test(combined)
      ) {
        message = detail || "Printer not connected — plug it in and check Settings → Printers & Devices";
      } else if (reason === "printer_error" || /paper|error|attention|intervention|blocked/i.test(combined)) {
        message = detail || reason || "Printer error — check paper, toner, and printer status";
      } else if (/invalid printer settings/i.test(reason)) {
        message = "Printer rejected the job — check Windows printer settings and try again";
      } else if (/timed out/i.test(combined)) {
        message = detail || "Print timed out — check printer and try again";
      } else if (/host|main pc|lan/i.test(combined)) {
        message = detail || reason || "Could not print via main PC — check LAN connection";
      } else {
        message = detail || reason || "Print failed — open Settings → Printers & Devices and send a test print";
      }

      toast.error(message);
      const err = new Error(message);
      if (reason === "no_printer") err.printerNotConnected = true;
      if (reason === "printer_error") err.printerError = true;
      throw err;
    }

    toast.success(successMessage(result));
    return { ok: true, deviceName: result.deviceName || null, mode: result.mode || null };
  }

  // Browser fallback (web mode)
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) throw new Error("Popup blocked — allow popups for this site");
  win.document.write(html);
  win.document.close();
  win.onload = () => setTimeout(() => {
    win.print();
    win.onafterprint = () => win.close();
    setTimeout(() => { if (!win.closed) win.close(); }, 30_000);
  }, 300);
  toast.success("Print dialog opened");
  return { ok: true };
}

const PDF_IPC_TIMEOUT_MS = 30_000;

function readPageSizeIn(html) {
  const w = Number(html.match(/data-page-w-in="([\d.]+)"/)?.[1]);
  const h = Number(html.match(/data-page-h-in="([\d.]+)"/)?.[1]);
  return {
    w: Number.isFinite(w) && w > 0 ? w : 5.7,
    h: Number.isFinite(h) && h > 0 ? h : 8.27,
  };
}

/** Render HTML to a real PDF file. Desktop: native printToPDF + Save As dialog.
 *  Browser: rasterize via html2canvas and pack into a jsPDF, then trigger a download. */
export async function downloadPdf(html, { fileName = "invoice", saveDir, skipDialog = false } = {}) {
  if (window.jewelleryCRM?.savePdfFromHtml) {
    const toastId = toast.loading("Generating PDF…", { duration: PDF_IPC_TIMEOUT_MS + 5_000 });
    let result;
    try {
      result = await withTimeout(
        window.jewelleryCRM.savePdfFromHtml(html, { fileName, saveDir, skipDialog }),
        PDF_IPC_TIMEOUT_MS,
        "PDF generation timed out — please try again.",
      );
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(err?.message || "Could not generate PDF");
      throw err;
    } finally {
      toast.dismiss(toastId);
    }

    if (result?.canceled) {
      return { ok: false, cancelled: true };
    }
    if (!result?.success) {
      const message = result?.failureReason || "Could not generate PDF";
      toast.error(message);
      throw new Error(message);
    }
    toast.success(result.path ? `PDF saved to ${result.path}` : "PDF saved");
    return { ok: true, path: result.path };
  }

  // Browser fallback — rasterize the invoice HTML and pack it into a PDF
  // sized to match the printed page (read off the generator's own @page size).
  const toastId = toast.loading("Generating PDF…");
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    const { w: pageWIn, h: pageHIn } = readPageSizeIn(html);

    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;left:-10000px;top:0;border:0;";
    iframe.style.width = `${pageWIn}in`;
    iframe.style.height = `${pageHIn}in`;
    document.body.appendChild(iframe);
    try {
      await new Promise((resolve, reject) => {
        iframe.onload = resolve;
        iframe.onerror = () => reject(new Error("Could not render invoice for PDF export"));
        iframe.srcdoc = html;
      });
      const doc = iframe.contentDocument;
      // A long bill may have been split into several genuinely separate
      // .page elements (see invoicePrint.js) — export every one of them as
      // its own PDF page instead of only ever exporting the first.
      const pages = Array.from(doc.querySelectorAll(".page"));
      const targets = pages.length ? pages : [doc.body];
      const pdf = new jsPDF({ orientation: pageWIn > pageHIn ? "landscape" : "portrait", unit: "in", format: [pageWIn, pageHIn] });
      for (let i = 0; i < targets.length; i += 1) {
        const canvas = await html2canvas(targets[i], { scale: 2, backgroundColor: "#ffffff", useCORS: true });
        if (i > 0) pdf.addPage([pageWIn, pageHIn], pageWIn > pageHIn ? "landscape" : "portrait");
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWIn, pageHIn);
      }
      pdf.save(`${fileName}.pdf`);
      toast.dismiss(toastId);
      toast.success("PDF downloaded");
      return { ok: true };
    } finally {
      iframe.remove();
    }
  } catch (err) {
    toast.dismiss(toastId);
    toast.error(err?.message || "Could not generate PDF");
    throw err;
  }
}

function base64ToBlobUrl(base64, mimeType = "application/pdf") {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * Renders HTML to a real PDF and returns a blob: URL for inline viewing
 * (e.g. an <iframe src={url}>) — Chromium's own built-in PDF viewer renders
 * it with real page breaks/pagination and its own print/zoom controls,
 * instead of a raw un-paginated HTML render or an external app.
 * Desktop only — call site should fall back to the existing HTML srcDoc
 * preview when window.jewelleryCRM isn't available (plain browser).
 */
export async function generatePdfPreviewUrl(html) {
  if (!window.jewelleryCRM?.generatePdfFromHtml) return null;
  const result = await withTimeout(
    window.jewelleryCRM.generatePdfFromHtml(html),
    PDF_IPC_TIMEOUT_MS,
    "PDF preview timed out — please try again.",
  );
  if (!result?.success || !result.base64) {
    throw new Error(result?.failureReason || "Could not generate PDF preview");
  }
  return base64ToBlobUrl(result.base64);
}
