/** A5 estimation slip layout — saved on Settings → Estimation Print. */

export const SECTION_IDS = ["header", "rate", "meta", "items", "totals", "footer"];

export const SECTION_META = {
  paper: { label: "Paper & type" },
  header: { label: "Shop header" },
  rate: { label: "Gold / silver rate" },
  meta: { label: "Est No / customer / date" },
  items: { label: "Item details" },
  totals: { label: "Totals" },
  footer: { label: "Thank you / customer fields" },
};

const ITEMS_DEFAULT = {
  show_tno: true,
  show_name: true,
  show_pcs: true,
  show_gross: true,
  show_value_add: true,
  show_stone_wt: true,
  show_stone_price: true,
  show_total_wt: true,
  show_cost: true,
  show_wastage: true,
  show_making: true,
  show_making_amount: true,
  show_item_total: true,
};

/** Friendly name → real CSS font stack (with safe fallbacks) for print. Table-based
 * column layout below doesn't depend on monospace alignment, so proportional
 * fonts are just as safe a choice as Courier New. */
export const FONT_FAMILY_OPTIONS = [
  { value: "Courier New", label: "Courier New (typewriter)", css: '"Courier New", Courier, monospace' },
  { value: "Consolas", label: "Consolas (monospace)", css: 'Consolas, "Courier New", monospace' },
  { value: "Arial", label: "Arial (sans-serif)", css: "Arial, Helvetica, sans-serif" },
  { value: "Verdana", label: "Verdana (sans-serif)", css: "Verdana, Geneva, sans-serif" },
  { value: "Times New Roman", label: "Times New Roman (serif)", css: '"Times New Roman", Times, serif' },
];
const FONT_FAMILY_VALUES = new Set(FONT_FAMILY_OPTIONS.map((f) => f.value));

export function fontFamilyCss(name) {
  return FONT_FAMILY_OPTIONS.find((f) => f.value === name)?.css || FONT_FAMILY_OPTIONS[0].css;
}

function normalizeFontFamily(name) {
  return FONT_FAMILY_VALUES.has(name) ? name : "Courier New";
}

export const DEFAULT_ESTIMATION_LAYOUT = {
  version: 1,
  page_w_in: 5.7,
  page_h_in: 8.27,
  font_pt: 10,
  font_family: "Courier New",
  bold: false,
  shop_pt: 13,
  title_pt: 12,
  pad_t: 22,
  pad_r: 28,
  pad_b: 20,
  pad_l: 28,
  show_shop: true,
  show_city: true,
  show_phone: true,
  title_show: true,
  title_text: "ESTIMATION",
  show_rate: true,
  show_quote_no: true,
  show_kv: true,
  show_customer: true,
  show_purity_line: true,
  show_date: true,
  items: { ...ITEMS_DEFAULT },
  show_discount: true,
  show_total: true,
  show_balance: true,
  show_advance: true,
  show_thanking: true,
  show_customer_fields: true,
  show_notes: true,
};

export const SAMPLE_ESTIMATION = {
  quote: {
    quote_no: "QT-2026-001",
    customer_name: "Walk-in Customer",
    customer_mobile: "9876543210",
    gold_rate: 7000,
    discount: 0,
    created_at: new Date().toISOString(),
    notes: "",
  },
  items: [
    {
      product_name: "Gold Necklace",
      code: "T1234",
      qty: 1,
      purity: "22K",
      metal: "Gold",
      gross_weight: 8.24,
      net_weight: 8.1,
      stone_weight: 0.14,
      stone_charges: 500,
      making_charges: 350,
      making_charge_type: "fixed",
      wastage_pct: 2,
    },
  ],
  goldRate: 7000,
  rateMap: { "22K": 6416.9, "24K": 7000, Silver: 90 },
};

