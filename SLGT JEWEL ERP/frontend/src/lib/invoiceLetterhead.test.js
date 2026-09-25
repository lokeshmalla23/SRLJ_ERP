import test from "node:test";
import assert from "node:assert/strict";
import {
  LETTERHEAD_MAX_BYTES,
  applyLetterheadToLayout,
  formatLetterheadBytes,
  letterheadAspectWarning,
  letterheadBackgroundHtml,
  letterheadPageCss,
  normalizeLetterhead,
  resolveInvoicePageSize,
  resolveLetterheadPaperSize,
  validateLetterheadFile,
} from "./invoiceLetterhead.js";

const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("defaults paper size to A5 and stays off without an image", () => {
  const off = normalizeLetterhead({});
  assert.equal(off.enabled, false);
  assert.equal(off.paper_size, "A5");
  assert.equal(off.wIn, 5.83);
  assert.equal(off.hIn, 8.27);

  const enabledNoImage = normalizeLetterhead({ invoice_letterhead_enabled: true });
  assert.equal(enabledNoImage.enabled, false);
});

test("enables letterhead only when toggle and image are both present", () => {
  const lh = normalizeLetterhead({
    invoice_letterhead_enabled: true,
    invoice_letterhead_paper_size: "A4",
    invoice_letterhead_image: PIXEL,
  });
  assert.equal(lh.enabled, true);
  assert.equal(lh.on_print, true);
  assert.equal(lh.on_download, true);
  assert.equal(lh.paper_size, "A4");
  assert.equal(lh.wIn, 8.27);
  assert.equal(lh.hIn, 11.69);
});

test("resolves A4 A5 A6 and rejects unknown sizes", () => {
  assert.equal(resolveLetterheadPaperSize("a6"), "A6");
  assert.equal(resolveLetterheadPaperSize("A4"), "A4");
  assert.equal(resolveLetterheadPaperSize("letter"), "A5");
});

test("applyLetterheadToLayout overrides page size only when enabled", () => {
  const layout = { page_w_in: 5.7, page_h_in: 8.27, header_in: 1.55, paper: "A5" };
  assert.deepEqual(applyLetterheadToLayout(layout, {}), layout);

  const next = applyLetterheadToLayout(layout, {
    invoice_letterhead_enabled: true,
    invoice_letterhead_paper_size: "A6",
    invoice_letterhead_image: PIXEL,
  });
  assert.equal(next.page_w_in, 4.13);
  assert.equal(next.page_h_in, 5.83);
  assert.equal(next.paper, "A6");
  assert.equal(next.header_in, 1.55);
});

test("print helpers layer a real img and skip it when disabled", () => {
  assert.equal(letterheadBackgroundHtml({}), "");
  const html = letterheadBackgroundHtml({
    invoice_letterhead_enabled: true,
    invoice_letterhead_image: PIXEL,
  });
  assert.match(html, /class="letterhead-bg"/);
  assert.match(html, /src="/);
  assert.match(letterheadPageCss(), /object-fit: cover/);
  assert.match(letterheadPageCss(), /z-index: 0/);
});

test("print and download letterhead can be toggled independently", () => {
  const company = {
    invoice_letterhead_image: PIXEL,
    invoice_letterhead_on_print: false,
    invoice_letterhead_on_download: true,
  };
  assert.equal(letterheadBackgroundHtml(company, 8.27, { channel: "print" }), "");
  assert.match(letterheadBackgroundHtml(company, 8.27, { channel: "download" }), /letterhead-bg/);
  assert.equal(normalizeLetterhead(company, { channel: "print" }).enabled, false);
  assert.equal(normalizeLetterhead(company, { channel: "download" }).enabled, true);
});

test("legacy enabled flag turns both print and download on", () => {
  const lh = normalizeLetterhead({
    invoice_letterhead_enabled: true,
    invoice_letterhead_image: PIXEL,
  });
  assert.equal(lh.on_print, true);
  assert.equal(lh.on_download, true);
});

test("A6 page size is used even though invoice layout clamps below 4.5in", () => {
  const size = resolveInvoicePageSize(
    { page_w_in: 5.7, page_h_in: 8.27, paper: "A5" },
    {
      invoice_letterhead_enabled: true,
      invoice_letterhead_paper_size: "A6",
      invoice_letterhead_image: PIXEL,
    },
  );
  assert.equal(size.paper, "A6");
  assert.equal(size.pageW, 4.13);
  assert.equal(size.pageH, 5.83);
});

test("validates file type and 5 MB limit", () => {
  assert.equal(validateLetterheadFile({ type: "image/png", name: "a.png", size: 100 }).ok, true);
  assert.equal(validateLetterheadFile({ type: "image/jpeg", name: "a.jpg", size: 100 }).ok, true);
  assert.equal(validateLetterheadFile({ type: "image/webp", name: "a.webp", size: 100 }).ok, true);
  assert.equal(validateLetterheadFile({ type: "application/pdf", name: "a.pdf", size: 100 }).ok, false);
  assert.equal(validateLetterheadFile({ type: "image/png", name: "big.png", size: LETTERHEAD_MAX_BYTES + 1 }).ok, false);
  assert.match(validateLetterheadFile({ type: "image/png", name: "big.png", size: LETTERHEAD_MAX_BYTES + 1 }).message, /5 MB/);
});

test("warns when image aspect ratio does not match paper", () => {
  assert.equal(letterheadAspectWarning(1480, 2100, "A5"), null);
  assert.match(letterheadAspectWarning(2100, 1480, "A5"), /aspect ratio/);
});

test("formats file sizes", () => {
  assert.equal(formatLetterheadBytes(512), "512 B");
  assert.equal(formatLetterheadBytes(2048), "2.0 KB");
});
