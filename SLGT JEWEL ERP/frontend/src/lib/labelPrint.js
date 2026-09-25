import JsBarcode from "jsbarcode";
import { mergeBarcodeLayout, getCachedBarcodeLayout, pageSizeMm, ptToTagPx } from "@/lib/barcodeLayout";
import { trayLabelWeights } from "./trayWeight.js";

export function shopAbbr(name) {
  const abbr = (name || "SHOP").split(/\s+/).map((w) => w[0]).join("").toUpperCase();
  return abbr.slice(0, 4) || "SHOP";
}

export function formatPurityTag(purityName) {
  const m = (purityName || "").match(/(\d+)\s*[kKcC]/);
  if (m) return `${m[1]}CT`;
  if (/925/i.test(purityName)) return "925";
  if (/950/i.test(purityName)) return "PT950";
  return purityName || "";
}

/** Strip label purity — e.g. 22K, 18K, 925, PT950 */
export function formatPurityForStrip(product) {
  const raw = String(
    product?.purity_name || product?.purity_code || product?.purity || "",
  ).trim();
  if (!raw) return "";
  const kMatch = raw.match(/(\d+)\s*[kK]/);
  if (kMatch) return `${kMatch[1]}K`;
  if (/925/i.test(raw)) return "925";
  if (/950|pt950/i.test(raw)) return "PT950";
  const ctMatch = raw.match(/(\d+)\s*[cC][tT]/);
  if (ctMatch) return `${ctMatch[1]}CT`;
  // Bare purity fineness (e.g. "Pure 999", "999 Silver") — print just the number.
  const fineMatch = raw.match(/\b(\d{3})\b/);
  if (fineMatch) return fineMatch[1];
  return raw.length <= 8 ? raw.toUpperCase() : raw.slice(0, 8).toUpperCase();
}

export function buildShopPurityLine(shopName, product) {
  const abbr = shopAbbr(shopName);
  const purity = formatPurityForStrip(product);
  return purity ? `${abbr}(${purity})` : abbr;
}

function resolveTagLayout(layout) {
  return mergeBarcodeLayout(layout || getCachedBarcodeLayout());
}

function productCalCode(product) {
  return String(product?.cal_code || "").trim();
}

function lineLabel(L, id, fallback) {
  return L.right?.lines?.find((l) => l.id === id)?.label || fallback;
}

function unitSuffix(L) {
  const s = L.right?.unit_suffix;
  return s == null ? " gms" : String(s);
}

function buildRightPrintLines(product, shopName, L) {
  const shopPurityLine = buildShopPurityLine(shopName, product || {});
  const { gross: gwNum, net: nwNum, stone: savedStone } = trayLabelWeights(product);
  let stoneWt = Number(savedStone) || 0;
  if (!stoneWt && Number.isFinite(gwNum) && Number.isFinite(nwNum) && gwNum > nwNum) {
    stoneWt = +(gwNum - nwNum).toFixed(3);
  }
  let stones = product?.stone_details;
  if (typeof stones === "string") {
    try { stones = JSON.parse(stones); } catch { stones = []; }
  }
  if (!Array.isArray(stones)) stones = [];
  const stoneNames = stones
    .map((s) => s?.stone_type || s?.type || s?.name || "")
    .map((s) => stoneTagLabel(s))
    .filter(Boolean);
  // BarTender sample: (R+E) — no spaces around +
  const stoneLabel = stoneNames.join("+");
  const suffix = unitSuffix(L);
  const gw = formatTagWeight(gwNum, { force3: true });
  const nw = formatTagWeight(nwNum);
  const gwLab = lineLabel(L, "gw", "G.W:");
  const nwLab = lineLabel(L, "nw", "N.W:");
  const stLab = lineLabel(L, "st", "S.W:");
  // No subcategory on this product — leave the line blank rather than
  // printing "undefined"/"null" (the row still reserves its slot, so every
  // tag in a batch print keeps the same line positions).
  const subLab = lineLabel(L, "subcategory", "");
  const subName = String(product?.subcategory_name || "").trim();
  // Same blank-slot rule for a product with no Cal Code.
  const calLab = lineLabel(L, "cal_code", "");
  const calCode = productCalCode(product);
  const byId = {
    subcategory: subName ? `${subLab}${subName.toUpperCase()}` : "",
    cal_code: calCode ? `${calLab}${calCode}` : "",
    shop_purity: shopPurityLine,
    // BarTender: "G.W:12 gms" / "N.W:10 gms" / "S.W: 8 gms (R+E)" — no extra space after label
    gw: gw != null ? `${gwLab}${gw}${suffix}` : `${gwLab}-`,
    nw: nw != null ? `${nwLab}${nw}${suffix}` : `${nwLab}-`,
    st: stoneWt > 0
      ? `${stLab}${formatTagWeight(stoneWt)}${suffix}${stoneLabel ? ` (${stoneLabel})` : ""}`
      : (stoneLabel ? `${stLab}${suffix} (${stoneLabel})` : `${stLab}-`),
  };
  return (L.right.lines || []).filter((l) => l.show).map((l) => byId[l.id] || "");
}

