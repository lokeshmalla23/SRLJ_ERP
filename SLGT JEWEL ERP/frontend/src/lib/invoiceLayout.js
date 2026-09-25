/** A5 letterhead print layout — saved on Settings → Invoice Print. */

export const SECTION_IDS = [
  "title",
  "info",
  "items",
  "breakdown",
  "net",
  "payments",
  "words",
  "note",
  "signatures",
];

export const SECTION_META = {
  paper: { label: "Paper & letterhead" },
  title: { label: "Title bar" },
  info: { label: "Gold / GST / Customer" },
  items: { label: "Items table" },
  breakdown: { label: "Tax breakdown" },
  net: { label: "Net amount" },
  payments: { label: "Payments" },
  words: { label: "Amount in words" },
  note: { label: "Extra note" },
  signatures: { label: "Signatures" },
};

export const SUBWIDGET_META = {
  "title.text": { label: "Title text", parent: "title" },
  "meta.invoice": { label: "Invoice number", parent: "title" },
  "meta.date": { label: "Date", parent: "title" },
  "info.gold": { label: "Gold rate", parent: "info" },
  "info.gstin": { label: "GSTIN", parent: "info" },
  "info.customer": { label: "Customer name", parent: "info" },
  "info.phone": { label: "Phone", parent: "info" },
  "info.place": { label: "Place of supply", parent: "info" },
  "signatures.left": { label: "Customer signature", parent: "signatures" },
  "signatures.right": { label: "Authorised signatory", parent: "signatures" },
};

export function widgetParent(id) {
  if (!id) return "paper";
  if (SUBWIDGET_META[id]) return SUBWIDGET_META[id].parent;
  if (String(id).startsWith("items.col.")) return "items";
  return id;
}

export function widgetLabel(id, layout) {
  if (SUBWIDGET_META[id]) return SUBWIDGET_META[id].label;
  if (String(id).startsWith("items.col.")) {
    const colId = String(id).slice("items.col.".length);
    const col = layout?.items?.columns?.find((c) => c.id === colId);
    return col?.label || colId;
  }
  return SECTION_META[id]?.label || id;
}

export const DEFAULT_COLUMNS = [
  { id: "qty", label: "QTY", show: true, width: 7, align: "center" },
  { id: "desc", label: "DESCRIPTION", show: true, width: 28, align: "left" },
  { id: "hsn", label: "HSN", show: true, width: 9, align: "center" },
  { id: "purity", label: "PURITY", show: true, width: 10, align: "center" },
  { id: "gross", label: "GROSS WT (g)", show: true, width: 12, align: "right" },
  { id: "net", label: "NET WT (g)", show: true, width: 11, align: "right" },
  { id: "va", label: "VA (g)", show: true, width: 9, align: "right" },
  { id: "value", label: "PRODUCT VALUE", show: true, width: 14, align: "right" },
];

const TITLE_DEFAULT = {
  show: true,
  text: "TAX INVOICE",
  font_pt: 11,
  align: "left",
  bold: true,
  letter_spacing: 0.08,
  pad_t: 3,
  pad_r: 6,
  pad_b: 3,
  pad_l: 6,
  mb: 4,
  border: "inherit",
};

const META_DEFAULT = {
  show_invoice_no: true,
  show_date: true,
  invoice_label: "No :",
  date_label: "Date :",
  font_pt: 8,
  invoice_font_pt: 8,
  date_font_pt: 8,
  align: "right",
};

const INFO_DEFAULT = {
  show: true,
  show_gold_rate: true,
  show_gstin: true,
  show_customer: true,
  show_place_of_supply: true,
  show_phone: true,
  gold_label: "Gold Rate 22k",
  quality_text: "Gold Quality : BIS 916",
  customer_label: "Customer Details:",
  place_label: "Place of Supply",
  font_pt: 7.5,
  gold_pt: 7.5,
  gstin_pt: 7.5,
  customer_pt: 7.5,
  phone_pt: 7.5,
  place_pt: 7.5,
  pad_t: 3,
  pad_r: 6,
  pad_b: 3,
  pad_l: 6,
  mb: 0,
  left_width: 50,
  line_h: 1.55,
  line_gap: 1,
  border: "inherit",
};

