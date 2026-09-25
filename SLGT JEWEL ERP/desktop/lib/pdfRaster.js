/**
 * Rasterize a Chromium printToPDF buffer to PNG pages inside the hidden
 * print window (pdf.js, no 3× HTML zoom). Used only for POS invoice silent
 * print — GDI/host-relay still deliver the images to Canon CAPT.
 */
const path = require('path');

const RASTER_HTML = path.join(__dirname, 'pdfjs', 'raster.html');
const PDF_SCALE = 2.5;

function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error('PDF page raster was empty');
  const buffer = Buffer.from(m[1], 'base64');
  if (buffer.length < 500) throw new Error('PDF page raster was empty');
  return buffer;
}

function loadRasterHtml(webContents, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('PDF raster page load timed out'));
    }, timeoutMs);
    const onOk = () => { cleanup(); resolve(); };
    const onFail = (_e, code, desc) => {
      cleanup();
      reject(new Error(`PDF raster load failed (${code}): ${desc}`));
    };
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      webContents.removeListener('did-finish-load', onOk);
      webContents.removeListener('did-fail-load', onFail);
    };
    webContents.once('did-finish-load', onOk);
    webContents.once('did-fail-load', onFail);
    webContents.loadFile(RASTER_HTML).catch((err) => { cleanup(); reject(err); });
  });
}

async function rasterizePdfPages(webContents, pdfBuffer) {
  if (!pdfBuffer || pdfBuffer.length < 100) {
    throw new Error('Invoice PDF was empty');
  }
  await loadRasterHtml(webContents);
  const ready = await webContents.executeJavaScript('typeof window.loadInvoicePdf === "function" && typeof pdfjsLib !== "undefined"').catch(() => false);
  if (!ready) throw new Error('PDF rasterizer failed to initialize');
  const base64 = pdfBuffer.toString('base64');
  const pageCount = await webContents.executeJavaScript(
    `window.loadInvoicePdf(${JSON.stringify(base64)})`,
  );
  const n = Math.max(1, Math.min(10, Number(pageCount) || 0));
  if (!n) throw new Error('Invoice PDF had no pages');
  const buffers = [];
  for (let i = 1; i <= n; i += 1) {
    const dataUrl = await webContents.executeJavaScript(
      `window.renderInvoicePdfPage(${i}, ${PDF_SCALE})`,
    );
    buffers.push({ buffer: dataUrlToBuffer(dataUrl), mimeType: 'image/png' });
  }
  return { buffers, pageCount: n };
}

module.exports = { rasterizePdfPages };
