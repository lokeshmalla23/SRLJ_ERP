/** Jewellery strip tag layout — saved on Settings → Barcode Tag.
 * Defaults match the BarTender jewellery strip setup used in shop:
 * template 96×15 mm, page 98.6×15 mm (1.3 mm L/R margins), Times New Roman Bold ~9 pt.
 */

// "subcategory" is listed first — its canonical position is above the weight
// lines (Settings → Barcode Tag → "Show Subcategory Name"), per mergeLines().
export const RIGHT_LINE_IDS = ["subcategory", "shop_purity", "gw", "nw", "st", "cal_code"];

/** 9 pt at TSC 203 dpi (8 dots/mm) ≈ canvas px used by the rasteriser. */
export function ptToTagPx(pt) {
  const n = Number(pt);
  if (!Number.isFinite(n) || n <= 0) return 12;
  return Math.round(n * (203.2 / 72));
}

export const DEFAULT_RIGHT_LINES = [
  // Off by default — existing tags must not change until an admin opts in.
  { id: "subcategory", show: false, label: "", font_px: ptToTagPx(9) },
  { id: "shop_purity", show: false, label: "", font_px: ptToTagPx(9) },
  { id: "gw", show: true, label: "G.W:", font_px: ptToTagPx(9) },
  { id: "nw", show: true, label: "N.W:", font_px: ptToTagPx(9) },
  { id: "st", show: true, label: "S.W: ", font_px: ptToTagPx(9) },
  // Product's Cal Code (Settings → Application Management → Cal Code). Off by default.
  { id: "cal_code", show: false, label: "", font_px: ptToTagPx(9) },
];

export const WIDGET_META = {
  paper: { label: "Tag size & panels" },
  left: { label: "Left — shop / barcode / code" },
  right: { label: "Right — purity & weights" },
};

/**
 * Absolute positions from BarTender UltraLite `9615.btw` + physical tag photo (image 2).
 * Top-Left reference on the 96×15 mm template.
 */
export const DEFAULT_POS = {
  shop: { x_mm: 3.7, y_mm: 1.2, font_pt: 9 },
  purity: { x_mm: 18.0, y_mm: 1.2, font_pt: 9 },
  barcode: { x_mm: 3.8, y_mm: 5.2, w_mm: 19.8, h_mm: 5.1, module_mm: 0.25 },
  code: { x_mm: 3.8, y_mm: 10.5, w_mm: 19.8, font_pt: 7, align: "left" },
  // Left-panel Cal Code — beside the tag number, under the barcode.
  cal_code: { x_mm: 14.5, y_mm: 10.5, font_pt: 7 },
  weights: { x_mm: 28.5, y_mm: 2.0, w_mm: 28, h_mm: 11, font_pt: 9, line_h_mm: 3.5 },
};

/** Bump when BarTender geometry / media feed changes — old API layouts migrate on load. */
export const LAYOUT_VERSION = 4;

const LEFT_DEFAULT = {
  show_shop: true,
  shop_text: "",
  show_purity: true,
  shop_font_px: ptToTagPx(9.5),
  show_barcode: true,
  barcode_height_px: Math.round(5.1 * 8),
  barcode_bar_w: 2,
  show_code: true,
  code_font_px: ptToTagPx(8),
  show_cal_code: false,
  gap_px: 1,
};

const RIGHT_DEFAULT = {
  font_px: ptToTagPx(9),
  line_h_px: Math.round(3.7 * 8),
  align: "left",
  unit_suffix: " gms",
  lines: DEFAULT_RIGHT_LINES.map((l) => ({ ...l })),
};

export const TAG_W_MIN = 20;
export const TAG_W_MAX = 200;
export const TAG_H_MIN = 6;
export const TAG_H_MAX = 50;

export const TAG_SIZE_PRESETS = [
  { w: 96, h: 15 },
  { w: 80, h: 12 },
  { w: 90, h: 12 },
  { w: 90, h: 18 },
  { w: 100, h: 15 },
  { w: 110, h: 18 },
];

export function formatTagSizeMm(w, h) {
  return `${Number(w)} × ${Number(h)}`;
}

/** Accepts 80x12, 80 × 12, 90 X 18 mm, etc. */
export function parseTagSizeMm(raw) {
  const t = String(raw || "")
    .replace(/mm/gi, "")
    .replace(/[×✕✖*]/g, "x")
    .replace(/,/g, ".")
    .trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  return { w, h };
}

