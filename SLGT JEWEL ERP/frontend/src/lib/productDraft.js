/** Local draft for New Product form — keeps tag + field values across navigation. */

export const PRODUCT_NEW_DRAFT_KEY = "ssj_product_new_draft";

let allocateInflight = null;

export function loadProductDraft() {
  try {
    const raw = localStorage.getItem(PRODUCT_NEW_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.form) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveProductDraft(form) {
  try {
    const barcode = String(form?.barcode || form?.code || "").trim();
    localStorage.setItem(
      PRODUCT_NEW_DRAFT_KEY,
      JSON.stringify({
        form,
        barcode,
        updatedAt: new Date().toISOString(),
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function clearProductDraft() {
  try {
    localStorage.removeItem(PRODUCT_NEW_DRAFT_KEY);
  } catch {
    /* ignore */
  }
  allocateInflight = null;
}

/**
 * Restore existing draft, or allocate one barcode once (shared across Strict Mode remounts).
 * fetchBarcode: async () => string serial
 */
export async function ensureProductDraft(fetchBarcode) {
  const existing = loadProductDraft();
  if (existing?.form && String(existing.form.barcode || existing.barcode || "").trim()) {
    return { draft: existing, created: false };
  }
  if (allocateInflight) {
    const form = await allocateInflight;
    return { draft: { form, barcode: form.barcode }, created: true };
  }
  allocateInflight = (async () => {
    const serial = String((await fetchBarcode()) || "").trim();
    const seeded = {
      name: "",
      code: serial,
      barcode: serial,
      design_no: "",
      category_id: "",
      subcategory_id: "",
      collection_ids: [],
      tag_ids: [],
      metal_type_id: "",
      purity_id: "",
      stone_type_ids: [],
      stone_details: [],
      unit_id: "",
      attribute_values: {},
      gross_weight: 0,
      net_weight: 0,
      stone_weight: 0,
      making_charges: 0,
      making_charge_type: "per_gram",
      wastage_pct: 0,
      hallmark: "",
      certification: "",
      hsn_code: "7113",
      gst_slab: 3.0,
      selling_price: 0,
      stock_qty: 1,
      low_stock_threshold: 1,
      tray_total_weight: 0,
      description: "",
      status: "available",
      showcase_location: "",
      counter_id: "",
      size: "",
      purchase_date: "",
    };
    saveProductDraft(seeded);
    return seeded;
  })();
  try {
    const form = await allocateInflight;
    return { draft: { form, barcode: form.barcode }, created: true };
  } finally {
    allocateInflight = null;
  }
}

/** True when draft has more than just an empty shell / tag-only seed. */
export function draftHasUserInput(form) {
  if (!form) return false;
  const keys = [
    "name", "design_no", "category_id", "subcategory_id", "metal_type_id",
    "purity_id", "unit_id", "hallmark", "certification", "size", "counter_id",
    "description", "purchase_date",
  ];
  if (keys.some((k) => form[k] != null && String(form[k]).trim() !== "" && form[k] !== 0)) {
    return true;
  }
  if (Number(form.gross_weight) > 0 || Number(form.net_weight) > 0 || Number(form.stone_weight) > 0) {
    return true;
  }
  if (Number(form.making_charges) > 0 || Number(form.wastage_pct) > 0) {
    return true;
  }
  if (Array.isArray(form.stone_details) && form.stone_details.length > 0) return true;
  if (Array.isArray(form.collection_ids) && form.collection_ids.length > 0) return true;
  if (Array.isArray(form.tag_ids) && form.tag_ids.length > 0) return true;
  return false;
}