/** G.W keeps 3 decimals when fractional (26.450); whole numbers stay clean (12). */
export function formatTagWeight(value, { force3 = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (force3) {
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return n.toFixed(3);
  }
  const fixed = n.toFixed(3);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function parseStoneDetails(product) {
  let stones = product?.stone_details;
  if (typeof stones === "string") {
    try { stones = JSON.parse(stones); } catch { stones = []; }
  }
  if (!Array.isArray(stones)) stones = [];
  return stones;
}

/** Short stone labels for the tag — e.g. Ruby→R, Emerald→E → "(R+E)". */
function stoneTagLabel(name) {
  const s = String(name || "").trim();
  if (!s) return "";
  if (s.length <= 3) return s.toUpperCase();
  const known = {
    ruby: "R", emerald: "E", diamond: "D", sapphire: "S", pearl: "P",
    topaz: "T", garnet: "G", coral: "C", turquoise: "Tu", onyx: "O",
    amethyst: "A", opal: "Op", zircon: "Z",
  };
  const key = s.toLowerCase();
  if (known[key]) return known[key];
  return s[0].toUpperCase();
}

/** Build right-side lines matching the physical jewellery tag photo. */
export function buildTagWeightLines(product) {
  const { gross: gwNum, net: nwNum, stone: savedStone } = trayLabelWeights(product);
  let stoneWt = Number(savedStone) || 0;
  if (!stoneWt && Number.isFinite(gwNum) && Number.isFinite(nwNum) && gwNum > nwNum) {
    stoneWt = +(gwNum - nwNum).toFixed(3);
  }

  const stones = parseStoneDetails(product);
  const stoneNames = stones
    .map((s) => s?.stone_type || s?.type || s?.name || "")
    .map((s) => stoneTagLabel(s))
    .filter(Boolean);
  const stoneLabel = stoneNames.join("+");

  const gw = formatTagWeight(gwNum, { force3: true });
  const nw = formatTagWeight(nwNum);

  return {
    gwLine: gw != null ? `G.W:${gw} gms` : "G.W:-",
    nwLine: nw != null ? `N.W:${nw} gms` : "N.W:-",
    stLine: stoneWt > 0
      ? `S.W: ${formatTagWeight(stoneWt)} gms${stoneLabel ? ` (${stoneLabel})` : ""}`
      : (stoneLabel ? `S.W: (${stoneLabel})` : "S.W:-"),
  };
}

export function makePinTagBarcodeUrl(code) {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, String(code), {
      format: "CODE128",
      width: 1.1,
      height: 28,
      displayValue: false,
      margin: 0,
      background: "#ffffff",
      lineColor: "#000000",
    });
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  } catch {
    return null;
  }
}