/** BarTender Page Setup → Layout defaults (`9615.btw` / physical tag photo). */
export const DEFAULT_BARCODE_LAYOUT = {
  layout_version: LAYOUT_VERSION,
  tag_w_mm: 96,
  tag_h_mm: 15,
  margin_l_mm: 0,
  margin_r_mm: 0,
  margin_t_mm: 0,
  margin_b_mm: 0,
  /**
   * Media feed — dumbbell jewellery tags often confuse GAP sensors (stem looks like a gap),
   * which causes vertical drift on the 2nd/3rd label. Default: continuous fixed-pitch feed.
   */
  sense_mode: "continuous", // continuous | gap | bline
  gap_mm: 4,
  gap_offset_mm: 0,
  left_mm: 28.5,
  right_mm: 27.5,
  pad_x_mm: 0,
  pad_y_mm: 0,
  font_family: "Times New Roman",
  use_absolute: true,
  pos: {
    shop: { ...DEFAULT_POS.shop },
    purity: { ...DEFAULT_POS.purity },
    barcode: { ...DEFAULT_POS.barcode },
    code: { ...DEFAULT_POS.code },
    cal_code: { ...DEFAULT_POS.cal_code },
    weights: { ...DEFAULT_POS.weights },
  },
  left: { ...LEFT_DEFAULT },
  right: {
    ...RIGHT_DEFAULT,
    lines: DEFAULT_RIGHT_LINES.map((l) => ({ ...l })),
  },
};

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (Number.isNaN(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function mergeBox(def, src) {
  const next = { ...def };
  if (!src || typeof src !== "object" || Array.isArray(src)) return next;
  for (const key of Object.keys(def)) {
    if (key === "lines") continue;
    if (src[key] === undefined || src[key] === null) continue;
    if (typeof def[key] === "boolean") next[key] = Boolean(src[key]);
    else if (typeof def[key] === "number") {
      const n = Number(src[key]);
      if (!Number.isNaN(n)) next[key] = n;
    } else if (typeof def[key] === "string") {
      next[key] = String(src[key]);
    }
  }
  return next;
}

function mergeLines(srcLines) {
  const incoming = Array.isArray(srcLines) ? srcLines.filter((l) => l && l.id) : [];
  const incomingIds = incoming.map((l) => l.id).filter((id) => RIGHT_LINE_IDS.includes(id));
  let order;
  if (incomingIds.length) {
    // A layout saved before a new line id existed (e.g. "subcategory") won't
    // have it yet — insert it at its canonical relative position instead of
    // always trailing at the very end, so a newly introduced line still
    // defaults to the right place (e.g. above the weight lines) even for
    // already-saved layouts, not just brand-new ones.
    order = [...incomingIds];
    const missing = RIGHT_LINE_IDS.filter((id) => !incomingIds.includes(id));
    for (const id of missing) {
      const canonicalIdx = RIGHT_LINE_IDS.indexOf(id);
      let insertAt = order.length;
      for (let i = 0; i < order.length; i++) {
        if (RIGHT_LINE_IDS.indexOf(order[i]) > canonicalIdx) { insertAt = i; break; }
      }
      order.splice(insertAt, 0, id);
    }
  } else {
    order = [...RIGHT_LINE_IDS];
  }
  const byId = new Map(incoming.map((l) => [l.id, l]));
  return order.map((id) => {
    const def = DEFAULT_RIGHT_LINES.find((d) => d.id === id);
    return mergeBox(def, byId.get(id));
  });
}

function mergePos(srcPos) {
  const out = {};
  for (const key of Object.keys(DEFAULT_POS)) {
    out[key] = mergeBox(DEFAULT_POS[key], srcPos?.[key]);
  }
  return out;
}

function buildMergedLayout(seed) {
  const sense = ["continuous", "gap", "bline"].includes(seed.sense_mode)
    ? seed.sense_mode
    : "continuous";
  const next = {
    layout_version: LAYOUT_VERSION,
    tag_w_mm: clamp(seed.tag_w_mm, TAG_W_MIN, TAG_W_MAX, DEFAULT_BARCODE_LAYOUT.tag_w_mm),
    tag_h_mm: clamp(seed.tag_h_mm, TAG_H_MIN, TAG_H_MAX, DEFAULT_BARCODE_LAYOUT.tag_h_mm),
    margin_l_mm: clamp(seed.margin_l_mm, 0, 10, 0),
    margin_r_mm: clamp(seed.margin_r_mm, 0, 10, 0),
    margin_t_mm: clamp(seed.margin_t_mm, 0, 6, 0),
    margin_b_mm: clamp(seed.margin_b_mm, 0, 6, 0),
    sense_mode: sense,
    gap_mm: clamp(seed.gap_mm, 0, 20, 4),
    gap_offset_mm: clamp(seed.gap_offset_mm, -10, 10, 0),
    left_mm: clamp(seed.left_mm, 8, Math.max(50, TAG_W_MAX - 12), DEFAULT_BARCODE_LAYOUT.left_mm),
    right_mm: clamp(seed.right_mm, 8, Math.max(50, TAG_W_MAX - 12), DEFAULT_BARCODE_LAYOUT.right_mm),
    pad_x_mm: clamp(seed.pad_x_mm, 0, 8, 0),
    pad_y_mm: clamp(seed.pad_y_mm, 0, 4, 0),
    font_family: String(seed.font_family || "Times New Roman").slice(0, 64),
    use_absolute: seed.use_absolute === undefined ? true : Boolean(seed.use_absolute),
    pos: mergePos(seed.pos),
    left: mergeBox(LEFT_DEFAULT, seed.left),
    right: {
      ...mergeBox(RIGHT_DEFAULT, seed.right),
      unit_suffix: seed.right && Object.prototype.hasOwnProperty.call(seed.right, "unit_suffix")
        ? String(seed.right.unit_suffix ?? "")
        : " gms",
      lines: mergeLines(seed.right?.lines),
    },
  };
  next.left.shop_font_px = clamp(next.left.shop_font_px, 5, 40, LEFT_DEFAULT.shop_font_px);
  next.left.code_font_px = clamp(next.left.code_font_px, 5, 40, LEFT_DEFAULT.code_font_px);
  next.left.barcode_height_px = clamp(next.left.barcode_height_px, 8, 80, LEFT_DEFAULT.barcode_height_px);
  next.left.barcode_bar_w = clamp(next.left.barcode_bar_w, 0.6, 4, LEFT_DEFAULT.barcode_bar_w);
  next.left.gap_px = clamp(next.left.gap_px, 0, 16, LEFT_DEFAULT.gap_px);
  next.left.show_purity = next.left.show_purity !== false;
  next.left.show_shop = next.left.show_shop !== false;
  next.left.show_barcode = next.left.show_barcode !== false;
  next.left.show_code = next.left.show_code !== false;
  next.right.font_px = clamp(next.right.font_px, 5, 40, RIGHT_DEFAULT.font_px);
  next.right.line_h_px = clamp(next.right.line_h_px, 6, 40, RIGHT_DEFAULT.line_h_px);
  next.right.align = next.right.align === "center" ? "center" : "left";
  next.right.lines = next.right.lines.map((l) => ({
    ...l,
    font_px: clamp(l.font_px, 5, 40, next.right.font_px),
  }));
  for (const key of Object.keys(next.pos)) {
    const p = next.pos[key];
    p.x_mm = clamp(p.x_mm, 0, TAG_W_MAX, DEFAULT_POS[key].x_mm);
    p.y_mm = clamp(p.y_mm, 0, TAG_H_MAX, DEFAULT_POS[key].y_mm);
    if (p.w_mm != null) p.w_mm = clamp(p.w_mm, 1, TAG_W_MAX, DEFAULT_POS[key].w_mm);
    if (p.h_mm != null) p.h_mm = clamp(p.h_mm, 1, TAG_H_MAX, DEFAULT_POS[key].h_mm);
    if (p.font_pt != null) p.font_pt = clamp(p.font_pt, 4, 24, DEFAULT_POS[key].font_pt);
    if (p.module_mm != null) p.module_mm = clamp(p.module_mm, 0.1, 1, DEFAULT_POS[key].module_mm);
    if (p.line_h_mm != null) p.line_h_mm = clamp(p.line_h_mm, 1, 10, DEFAULT_POS[key].line_h_mm);
  }
  if (next.left_mm + next.right_mm > next.tag_w_mm - 4) {
    next.right_mm = Math.max(8, next.tag_w_mm - next.left_mm - 4);
  }
  return next;
}

/** Fresh BarTender defaults — use for Reset and first load. */
export function createDefaultBarcodeLayout() {
  return buildMergedLayout({
    layout_version: LAYOUT_VERSION,
    tag_w_mm: 96,
    tag_h_mm: 15,
    sense_mode: "continuous",
    gap_mm: 4,
    gap_offset_mm: 0,
    font_family: "Times New Roman",
    use_absolute: true,
    pos: {
      shop: { ...DEFAULT_POS.shop },
      purity: { ...DEFAULT_POS.purity },
      barcode: { ...DEFAULT_POS.barcode },
      code: { ...DEFAULT_POS.code },
      cal_code: { ...DEFAULT_POS.cal_code },
      weights: { ...DEFAULT_POS.weights },
    },
    left: { ...LEFT_DEFAULT },
    right: {
      ...RIGHT_DEFAULT,
      unit_suffix: " gms",
      lines: DEFAULT_RIGHT_LINES.map((l) => ({ ...l })),
    },
  });
}

export function pageSizeMm(layout) {
  const L = layout || DEFAULT_BARCODE_LAYOUT;
  // Print media = template size (96×15). Extra "page" margins scale fonts wrong on TSC stock.
  return {
    w: Math.round(Number(L.tag_w_mm) * 100) / 100,
    h: Math.round(Number(L.tag_h_mm) * 100) / 100,
  };
}

export function mergeBarcodeLayout(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const ver = Number(src.layout_version || 0);
  // Pre-BarTender layouts → full defaults
  if (ver < 2) {
    return createDefaultBarcodeLayout();
  }
  // v2/v3 → keep artwork; lock feed to continuous + 4 mm gap (shop stock)
  if (ver < LAYOUT_VERSION) {
    return buildMergedLayout({
      ...src,
      layout_version: LAYOUT_VERSION,
      sense_mode: "continuous",
      gap_mm: 4,
      gap_offset_mm: src.gap_offset_mm != null ? src.gap_offset_mm : 0,
    });
  }
  return buildMergedLayout(src);
}

export function applyTagSize(layout, w, h) {
  return mergeBarcodeLayout({ ...layout, tag_w_mm: w, tag_h_mm: h });
}

/**
 * The weights block's global "Font pt" control (BarTender position panel) sets
 * a shared size — apply it to every right-side line's font_px too, since the
 * renderer now prefers each line's own font_px (so per-line overrides work).
 */
export function applyWeightsFontPt(layout, pt) {
  const base = mergeBarcodeLayout(layout);
  const px = ptToTagPx(pt);
  return mergeBarcodeLayout({
    ...base,
    pos: { ...base.pos, weights: { ...base.pos.weights, font_pt: pt } },
    right: {
      ...base.right,
      lines: base.right.lines.map((l) => ({ ...l, font_px: px })),
    },
  });
}

export function setBarcodeLayoutPath(layout, path, value) {
  const parts = String(path).split(".");
  const base = mergeBarcodeLayout(layout);
  if (parts[0] === "right" && parts[1] === "lines" && parts[2] && parts[3]) {
    base.right = {
      ...base.right,
      lines: base.right.lines.map((l) => (l.id === parts[2] ? { ...l, [parts[3]]: value } : l)),
    };
    return mergeBarcodeLayout(base);
  }
  if (parts[0] === "pos" && parts[1] && parts[2]) {
    base.pos = {
      ...base.pos,
      [parts[1]]: { ...base.pos[parts[1]], [parts[2]]: value },
    };
    return mergeBarcodeLayout(base);
  }
  if (parts.length === 1) return mergeBarcodeLayout({ ...base, [parts[0]]: value });
  if (parts.length === 2) {
    return mergeBarcodeLayout({
      ...base,
      [parts[0]]: { ...base[parts[0]], [parts[1]]: value },
    });
  }
  return mergeBarcodeLayout(base);
}

export function moveRightLine(layout, id, dir) {
  const next = mergeBarcodeLayout(layout);
  const lines = [...next.right.lines];
  const i = lines.findIndex((l) => l.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= lines.length) return next;
  [lines[i], lines[j]] = [lines[j], lines[i]];
  return mergeBarcodeLayout({ ...next, right: { ...next.right, lines } });
}

/** Sample matches the BarTender template preview (weights + code). */
export const SAMPLE_TAG_PRODUCT = {
  barcode: "10001",
  code: "10001",
  purity: "22K",
  purity_name: "22K",
  gross_weight: 12,
  net_weight: 10,
  stone_weight: 8,
  stone_details: [{ stone_type: "Ruby" }, { stone_type: "Emerald" }],
  subcategory_name: "Necklaces",
  cal_code: "SCN12393",
};

let _cachedLayout = null;
let _loadPromise = null;

export function setCachedBarcodeLayout(layout) {
  _cachedLayout = mergeBarcodeLayout(layout);
}

export function getCachedBarcodeLayout() {
  return _cachedLayout ? mergeBarcodeLayout(_cachedLayout) : createDefaultBarcodeLayout();
}

export async function loadBarcodeLayout() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = import("@/lib/api").then(({ default: api }) =>
    api.get("/settings/barcode-tag").then(({ data }) => {
      const merged = mergeBarcodeLayout(data?.print_layout);
      setCachedBarcodeLayout(merged);
      return merged;
    }).catch(() => getCachedBarcodeLayout())
  );
  try {
    return await _loadPromise;
  } finally {
    _loadPromise = null;
  }
}
