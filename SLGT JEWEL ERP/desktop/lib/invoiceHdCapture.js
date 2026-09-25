/**
 * POS invoice page capture — 1× JPEG of each .page box (no zoom).
 * A 2× window without matching zoom captured a small bill on a large
 * canvas, which then printed tiny on A5 paper.
 */
const { BrowserWindow } = require('electron');

const JPEG_QUALITY = 92;
const IMAGE_WAIT_MS = 600;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForImages(webContents) {
  await webContents.executeJavaScript(`(async () => {
    const imgs = Array.from(document.images || []);
    await Promise.race([
      Promise.all(imgs.map((img) => {
        if (img.complete) return null;
        return new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        });
      })),
      new Promise((resolve) => setTimeout(resolve, ${IMAGE_WAIT_MS})),
    ]);
  })()`).catch(() => {});
}

async function readPageBoxes(webContents) {
  return webContents.executeJavaScript(`(() => {
    const html = document.documentElement;
    const wIn = parseFloat(html.getAttribute('data-page-w-in') || '0') || 0;
    const hIn = parseFloat(html.getAttribute('data-page-h-in') || '0') || 0;
    const pages = Array.from(document.querySelectorAll('.page'));
    const rects = pages.map((p) => {
      const r = p.getBoundingClientRect();
      return {
        x: Math.round(r.x),
        y: Math.round(r.y),
        width: Math.round(r.width),
        height: Math.round(r.height),
      };
    });
    return { wIn, hIn, rects, pageCount: rects.length || 1 };
  })()`);
}

function encodeJpeg(image) {
  const jpeg = image?.toJPEG?.(JPEG_QUALITY);
  if (jpeg && jpeg.length >= 500) return { buffer: jpeg, mimeType: 'image/jpeg' };
  const png = image?.toPNG?.();
  if (png && png.length >= 500) return { buffer: png, mimeType: 'image/png' };
  throw new Error('Invoice page capture was empty');
}

async function captureInvoicePagesHd(webContents, pageMetrics = {}) {
  await waitForImages(webContents);
  try { webContents.setZoomFactor(1); } catch { /* */ }

  const metrics0 = await readPageBoxes(webContents).catch(() => ({ wIn: 0, hIn: 0, rects: [], pageCount: 1 }));
  const pageWidthIn = Number(metrics0.wIn) > 0 ? Number(metrics0.wIn) : (pageMetrics.pageWidthIn || 5.7);
  const pageHeightIn = Number(metrics0.hIn) > 0 ? Number(metrics0.hIn) : (pageMetrics.pageHeightIn || 8.27);
  const width = Math.max(80, Math.round(pageWidthIn * 96));
  const pageHpx = Math.max(40, Math.round(pageHeightIn * 96));
  const pagesNeeded = Math.max(1, Math.min(10, Number(metrics0.pageCount) || 1));
  const totalH = Math.max(pageHpx, pageHpx * pagesNeeded);

  const owner = BrowserWindow.fromWebContents(webContents);
  if (owner && !owner.isDestroyed()) {
    owner.setSize(width, totalH);
  }
  await sleep(80);

  const metrics = await readPageBoxes(webContents).catch(() => metrics0);
  const rects = Array.isArray(metrics.rects) && metrics.rects.length
    ? metrics.rects
    : [{ x: 0, y: 0, width, height: pageHpx }];

  const buffers = [];
  for (let i = 0; i < pagesNeeded; i += 1) {
    const r = rects[i] || { x: 0, y: i * pageHpx, width, height: pageHpx };
    const image = await webContents.capturePage({
      x: Math.max(0, r.x),
      y: Math.max(0, r.y),
      width: Math.max(80, r.width || width),
      height: Math.max(40, r.height || pageHpx),
    });
    if (!image || image.isEmpty?.() || image.getSize().width < 2) {
      throw new Error(`Invoice page ${i + 1} capture was empty`);
    }
    buffers.push(encodeJpeg(image));
  }
  return { buffers, pageWidthIn, pageHeightIn, pageCount: pagesNeeded };
}

module.exports = { captureInvoicePagesHd };
