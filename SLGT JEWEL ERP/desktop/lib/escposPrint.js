/**
 * ESC/POS raw raster printing for thermal receipt printers (e.g. EPSON
 * TM-T82X-II) — sent directly to the printer via sendRawToWindowsPrinter's
 * RAW datatype, bypassing GDI and Chromium's print API entirely. Built after
 * both of those failed for this printer class: Chromium's native "silent
 * print" reported success while no job ever reached the Windows spooler, and
 * the GDI/JPEG image path (still used for Invoice/A5 estimation) works but
 * is visibly blurry on a thermal head. This mirrors the pattern already
 * proven for TSC barcode labels (frontend/src/lib/labelPrint.js) — raw bytes
 * over RAW, not a rendered document.
 */

const ESC = 0x1b;
const GS = 0x1d;

/**
 * Printer engine resolution, in dots per inch. Most modern 80mm/58mm thermal
 * heads (including the TM-T82 series) are 203 DPI — start here and verify
 * against a real test print: if the printed width doesn't match the paper's
 * actual printable width, this is the one number to adjust.
 */
const PRINTER_DPI = 203;

/** Printable width in mm for common roll widths (paper width minus the
 * printer's fixed side margins — not the full roll width). */
const PRINTABLE_WIDTH_MM = { 58: 48, 80: 72 };

/** Dot width (rounded down to a multiple of 8, since raster rows are byte-packed). */
function widthDotsForRoll(rollWidthMm) {
  const printableMm = PRINTABLE_WIDTH_MM[rollWidthMm] || PRINTABLE_WIDTH_MM[80];
  const dots = Math.floor((printableMm / 25.4) * PRINTER_DPI);
  return dots - (dots % 8);
}

/**
 * Resize a captured Electron NativeImage to the printer's exact dot width,
 * threshold it to 1-bit monochrome, and pack it MSB-first with each row
 * padded to a whole byte — the same packing GS v 0 (ESC/POS raster) expects,
 * and the same convention already used for TSPL labels (canvasToTsplBitmapBytes
 * in labelPrint.js), except bit polarity here is the normal ESC/POS sense:
 * bit 1 = print (ink), bit 0 = leave white.
 */
function nativeImageToMonoRaster(image, widthDots) {
  const resized = image.resize({ width: widthDots });
  const size = resized.getSize();
  const w = size.width;
  const h = size.height;
  if (!(w > 0) || !(h > 0)) {
    throw new Error('Estimation capture produced an empty image — cannot print');
  }
  // Electron NativeImage raw pixels are BGRA on Windows.
  const pixels = resized.toBitmap();
  const widthBytes = Math.ceil(w / 8);
  const mono = Buffer.alloc(widthBytes * h, 0);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const b = pixels[i];
      const g = pixels[i + 1];
      const r = pixels[i + 2];
      const a = pixels[i + 3];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      // Opaque and dark → ink (bit set). Transparent or light → leave white.
      if (a >= 128 && lum < 200) {
        mono[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { mono, widthBytes, heightDots: h, widthDots: w };
}

/**
 * Assemble a full ESC/POS job: initialize, one or more GS v 0 raster chunks
 * (kept ≤ MAX_CHUNK_ROWS tall each — conservative across firmware receive
 * buffers, rather than one huge command for a long receipt), feed past the
 * content, then cut.
 */
function buildEscPosReceipt({ mono, widthBytes, heightDots }) {
  const MAX_CHUNK_ROWS = 200;
  const parts = [Buffer.from([ESC, 0x40])]; // ESC @ — initialize/reset

  for (let rowStart = 0; rowStart < heightDots; rowStart += MAX_CHUNK_ROWS) {
    const rows = Math.min(MAX_CHUNK_ROWS, heightDots - rowStart);
    const header = Buffer.from([
      GS, 0x76, 0x30, 0x00, // GS v 0 m(=0, normal)
      widthBytes & 0xff, (widthBytes >> 8) & 0xff, // xL, xH
      rows & 0xff, (rows >> 8) & 0xff, // yL, yH
    ]);
    const chunkStart = rowStart * widthBytes;
    const chunkEnd = chunkStart + rows * widthBytes;
    parts.push(header, mono.subarray(chunkStart, chunkEnd));
  }

  parts.push(Buffer.from([ESC, 0x64, 0x04])); // ESC d 4 — feed 4 lines past the content
  parts.push(Buffer.from([GS, 0x56, 0x00])); // GS V 0 — full cut
  return Buffer.concat(parts);
}

module.exports = {
  PRINTER_DPI,
  widthDotsForRoll,
  nativeImageToMonoRaster,
  buildEscPosReceipt,
};
