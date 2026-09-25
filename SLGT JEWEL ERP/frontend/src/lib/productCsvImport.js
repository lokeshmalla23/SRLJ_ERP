import api, { formatApiError } from "@/lib/api";
import { parseCsv, looksLikeSpreadsheet } from "@crm/domain/csv";

export const PRODUCT_IMPORT_BATCH_SIZE = 40;

export function csvEscape(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

/** Columns that round-trip between Inventory Export and CSV import. */
export const INVENTORY_CSV_COLUMNS = [
  { key: "name", label: "Product Name", value: (p) => p.name || p.subcategory_name || p.category_name || "" },
  { key: "code", label: "Code" },
  { key: "barcode", label: "Barcode" },
  { key: "design_no", label: "Design No" },
  { key: "category_name", label: "Category" },
  { key: "subcategory_name", label: "Sub Category" },
  { key: "metal_name", label: "Metal" },
  { key: "purity_name", label: "Purity" },
  { key: "hallmark", label: "Hallmark" },
  { key: "certification", label: "Certification" },
  { key: "hsn_code", label: "HSN Code" },
  { key: "gst_slab", label: "GST %" },
  { key: "gross_weight", label: "Gross Weight (g)" },
  { key: "net_weight", label: "Net Weight (g)" },
  { key: "stone_weight", label: "Stone Weight (g)" },
  { key: "making_charges", label: "Making Charges" },
  { key: "making_charge_type", label: "Making Charge Type" },
  { key: "wastage_pct", label: "Wastage %" },
  { key: "purchase_price", label: "Purchase Price" },
  { key: "selling_price", label: "Selling Price" },
  { key: "stock_qty", label: "Stock Qty" },
  { key: "low_stock_threshold", label: "Low Stock Threshold" },
  { key: "status", label: "Status" },
  { key: "showcase_location", label: "Showcase Location" },
];

function percentOf(processed, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((processed / total) * 100));
}

export function emptyImportProgress() {
  return {
    processed: 0,
    total: 0,
    percent: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    done: false,
  };
}

/**
 * Parse a products CSV (Inventory export or Settings template) and import it
 * in small batches so the UI can show live % progress and a timeout cannot
 * wipe a large restore.
 */
export async function importProductsFromCsv({ csvText, fileName, onProgress, updateExisting = true } = {}) {
  if (looksLikeSpreadsheet(fileName, csvText)) {
    throw new Error("Please upload a CSV file, not an Excel workbook (.xlsx). Use File → Save As → CSV.");
  }
  const { rows } = parseCsv(csvText);
  if (!rows.length) {
    throw new Error("No data rows found in the CSV.");
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  const total = rows.length;

  onProgress?.({
    processed: 0,
    total,
    percent: 0,
    created,
    updated,
    skipped,
    errors,
    done: false,
  });

  for (let i = 0; i < rows.length; i += PRODUCT_IMPORT_BATCH_SIZE) {
    const batch = rows.slice(i, i + PRODUCT_IMPORT_BATCH_SIZE);
    const { data } = await api.post(
      "/backup/import/products",
      { rows: batch, update_existing: updateExisting },
      { timeout: 180000 },
    );
    created += data.created || 0;
    updated += data.updated || 0;
    skipped += data.skipped || 0;
    if (Array.isArray(data.errors) && data.errors.length) {
      const offset = i; // row numbers in the batch are 2-based within the batch
      for (const er of data.errors) {
        errors.push({
          row: typeof er.row === "number" ? er.row + offset : er.row,
          detail: er.detail,
        });
      }
    }
    const processed = Math.min(i + batch.length, total);
    onProgress?.({
      processed,
      total,
      percent: percentOf(processed, total),
      created,
      updated,
      skipped,
      errors,
      done: false,
    });
  }

  const result = {
    processed: total,
    total,
    percent: 100,
    created,
    updated,
    skipped,
    errors,
    done: true,
    total_rows: total,
  };
  onProgress?.(result);
  return result;
}

export function formatImportSummary(result) {
  const parts = [];
  if (result.created) parts.push(`${result.created} added`);
  if (result.updated) parts.push(`${result.updated} updated`);
  if (result.skipped) parts.push(`${result.skipped} skipped`);
  return parts.length ? parts.join(", ") : "No rows imported";
}

export { formatApiError };