const ITEMS_DEFAULT = {
  show: true,
  header_pt: 7,
  body_pt: 7.5,
  footer_pt: 7.5,
  cell_pad_y: 2,
  cell_pad_x: 3,
  head_pad_y: 2,
  mb: 0,
  header_bg: "#1a1a1a",
  header_fg: "#ffffff",
  footer_bg: "#f5f5f5",
  border: "inherit",
};

const BREAKDOWN_DEFAULT = {
  show: true,
  font_pt: 7.5,
  pad_t: 2,
  pad_r: 6,
  pad_b: 2,
  pad_l: 6,
  mb: 0,
  width_pct: 48,
  align: "right",
  taxable_label: "Taxable Amount",
  border: "inherit",
};

const NET_DEFAULT = {
  show: true,
  font_pt: 8,
  bold: true,
  pad_t: 3,
  pad_r: 6,
  pad_b: 3,
  pad_l: 6,
  mb: 0,
  label: "Net Amount",
  bg: "#f5f5f5",
  border: "inherit",
};

const PAYMENTS_DEFAULT = {
  show: true,
  font_pt: 7.5,
  pad_t: 2,
  pad_r: 6,
  pad_b: 2,
  pad_l: 6,
  mb: 0,
  border: "inherit",
};

const WORDS_DEFAULT = {
  show: true,
  font_pt: 7,
  pad_t: 2,
  pad_r: 6,
  pad_b: 2,
  pad_l: 6,
  mb: 0,
  prefix: "In Words:",
  suffix: "Rupees Only",
  border: "inherit",
};

const NOTE_DEFAULT = {
  show: true,
  text: "",
  font_pt: 7,
  align: "left",
  pad_t: 2,
  pad_r: 6,
  pad_b: 2,
  pad_l: 6,
  mb: 0,
  border: "none",
};

const SIG_DEFAULT = {
  show: true,
  font_pt: 7.5,
  pad_t: 8,
  pad_r: 14,
  pad_b: 4,
  pad_l: 14,
  mb: 0,
  left_text: "Customer Signature",
  right_label: "Authorised Signatory",
  left_font_pt: 7.5,
  right_font_pt: 7.5,
  line_w: 140,
  border: "none",
};

