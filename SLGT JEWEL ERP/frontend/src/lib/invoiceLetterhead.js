/** Company-level invoice letterhead background. One active image + paper size. */

export const LETTERHEAD_MAX_BYTES = 5 * 1024 * 1024;

export const LETTERHEAD_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

export const LETTERHEAD_PAPER = {
  A4: { id: "A4", wIn: 8.27, hIn: 11.69, wMm: 210, hMm: 297, label: "A4 — 210 × 297 mm" },
  A5: { id: "A5", wIn: 5.83, hIn: 8.27, wMm: 148, hMm: 210, label: "A5 — 148 × 210 mm" },
  A6: { id: "A6", wIn: 4.13, hIn: 5.83, wMm: 105, hMm: 148, label: "A6 — 105 × 148 mm" },
};

const PAPER_IDS = Object.keys(LETTERHEAD_PAPER);

export function resolveLetterheadPaperSize(raw) {
  const id = String(raw || "").trim().toUpperCase();
  return PAPER_IDS.includes(id) ? id : "A5";
}

/** Legacy shops only had invoice_letterhead_enabled. New shops set print/download separately. */
export function coalesceLetterheadDest(explicit, legacyEnabled) {
  if (explicit === true || explicit === false) return explicit;
  if (explicit === "true" || explicit === 1 || explicit === "1") return true;
  if (explicit === "false" || explicit === 0 || explicit === "0") return false;
  return Boolean(legacyEnabled);
}

export function resolveLetterheadChannel(mode) {
  return mode === "download" ? "download" : "print";
}

export function normalizeLetterhead(company = {}, { channel } = {}) {
  const paperSize = resolveLetterheadPaperSize(company.invoice_letterhead_paper_size);
  const paper = LETTERHEAD_PAPER[paperSize];
  const image = typeof company.invoice_letterhead_image === "string"
    ? company.invoice_letterhead_image.trim()
    : "";
  const on_print = coalesceLetterheadDest(company.invoice_letterhead_on_print, company.invoice_letterhead_enabled);
  const on_download = coalesceLetterheadDest(company.invoice_letterhead_on_download, company.invoice_letterhead_enabled);
  let enabled = Boolean(image);
  if (channel === "print") enabled = enabled && on_print;
  else if (channel === "download") enabled = enabled && on_download;
  else enabled = enabled && (on_print || on_download);
  return {
    enabled,
    on_print,
    on_download,
    paper_size: paperSize,
    image,
    file_name: String(company.invoice_letterhead_file_name || "").trim(),
    file_size: Number(company.invoice_letterhead_file_size) || 0,
    width_px: Number(company.invoice_letterhead_width_px) || 0,
    height_px: Number(company.invoice_letterhead_height_px) || 0,
    wIn: paper.wIn,
    hIn: paper.hIn,
    wMm: paper.wMm,
    hMm: paper.hMm,
    label: paper.label,
  };
}

/** When letterhead is on, ISO paper size owns page dimensions. Margins stay on the invoice layout. */
export function applyLetterheadToLayout(layout, company, options = {}) {
  const lh = normalizeLetterhead(company, options);
  if (!lh.enabled || !layout) return layout;
  return {
    ...layout,
    paper: lh.paper_size,
    page_w_in: lh.wIn,
    page_h_in: lh.hIn,
  };
}

export function resolveInvoicePageSize(layout, company, options = {}) {
  const lh = normalizeLetterhead(company, options);
  if (lh.enabled) {
    return { paper: lh.paper_size, pageW: lh.wIn, pageH: lh.hIn, letterhead: lh };
  }
  return {
    paper: layout?.paper || "A5",
    pageW: Number(layout?.page_w_in) > 0 ? Number(layout.page_w_in) : 5.7,
    pageH: Number(layout?.page_h_in) > 0 ? Number(layout.page_h_in) : 8.27,
    letterhead: lh,
  };
}

export function letterheadAspectWarning(widthPx, heightPx, paperSize) {
  const paper = LETTERHEAD_PAPER[resolveLetterheadPaperSize(paperSize)];
  const w = Number(widthPx);
  const h = Number(heightPx);
  if (!paper || !(w > 0) || !(h > 0)) return null;
  const imgRatio = w / h;
  const paperRatio = paper.wIn / paper.hIn;
  const diff = Math.abs(imgRatio - paperRatio) / paperRatio;
  if (diff <= 0.04) return null;
  return `This image’s aspect ratio does not match ${paper.id} (${paper.wMm} × ${paper.hMm} mm). The page will be filled without stretching, which may crop the edges.`;
}

export function validateLetterheadFile(file) {
  if (!file) return { ok: false, message: "Choose a letterhead image" };
  const mime = String(file.type || "").toLowerCase();
  const name = String(file.name || "");
  const mimeOk = LETTERHEAD_MIME_TYPES.includes(mime);
  const extOk = /\.(png|jpe?g|webp)$/i.test(name);
  if (!mimeOk && !extOk) {
    return { ok: false, message: "Use a PNG, JPG, or WebP image" };
  }
  if (Number(file.size) > LETTERHEAD_MAX_BYTES) {
    return { ok: false, message: "Letterhead image must be 5 MB or smaller" };
  }
  return { ok: true };
}

export function formatLetterheadBytes(n) {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escSrc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Real <img> layer — CSS background-image is not reliable for Windows GDI
 * capture/print. Height is set inline (not via CSS %) because the page it
 * sits in no longer has a fixed height (long bills flow onto extra physical
 * pages) — a percentage height would have no definite reference to resolve
 * against. `pageHIn` is one physical page's height in inches; an inline
 * script (see generateA5LetterheadHtml) clones this element once per extra
 * page a long bill spills onto, each positioned at its own `top` offset.
 */
export function letterheadBackgroundHtml(company, pageHIn, options = {}) {
  const lh = normalizeLetterhead(company, options);
  if (!lh.enabled) return "";
  const h = Number(pageHIn) > 0 ? Number(pageHIn) : lh.hIn;
  return `<img class="letterhead-bg" style="top:0;height:${h}in" src="${escSrc(lh.image)}" alt="" />`;
}

export function letterheadPageCss() {
  return `
.letterhead-bg {
  position: absolute;
  left: 0;
  width: 100%;
  object-fit: cover;
  object-position: center;
  z-index: 0;
  pointer-events: none;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.page-body { position: relative; z-index: 1; }
`.trim();
}