function clamp(n, min, max, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function mergeEstimationLayout(raw) {
  const extra = raw && typeof raw === "object" ? raw : {};
  const items = { ...ITEMS_DEFAULT, ...(extra.items && typeof extra.items === "object" ? extra.items : {}) };
  const next = {
    ...DEFAULT_ESTIMATION_LAYOUT,
    ...extra,
    items,
  };
  next.page_w_in = clamp(next.page_w_in, 4.5, 8.5, 5.7);
  next.page_h_in = clamp(next.page_h_in, 6, 14, 8.27);
  next.font_pt = clamp(next.font_pt, 7, 16, 10);
  next.font_family = normalizeFontFamily(next.font_family);
  next.bold = Boolean(next.bold);
  next.shop_pt = clamp(next.shop_pt, 8, 22, 13);
  next.title_pt = clamp(next.title_pt, 8, 22, 12);
  next.pad_t = clamp(next.pad_t, 0, 80, 22);
  next.pad_r = clamp(next.pad_r, 0, 80, 28);
  next.pad_b = clamp(next.pad_b, 0, 80, 20);
  next.pad_l = clamp(next.pad_l, 0, 80, 28);
  next.title_text = String(next.title_text || "ESTIMATION");
  return next;
}

export function setEstimationLayoutPath(layout, path, value) {
  const parts = String(path).split(".");
  const base = mergeEstimationLayout(layout);
  if (parts.length === 1) {
    return mergeEstimationLayout({ ...base, [parts[0]]: value });
  }
  if (parts.length === 2) {
    const [group, key] = parts;
    return mergeEstimationLayout({
      ...base,
      [group]: { ...base[group], [key]: value },
    });
  }
  return mergeEstimationLayout(base);
}

// ── Thermal receipt-printer layout — same field names as the A5 layout above
// (so section toggles / WidgetProps are reused as-is) except for the "paper"
// geometry: a narrow, continuous-feed roll instead of a fixed A5 sheet.
export const DEFAULT_THERMAL_ESTIMATION_LAYOUT = {
  version: 1,
  paper_width_mm: 80,
  font_pt: 9,
  font_family: "Courier New",
  bold: false,
  shop_pt: 11,
  title_pt: 11,
  pad_x: 4,
  show_shop: true,
  show_city: true,
  show_phone: true,
  title_show: true,
  title_text: "ESTIMATION",
  show_rate: true,
  show_quote_no: true,
  show_kv: true,
  show_customer: true,
  show_purity_line: true,
  show_date: true,
  items: { ...ITEMS_DEFAULT },
  show_discount: true,
  show_total: true,
  show_balance: true,
  show_advance: true,
  show_thanking: true,
  show_customer_fields: true,
  show_notes: true,
};

export function mergeThermalEstimationLayout(raw) {
  const extra = raw && typeof raw === "object" ? raw : {};
  const items = { ...ITEMS_DEFAULT, ...(extra.items && typeof extra.items === "object" ? extra.items : {}) };
  const next = {
    ...DEFAULT_THERMAL_ESTIMATION_LAYOUT,
    ...extra,
    items,
  };
  // 58mm and 80mm are the only common thermal roll widths — clamp to a
  // sensible range around them rather than a free-form dimension.
  next.paper_width_mm = clamp(next.paper_width_mm, 48, 84, 80);
  next.font_pt = clamp(next.font_pt, 7, 14, 9);
  next.font_family = normalizeFontFamily(next.font_family);
  next.bold = Boolean(next.bold);
  next.shop_pt = clamp(next.shop_pt, 8, 18, 11);
  next.title_pt = clamp(next.title_pt, 8, 18, 11);
  next.pad_x = clamp(next.pad_x, 0, 16, 4);
  next.title_text = String(next.title_text || "ESTIMATION");
  return next;
}

export function setThermalEstimationLayoutPath(layout, path, value) {
  const parts = String(path).split(".");
  const base = mergeThermalEstimationLayout(layout);
  if (parts.length === 1) {
    return mergeThermalEstimationLayout({ ...base, [parts[0]]: value });
  }
  if (parts.length === 2) {
    const [group, key] = parts;
    return mergeThermalEstimationLayout({
      ...base,
      [group]: { ...base[group], [key]: value },
    });
  }
  return mergeThermalEstimationLayout(base);
}

let _cached = null;
let _cachedThermal = null;
let _cachedActiveType = "normal";
let _loadPromise = null;

export function setCachedEstimationLayout(layout) {
  _cached = mergeEstimationLayout(layout);
}

export function getCachedEstimationLayout() {
  return mergeEstimationLayout(_cached || DEFAULT_ESTIMATION_LAYOUT);
}

export function setCachedThermalEstimationLayout(layout) {
  _cachedThermal = mergeThermalEstimationLayout(layout);
}

export function getCachedThermalEstimationLayout() {
  return mergeThermalEstimationLayout(_cachedThermal || DEFAULT_THERMAL_ESTIMATION_LAYOUT);
}

/** Which layout real estimation prints (Quotations, not the Settings preview) should use. */
export function setCachedEstimationPrinterType(type) {
  _cachedActiveType = type === "thermal" ? "thermal" : "normal";
}

export function getCachedEstimationPrinterType() {
  return _cachedActiveType;
}

export async function loadEstimationLayout() {
  const { layout } = await loadEstimationPrintSettings();
  return layout;
}

/**
 * Fetches both printer-type layouts + which one is active in one call, and
 * warms all three caches. Returns the currently-active {type, layout} plus
 * both layouts individually for the Settings editor.
 */
export async function loadEstimationPrintSettings() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = import("@/lib/api").then(({ default: api }) =>
    api.get("/settings/estimation-print").then(({ data }) => {
      const normal = mergeEstimationLayout(data?.print_layout);
      const thermal = mergeThermalEstimationLayout(data?.thermal_layout);
      const type = data?.active_printer_type === "thermal" ? "thermal" : "normal";
      setCachedEstimationLayout(normal);
      setCachedThermalEstimationLayout(thermal);
      setCachedEstimationPrinterType(type);
      return { type, layout: type === "thermal" ? thermal : normal, normal, thermal };
    }).catch(() => ({
      type: getCachedEstimationPrinterType(),
      layout: getCachedEstimationPrinterType() === "thermal" ? getCachedThermalEstimationLayout() : getCachedEstimationLayout(),
      normal: getCachedEstimationLayout(),
      thermal: getCachedThermalEstimationLayout(),
    })),
  );
  try {
    return await _loadPromise;
  } finally {
    _loadPromise = null;
  }
}