/** TSC printers expect ASCII — UTF-8 dashes/ellipsis print as garbage (e.g. ôçö). */
function toAsciiPrinterText(text) {
  return String(text || "")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/[^\x20-\x7E]/g, "?");
}

function escapeTspl(text) {
  return toAsciiPrinterText(text).replace(/"/g, "'").replace(/\r?\n/g, " ");
}

function truncate(text, max) {
  const s = String(text || "");
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}...`;
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function encodeAscii(text) {
  const s = String(text || "");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    for (let j = 0; j < slice.length; j += 1) bin += String.fromCharCode(slice[j]);
  }
  return btoa(bin);
}

/** Convert canvas pixels → 1-bit TSPL BITMAP payload.
 * TSC TE244 treats bit 1 as white (no heat) and bit 0 as black (heat) when used with
 * our RAW path — so we mark *light* pixels as 1. (Opposite of some TSPL docs.)
 */
function canvasToTsplBitmapBytes(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d");
  if (!ctx || w < 8 || h < 8) return null;
  const { data } = ctx.getImageData(0, 0, w, h);
  const widthBytes = Math.ceil(w / 8);
  const mono = new Uint8Array(widthBytes * h);
  // Fill with "black" (0), then set bits for white/background pixels
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      // Transparent or light → white bit (1). Dark ink → leave 0 (prints black).
      if (a < 128 || lum >= 200) {
        mono[y * widthBytes + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
  }
  return { mono, widthBytes, height: h, widthDots: w };
}

function tagFontCss(L, px, weight = "bold") {
  const family = String(L.font_family || "Times New Roman").replace(/"/g, "");
  return `${weight} ${Math.round(px)}px "${family}", Times, "Times New Roman", serif`;
}

/**
 * Rasterise one jewellery tag for shop media.
 * When layout.use_absolute (default), draws using BarTender mm positions from layout.pos.
 * opts.showGuides — dotted fold + panel edges for on-screen preview only (not printed).
 */
export function renderStripTagCanvas(product, shopName, opts = {}) {
  if (typeof document === "undefined") return null;

  const L = resolveTagLayout(opts.layout);
  const showGuides = Boolean(opts.showGuides);
  const scale = Math.max(1, Math.min(4, Number(opts.scale) || 1));
  const dpm = 8 * scale; // dots per mm on canvas
  const W = Math.round(L.tag_w_mm * dpm);
  const H = Math.round(L.tag_h_mm * dpm);
  const PANEL = Math.round(L.left_mm * dpm);
  const RIGHT_W = Math.round(L.right_mm * dpm);
  const FOLD = PANEL;
  const BODY = PANEL + RIGHT_W;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  if (showGuides) {
    ctx.fillStyle = "#F4F4F5";
    ctx.fillRect(BODY, 0, Math.max(0, W - BODY), H);
  }

  ctx.fillStyle = "#000000";
  ctx.textBaseline = "top";

  const code = String(product?.barcode || product?.code || product?.id || "");
  const calCode = productCalCode(product);
  const abbr = (L.left.shop_text || "").trim() || shopAbbr(shopName);
  const purity = formatPurityForStrip(product || {});
  // 1pt = 25.4/72 mm → canvas dots (physical size matches BarTender / photo)
  const fontFromPt = (pt, weight = "bold") => {
    const px = (Number(pt) * 25.4 / 72) * dpm;
    return tagFontCss(L, px, weight);
  };

  if (L.use_absolute !== false && L.pos) {
    const P = L.pos;
    const mm = (v) => Math.round(Number(v) * dpm);
    ctx.textBaseline = "top";

    if (L.left.show_shop) {
      ctx.textAlign = "left";
      ctx.font = fontFromPt(P.shop.font_pt || 9);
      ctx.fillText(abbr, mm(P.shop.x_mm), mm(P.shop.y_mm));
    }
    if (L.left.show_purity && purity) {
      ctx.textAlign = "left";
      ctx.font = fontFromPt(P.purity.font_pt || 9);
      ctx.fillText(purity, mm(P.purity.x_mm), mm(P.purity.y_mm));
    }

    if (L.left.show_barcode) {
      try {
        const bx = mm(P.barcode.x_mm);
        const by = mm(P.barcode.y_mm);
        const bw = Math.max(8, mm(P.barcode.w_mm));
        const bh = Math.max(8, mm(P.barcode.h_mm));
        const modulePx = Math.max(1, Math.round((Number(P.barcode.module_mm) || 0.25) * dpm));
        const bc = document.createElement("canvas");
        JsBarcode(bc, code || "0", {
          format: "CODE128",
          width: Math.max(1, modulePx / scale),
          height: Math.max(8, Math.round(bh / scale)),
          displayValue: false,
          margin: 0,
          background: "#ffffff",
          lineColor: "#000000",
        });
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(bc, bx, by, bw, bh);
        ctx.imageSmoothingEnabled = true;
      } catch {
        /* barcode optional */
      }
    }

    if (L.left.show_code) {
      ctx.font = fontFromPt(P.code.font_pt || 7);
      // Photo: code left-aligned under barcode
      if (P.code.align === "center") {
        ctx.textAlign = "center";
        const cx = mm(P.code.x_mm) + Math.round(mm(P.code.w_mm || P.barcode.w_mm) / 2);
        ctx.fillText(truncate(code, 12), cx, mm(P.code.y_mm));
      } else {
        ctx.textAlign = "left";
        ctx.fillText(truncate(code, 12), mm(P.code.x_mm), mm(P.code.y_mm));
      }
    }

    if (L.left.show_cal_code && calCode) {
      ctx.textAlign = "left";
      ctx.font = fontFromPt(P.cal_code.font_pt || 7);
      ctx.fillText(truncate(calCode, 12), mm(P.cal_code.x_mm), mm(P.cal_code.y_mm));
    }

    const texts = buildRightPrintLines(product, shopName, L);
    const visibleLines = (L.right.lines || []).filter((l) => l.show);
    const wx = mm(P.weights.x_mm);
    const wy = mm(P.weights.y_mm);
    const wMax = mm(P.weights.w_mm);
    const lineH = mm(P.weights.line_h_mm || 3.5);
    ctx.textAlign = "left";
    visibleLines.forEach((line, idx) => {
      // Per-line font size (set via the "right.line.<id>" panel) overrides the
      // shared weights font_pt — otherwise editing a single line's font size
      // had no visible effect in absolute (BarTender) mode.
      const linePx = Number(line.font_px);
      ctx.font = Number.isFinite(linePx) && linePx > 0
        ? tagFontCss(L, linePx * scale, "bold")
        : fontFromPt(P.weights.font_pt || 9);
      let t = String(texts[idx] || "");
      while (t.length > 3 && ctx.measureText(t).width > wMax) {
        t = `${t.slice(0, -2)}..`;
      }
      ctx.fillText(t, wx, wy + lineH * idx);
    });

    if (showGuides) {
      ctx.save();
      ctx.strokeStyle = "#A3A3A3";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      const box = (x, y, w, h) => ctx.strokeRect(mm(x) + 0.5, mm(y) + 0.5, Math.max(1, mm(w) - 1), Math.max(1, mm(h) - 1));
      box(P.shop.x_mm, P.shop.y_mm, 5.5, 3.2);
      box(P.purity.x_mm, P.purity.y_mm, 5.7, 3.2);
      box(P.barcode.x_mm, P.barcode.y_mm, P.barcode.w_mm, P.barcode.h_mm);
      if (L.left.show_cal_code) box(P.cal_code.x_mm, P.cal_code.y_mm, 8, 3.2);
      box(P.weights.x_mm, P.weights.y_mm, P.weights.w_mm, P.weights.h_mm);
      ctx.strokeStyle = "#D4D4D8";
      ctx.beginPath();
      ctx.moveTo(BODY + 0.5, 1);
      ctx.lineTo(BODY + 0.5, H - 1);
      ctx.stroke();
      ctx.restore();
    }

    return canvas;
  }

  // Legacy panel layout fallback
  const PAD = Math.round(L.pad_x_mm * dpm);
  const PAD_Y = Math.round(L.pad_y_mm * dpm);
  const font = (px, weight = "bold") => tagFontCss(L, px * scale, weight);
  const leftInnerL = PAD;
  const leftInnerR = PANEL - PAD;
  const leftCX = Math.round((leftInnerL + leftInnerR) / 2);
  const leftInnerW = Math.max(8, leftInnerR - leftInnerL);
  const abbrBand = L.left.show_shop || L.left.show_purity
    ? Math.round(L.left.shop_font_px * scale) + Math.round(2 * scale)
    : 0;
  // Legacy layout has no free slot, so a left-panel Cal Code shares the code line.
  const leftCal = L.left.show_cal_code && calCode ? calCode : "";
  const codeText = [L.left.show_code ? truncate(code, 12) : "", leftCal].filter(Boolean).join("  ");
  const codeBand = codeText ? Math.round(L.left.code_font_px * scale) + Math.round(2 * scale) : 0;
  const gapY = Math.round(L.left.gap_px * scale);
  const abbrY = PAD_Y;
  const codeY = H - PAD_Y - Math.max(codeBand, 1);
  const bcY = abbrY + abbrBand + ((L.left.show_shop || L.left.show_purity) ? gapY : 0);
  const bcH = Math.max(Math.round(L.left.barcode_height_px * scale), codeY - gapY - bcY);

  ctx.font = font(L.left.shop_font_px);
  if (L.left.show_shop && L.left.show_purity && purity) {
    ctx.textAlign = "left";
    ctx.fillText(abbr, leftInnerL, abbrY);
    const shopW = ctx.measureText(abbr).width;
    ctx.fillText(purity, leftInnerL + shopW + Math.round(4 * scale), abbrY);
  } else if (L.left.show_shop) {
    ctx.textAlign = "center";
    ctx.fillText(abbr, leftCX, abbrY);
  } else if (L.left.show_purity && purity) {
    ctx.textAlign = "center";
    ctx.fillText(purity, leftCX, abbrY);
  }

  if (L.left.show_barcode) {
    try {
      const bc = document.createElement("canvas");
      JsBarcode(bc, code || "0", {
        format: "CODE128",
        width: L.left.barcode_bar_w * scale,
        height: Math.max(16, Math.round(bcH / scale)),
        displayValue: false,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(bc, leftInnerL, bcY, leftInnerW, Math.max(8, bcH));
      ctx.imageSmoothingEnabled = true;
    } catch {
      /* barcode optional */
    }
  }

  if (codeText) {
    ctx.textAlign = "center";
    ctx.font = font(L.left.code_font_px);
    ctx.fillText(codeText, leftCX, codeY);
  }
  ctx.textAlign = L.right.align === "center" ? "center" : "left";

  const rightX = L.right.align === "center" ? FOLD + Math.round(RIGHT_W / 2) : FOLD + PAD;
  const rightMax = BODY - PAD - (FOLD + PAD);
  const lineH = Math.round(L.right.line_h_px * scale);
  const fitLine = (text, fontCss, y) => {
    ctx.font = fontCss;
    let line = String(text || "");
    while (line.length > 3 && ctx.measureText(line).width > rightMax) {
      line = `${line.slice(0, -2)}...`;
    }
    ctx.fillText(line, rightX, y);
  };
  const texts = buildRightPrintLines(product, shopName, L);
  const visibleLines = (L.right.lines || []).filter((l) => l.show);
  const blockH = lineH * Math.max(1, visibleLines.length);
  const rightTop = Math.round((H - blockH) / 2);
  visibleLines.forEach((line, idx) => {
    fitLine(texts[idx], font(Number(line.font_px) || L.right.font_px), rightTop + lineH * idx);
  });

  if (showGuides) {
    ctx.save();
    ctx.strokeStyle = "#A3A3A3";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.strokeRect(PAD + 0.5, PAD_Y + 0.5, Math.max(1, PANEL - PAD * 2 - 1), Math.max(1, H - PAD_Y * 2 - 1));
    ctx.strokeRect(FOLD + PAD + 0.5, PAD_Y + 0.5, Math.max(1, RIGHT_W - PAD * 2 - 1), Math.max(1, H - PAD_Y * 2 - 1));
    ctx.strokeStyle = "#0A0A0A";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(FOLD + 0.5, 1);
    ctx.lineTo(FOLD + 0.5, H - 1);
    ctx.stroke();
    ctx.strokeStyle = "#D4D4D8";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(BODY + 0.5, 1);
    ctx.lineTo(BODY + 0.5, H - 1);
    ctx.stroke();
    ctx.restore();
  }

  return canvas;
}

function ptToCssPx(pt) {
  // Same as barcodeLayout.ptToTagPx — 203 dpi print canvas
  const n = Number(pt);
  if (!Number.isFinite(n) || n <= 0) return 12;
  return Math.round(n * (203.2 / 72));
}

export function renderStripTagPng(product, shopName, opts = {}) {
  const canvas = renderStripTagCanvas(product, shopName, opts);
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/**
 * Native TSC TSPL — BITMAP only, same canvas as Live Preview (scale 1, no guides).
 * Media feed defaults to continuous (GAP 0,0) so dumbbell stems don't fake a gap and drift.
 */
export function generateStripTagTSPLBytes(tagItems, shopName, layout = null) {
  const L = resolveTagLayout(layout);
  const page = pageSizeMm(L);
  const gapMm = Number(L.gap_mm);
  const gap = Number.isFinite(gapMm) ? gapMm : 4;
  const gapOff = Number(L.gap_offset_mm) || 0;
  const sense = L.sense_mode || "continuous";

  // Continuous: SIZE height = label + gap (fixed pitch). Bitmap stays tag_h tall at top.
  // Gap/Bline: SIZE = label height; sensor finds the next mark/gap.
  let sizeH = page.h;
  let senseCmd = "GAP 0,0";
  if (sense === "continuous") {
    sizeH = Math.round((page.h + Math.max(0, gap)) * 100) / 100;
    senseCmd = "GAP 0,0";
  } else if (sense === "bline") {
    senseCmd = `BLINE ${Math.max(0.5, gap || 3)} mm, ${gapOff}`;
  } else {
    senseCmd = `GAP ${Math.max(0.5, gap || 2)} mm, ${gapOff}`;
  }

  const header = encodeAscii([
    `SIZE ${page.w} mm, ${sizeH} mm`,
    senseCmd,
    "DENSITY 12",
    "SPEED 3",
    "DIRECTION 1",
    "REFERENCE 0,0",
    "OFFSET 0 mm",
    "SET PEEL OFF",
    "SET CUTTER OFF",
    "SET TEAR ON",
    "",
  ].join("\r\n"));

  const parts = [header];
  let labelCount = 0;

  for (const { product, qty } of tagItems || []) {
    const copies = Math.max(1, Number(qty) || 1);
    const canvas = renderStripTagCanvas(product, shopName, {
      layout: L,
      scale: 1,
      showGuides: false,
    });
    const bmp = canvas ? canvasToTsplBitmapBytes(canvas) : null;
    if (!bmp) {
      throw new Error("Could not rasterise tag for print (canvas/bitmap failed)");
    }
    for (let c = 0; c < copies; c += 1) {
      parts.push(encodeAscii("CLS\r\n"));
      parts.push(encodeAscii(`BITMAP 0,0,${bmp.widthBytes},${bmp.height},0,`));
      parts.push(bmp.mono);
      parts.push(encodeAscii("\r\nPRINT 1,1\r\n"));
      labelCount += 1;
    }
  }

  if (!labelCount) throw new Error("No tags to print");
  return concatBytes(parts);
}

/** @deprecated string form — prefer generateStripTagTSPLBytes / generateStripTagTSPLBase64 */
export function generateStripTagTSPL(tagItems, shopName, layout = null) {
  const bytes = generateStripTagTSPLBytes(tagItems, shopName, layout);
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return s;
}

export function generateStripTagTSPLBase64(tagItems, shopName, layout = null) {
  return bytesToBase64(generateStripTagTSPLBytes(tagItems, shopName, layout));
}

/**
 * Jewellery strip label as bitmap pages (thermal-safe).
 */
export function generateStripTagHTML(tagItems, shopName, layout = null) {
  const L = resolveTagLayout(layout);
  const page = pageSizeMm(L);
  const tags = tagItems.flatMap(({ product, qty }) =>
    Array(Math.max(1, Number(qty) || 1)).fill(null).map(() => {
      const png = renderStripTagPng(product, shopName, { layout: L });
      if (!png) {
        const code = product.barcode || product.code || String(product.id || "");
        const rightLines = buildRightPrintLines(product, shopName, L);
        const abbr = (L.left.shop_text || "").trim() || shopAbbr(shopName);
        const cal = L.left.show_cal_code ? productCalCode(product) : "";
        return `<div class="page tag"><div class="left"><b>${abbr}</b><div class="code">${code}${cal ? ` ${cal}` : ""}</div></div><div class="right">${rightLines.map((l) => `<div>${l}</div>`).join("")}</div></div>`;
      }
      const pxW = Math.round(L.tag_w_mm * 8);
      const pxH = Math.round(L.tag_h_mm * 8);
      return `<div class="page tag"><img class="tag-img" src="${png}" alt="" width="${pxW}" height="${pxH}" /></div>`;
    })
  ).join("");

  const wIn = (page.w / 25.4).toFixed(4);
  const hIn = (page.h / 25.4).toFixed(4);
  const family = String(L.font_family || "Times New Roman").replace(/"/g, "");
  return `<!DOCTYPE html>
<html lang="en" data-page-w-in="${wIn}" data-page-h-in="${hIn}">
<head>
<meta charset="utf-8">
<title>Jewellery Tags</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body {
  width: ${page.w}mm;
  height: ${page.h}mm;
  background: #fff;
}
@page { size: ${page.w}mm ${page.h}mm; margin: 0; }
.page, .tag {
  width: ${page.w}mm;
  height: ${page.h}mm;
  page-break-after: always;
  overflow: hidden;
  break-after: page;
}
.tag-img {
  width: ${L.tag_w_mm}mm;
  height: ${L.tag_h_mm}mm;
  display: block;
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
.left, .right { font-family: "${family}", Times, serif; font-size: 9pt; font-weight: 700; }
.left { float: left; width: ${L.left_mm}mm; padding: ${L.pad_y_mm}mm ${L.pad_x_mm}mm; text-align: center; }
.right { float: left; width: ${L.right_mm}mm; padding: ${L.pad_y_mm}mm ${L.pad_x_mm}mm; }
.code { font-size: 8pt; }
</style>
</head>
<body>${tags}</body>
</html>`;
}

export async function generateStripTagPrintPayload(tagItems, shopName) {
  const { loadBarcodeLayout } = await import("@/lib/barcodeLayout");
  const layout = await loadBarcodeLayout();
  const rawBytes = generateStripTagTSPLBytes(tagItems, shopName, layout);
  return {
    html: generateStripTagHTML(tagItems, shopName, layout),
    // Never send binary TSPL as a JS string over IPC (UTF-8 corrupts BITMAP).
    rawTspl: null,
    rawTsplBase64: bytesToBase64(rawBytes),
    layout,
  };
}