export const DEFAULT_INVOICE_LAYOUT = {
  paper: "A5",
  page_w_in: 5.7,
  page_h_in: 8.27,
  header_in: 1.55,
  footer_in: 1.05,
  side_in: 0.08,
  font_pt: 8,
  title_pt: 11,
  table_pt: 7.5,
  line_h: 1.45,
  show_lines: true,
  border_pt: 1,
  section_order: [...SECTION_IDS],
  title: { ...TITLE_DEFAULT },
  meta: { ...META_DEFAULT },
  info: { ...INFO_DEFAULT },
  items: { ...ITEMS_DEFAULT, columns: DEFAULT_COLUMNS.map((c) => ({ ...c })) },
  breakdown: { ...BREAKDOWN_DEFAULT },
  net: { ...NET_DEFAULT },
  payments: { ...PAYMENTS_DEFAULT },
  words: { ...WORDS_DEFAULT },
  note: { ...NOTE_DEFAULT },
  signatures: { ...SIG_DEFAULT },
  // flat aliases kept in mergeInvoiceLayout for older saved layouts
  title_text: TITLE_DEFAULT.text,
  title_align: TITLE_DEFAULT.align,
  show_title: true,
  show_invoice_no: true,
  show_date: true,
  show_gold_rate: true,
  show_gstin: true,
  show_customer: true,
  show_place_of_supply: true,
  show_hsn: true,
  show_purity: true,
  show_gross: true,
  show_net: true,
  show_va: true,
  show_payments: true,
  show_words: true,
  show_signatures: true,
  custom_note: "",
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

function mergeColumns(srcCols) {
  const incoming = Array.isArray(srcCols) ? srcCols.filter((c) => c && c.id) : [];
  const order = incoming.length
    ? [
        ...incoming.map((c) => c.id).filter((id) => DEFAULT_COLUMNS.some((d) => d.id === id)),
        ...DEFAULT_COLUMNS.map((d) => d.id).filter((id) => !incoming.some((c) => c.id === id)),
      ]
    : DEFAULT_COLUMNS.map((d) => d.id);
  const byId = new Map(incoming.map((c) => [c.id, c]));
  return order.map((id) => {
    const def = DEFAULT_COLUMNS.find((d) => d.id === id);
    return mergeBox(def, byId.get(id));
  }).map((col) => ({
    ...col,
    width: clamp(col.width, 4, 60, 10),
    align: ["left", "center", "right"].includes(col.align) ? col.align : "left",
  }));
}

function colShow(columns, id) {
  return Boolean(columns.find((c) => c.id === id)?.show);
}

function applyFlatAliases(src, next) {
  if (src.show_title !== undefined && src.title?.show === undefined) next.title.show = Boolean(src.show_title);
  if (src.title_text && src.title?.text === undefined) next.title.text = String(src.title_text);
  if (src.title_align && src.title?.align === undefined) next.title.align = src.title_align;
  if (src.title_pt != null && src.title?.font_pt === undefined) next.title.font_pt = Number(src.title_pt);
  if (src.show_invoice_no !== undefined && src.meta?.show_invoice_no === undefined) {
    next.meta.show_invoice_no = Boolean(src.show_invoice_no);
  }
  if (src.show_date !== undefined && src.meta?.show_date === undefined) next.meta.show_date = Boolean(src.show_date);
  if (src.font_pt != null && src.meta?.font_pt === undefined) next.meta.font_pt = Number(src.font_pt);

  if (src.show_gold_rate !== undefined && src.info?.show_gold_rate === undefined) next.info.show_gold_rate = Boolean(src.show_gold_rate);
  if (src.show_gstin !== undefined && src.info?.show_gstin === undefined) next.info.show_gstin = Boolean(src.show_gstin);
  if (src.show_customer !== undefined && src.info?.show_customer === undefined) next.info.show_customer = Boolean(src.show_customer);
  if (src.show_place_of_supply !== undefined && src.info?.show_place_of_supply === undefined) {
    next.info.show_place_of_supply = Boolean(src.show_place_of_supply);
  }

  const mapCol = { show_hsn: "hsn", show_purity: "purity", show_gross: "gross", show_net: "net", show_va: "va" };
  for (const [flat, id] of Object.entries(mapCol)) {
    if (src[flat] === undefined) continue;
    if (Array.isArray(src.items?.columns)) continue;
    next.items.columns = next.items.columns.map((c) => (c.id === id ? { ...c, show: Boolean(src[flat]) } : c));
  }

  if (src.show_payments !== undefined && src.payments?.show === undefined) next.payments.show = Boolean(src.show_payments);
  if (src.show_words !== undefined && src.words?.show === undefined) next.words.show = Boolean(src.show_words);
  if (src.show_signatures !== undefined && src.signatures?.show === undefined) next.signatures.show = Boolean(src.show_signatures);
  if (src.custom_note !== undefined && src.note?.text === undefined) next.note.text = String(src.custom_note ?? "");
  if (src.table_pt != null && src.items?.body_pt === undefined) {
    next.items.body_pt = Number(src.table_pt);
    next.items.header_pt = Math.max(6, Number(src.table_pt) - 0.5);
    next.items.footer_pt = Number(src.table_pt);
  }
}

export function mergeInvoiceLayout(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const next = {
    paper: "A5",
    page_w_in: clamp(src.page_w_in, 4.5, 8.5, DEFAULT_INVOICE_LAYOUT.page_w_in),
    page_h_in: clamp(src.page_h_in, 6, 12, DEFAULT_INVOICE_LAYOUT.page_h_in),
    header_in: clamp(src.header_in, 0.2, 3, DEFAULT_INVOICE_LAYOUT.header_in),
    footer_in: clamp(src.footer_in, 0.2, 3, DEFAULT_INVOICE_LAYOUT.footer_in),
    side_in: clamp(src.side_in, 0.02, 1.2, DEFAULT_INVOICE_LAYOUT.side_in),
    font_pt: clamp(src.font_pt, 5, 28, DEFAULT_INVOICE_LAYOUT.font_pt),
    title_pt: clamp(src.title_pt, 6, 32, DEFAULT_INVOICE_LAYOUT.title_pt),
    table_pt: clamp(src.table_pt, 5, 28, DEFAULT_INVOICE_LAYOUT.table_pt),
    line_h: clamp(src.line_h, 1, 2.2, DEFAULT_INVOICE_LAYOUT.line_h),
    show_lines: src.show_lines === undefined ? true : Boolean(src.show_lines),
    border_pt: clamp(src.border_pt, 0.4, 3, DEFAULT_INVOICE_LAYOUT.border_pt),
    section_order: Array.isArray(src.section_order)
      ? [
          ...src.section_order.filter((id) => SECTION_IDS.includes(id)),
          ...SECTION_IDS.filter((id) => !src.section_order.includes(id)),
        ]
      : [...SECTION_IDS],
    title: mergeBox(TITLE_DEFAULT, src.title),
    meta: mergeBox(META_DEFAULT, src.meta),
    info: mergeBox(INFO_DEFAULT, src.info),
    items: {
      ...mergeBox(ITEMS_DEFAULT, src.items),
      columns: mergeColumns(src.items?.columns),
    },
    breakdown: mergeBox(BREAKDOWN_DEFAULT, src.breakdown),
    net: mergeBox(NET_DEFAULT, src.net),
    payments: mergeBox(PAYMENTS_DEFAULT, src.payments),
    words: mergeBox(WORDS_DEFAULT, src.words),
    note: mergeBox(NOTE_DEFAULT, src.note),
    signatures: mergeBox(SIG_DEFAULT, src.signatures),
  };

  applyFlatAliases(src, next);

  next.title.align = ["center", "right"].includes(next.title.align) ? next.title.align : "left";
  next.meta.align = ["left", "center", "right"].includes(next.meta.align) ? next.meta.align : "right";
  next.info.left_width = clamp(next.info.left_width, 25, 75, 50);
  next.breakdown.width_pct = clamp(next.breakdown.width_pct, 30, 80, 48);
  next.breakdown.align = next.breakdown.align === "left" ? "left" : "right";
  next.signatures.line_w = clamp(next.signatures.line_w, 60, 220, 140);
  next.note.align = ["center", "right"].includes(next.note.align) ? next.note.align : "left";
  next.title.font_pt = clamp(next.title.font_pt, 6, 32, 11);
  next.meta.font_pt = clamp(next.meta.font_pt, 5, 28, 8);
  next.meta.invoice_font_pt = clamp(next.meta.invoice_font_pt, 5, 28, next.meta.font_pt);
  next.meta.date_font_pt = clamp(next.meta.date_font_pt, 5, 28, next.meta.font_pt);
  next.info.font_pt = clamp(next.info.font_pt, 5, 28, 7.5);
  next.info.gold_pt = clamp(next.info.gold_pt, 5, 28, next.info.font_pt);
  next.info.gstin_pt = clamp(next.info.gstin_pt, 5, 28, next.info.font_pt);
  next.info.customer_pt = clamp(next.info.customer_pt, 5, 28, next.info.font_pt);
  next.info.phone_pt = clamp(next.info.phone_pt, 5, 28, next.info.font_pt);
  next.info.place_pt = clamp(next.info.place_pt, 5, 28, next.info.font_pt);
  next.info.line_gap = clamp(next.info.line_gap, 0, 12, 1);
  next.items.header_pt = clamp(next.items.header_pt, 5, 28, 7);
  next.items.body_pt = clamp(next.items.body_pt, 5, 28, 7.5);
  next.items.footer_pt = clamp(next.items.footer_pt, 5, 28, 7.5);
  next.breakdown.font_pt = clamp(next.breakdown.font_pt, 5, 28, 7.5);
  next.net.font_pt = clamp(next.net.font_pt, 5, 28, 8);
  next.payments.font_pt = clamp(next.payments.font_pt, 5, 28, 7.5);
  next.words.font_pt = clamp(next.words.font_pt, 5, 28, 7);
  next.note.font_pt = clamp(next.note.font_pt, 5, 28, 7);
  next.signatures.font_pt = clamp(next.signatures.font_pt, 5, 28, 7.5);
  next.signatures.left_font_pt = clamp(next.signatures.left_font_pt, 5, 28, next.signatures.font_pt);
  next.signatures.right_font_pt = clamp(next.signatures.right_font_pt, 5, 28, next.signatures.font_pt);

  next.title_text = next.title.text;
  next.title_align = next.title.align;
  next.title_pt = next.title.font_pt;
  next.show_title = next.title.show;
  next.show_invoice_no = next.meta.show_invoice_no;
  next.show_date = next.meta.show_date;
  next.show_gold_rate = next.info.show_gold_rate;
  next.show_gstin = next.info.show_gstin;
  next.show_customer = next.info.show_customer;
  next.show_place_of_supply = next.info.show_place_of_supply;
  next.show_hsn = colShow(next.items.columns, "hsn");
  next.show_purity = colShow(next.items.columns, "purity");
  next.show_gross = colShow(next.items.columns, "gross");
  next.show_net = colShow(next.items.columns, "net");
  next.show_va = colShow(next.items.columns, "va");
  next.show_payments = next.payments.show;
  next.show_words = next.words.show;
  next.show_signatures = next.signatures.show;
  next.custom_note = next.note.text;
  next.table_pt = next.items.body_pt;

  return next;
}

export function setLayoutPath(layout, path, value) {
  const parts = String(path).split(".");
  const base = mergeInvoiceLayout(layout);
  if (parts[0] === "items" && parts[1] === "columns" && parts[2] && parts[3]) {
    const colId = parts[2];
    const key = parts[3];
    base.items = {
      ...base.items,
      columns: base.items.columns.map((c) => (c.id === colId ? { ...c, [key]: value } : c)),
    };
    return mergeInvoiceLayout(base);
  }
  if (parts.length === 1) {
    return mergeInvoiceLayout({ ...base, [parts[0]]: value });
  }
  if (parts.length === 2) {
    const [group, key] = parts;
    return mergeInvoiceLayout({
      ...base,
      [group]: { ...base[group], [key]: value },
    });
  }
  return mergeInvoiceLayout(base);
}

export function moveSection(layout, id, dir) {
  const next = mergeInvoiceLayout(layout);
  const order = [...next.section_order];
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return next;
  [order[i], order[j]] = [order[j], order[i]];
  return mergeInvoiceLayout({ ...next, section_order: order });
}

export function moveColumn(layout, id, dir) {
  const next = mergeInvoiceLayout(layout);
  const cols = [...next.items.columns];
  const i = cols.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return next;
  [cols[i], cols[j]] = [cols[j], cols[i]];
  return mergeInvoiceLayout({ ...next, items: { ...next.items, columns: cols } });
}

export const SAMPLE_INVOICE = {
  invoice_no: "INV-1/0041",
  created_at: new Date().toISOString(),
  gold_rate: 7200,
  gst_pct: 3,
  discount: 0,
  old_gold_value: 0,
  old_silver_value: 0,
  scheme_credit: 0,
  subtotal: 45280,
  cgst_amount: 679.2,
  sgst_amount: 679.2,
  gst_amount: 1358.4,
  grand_total: 46638.4,
  customer_name: "Walk-in Customer",
  customer_mobile: "9876543210",
  customer_address: "Anakapalle, Andhra Pradesh",
  payments: [{ mode: "cash", amount: 46638.4 }],
  items: [
    {
      quantity: 1,
      name: "Gold Necklace",
      category_name: "Necklaces",
      subcategory_name: "Plain",
      metal_name: "Gold",
      charged_rate: 7200,
      making_amount: 1500,
      wastage_amount: 500,
      hsn_code: "7113",
      purity: "22K",
      gross_weight: 8.24,
      net_weight: 8.1,
      stone_weight: 0.14,
      line_total: 22640,
    },
    {
      quantity: 2,
      name: "Gold Bangle",
      category_name: "Bangles",
      subcategory_name: "Plain",
      metal_name: "Gold",
      charged_rate: 7200,
      making_amount: 800,
      wastage_amount: 200,
      hsn_code: "7113",
      purity: "22K",
      gross_weight: 4.12,
      net_weight: 4.05,
      stone_weight: 0.07,
      line_total: 22640,
    },
  ],
};

let _cachedLayout = null;
let _loadPromise = null;

export function setCachedInvoiceLayout(layout) {
  _cachedLayout = mergeInvoiceLayout(layout);
}

export function getCachedInvoiceLayout() {
  return mergeInvoiceLayout(_cachedLayout || DEFAULT_INVOICE_LAYOUT);
}

export async function loadInvoiceLayout() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = import("@/lib/api").then(({ default: api }) =>
    api.get("/settings/invoice").then(({ data }) => {
      const merged = mergeInvoiceLayout(data?.print_layout);
      setCachedInvoiceLayout(merged);
      return merged;
    }).catch(() => getCachedInvoiceLayout())
  );
  try {
    return await _loadPromise;
  } finally {
    _loadPromise = null;
  }
}
