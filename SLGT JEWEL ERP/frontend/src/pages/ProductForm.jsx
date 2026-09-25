import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save, Trash2, Sparkles, Plus, X, Printer, AlertTriangle, Check, FileDown, ArrowRight, Gem, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import useConfirm from "@/hooks/useConfirm";
import api, { formatApiError } from "@/lib/api";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import { asArray, asObject } from "@/lib/jsonFields";
import { fmtINR, fmtRatePerGram } from "@/lib/format";
import { calcLineAmounts } from "@/lib/billingCalc";
import { printHtml } from "@/lib/printHtml";
import JsBarcode from "jsbarcode";
import { makePinTagBarcodeUrl, generateStripTagPrintPayload, renderStripTagPng } from "@/lib/labelPrint";
import JewelleryTagPreview from "@/components/JewelleryTagPreview";
import StockAlertDialog from "@/components/StockAlertDialog";
import MoneyInput from "@/components/ui/MoneyInput";
import { roundWeight, sanitizeWeightDraft, formatWeight } from "@/lib/weightInput";
import { playStockAlertSound } from "@/lib/stockAlert";
import {
  saveProductDraft,
  clearProductDraft,
  draftHasUserInput,
  ensureProductDraft,
} from "@/lib/productDraft";

const EMPTY = {
  name: "",
  code: "",
  barcode: "",
  design_no: "",
  cal_code: "",
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
  purchase_price: 0,
  stock_qty: 1,
  low_stock_threshold: 1,
  tray_total_weight: 0,
  description: "",
  status: "available",
  showcase_location: "",
  counter_id: "",
  size: "",
  purchase_date: new Date().toISOString().slice(0, 10),
};

const FALLBACK_GOLD_RATE = 6800; // ₹/g, 24K — used only until live rate loads

// Presentation-only product workspace treatment.  This is intentionally kept
// at the page root so every existing form section, dialog and action retains
// its handlers, data-testids, fixed geometry and print helpers.
const TRADE_PAGE_CLASS = [
  "text-[#2F3A32]",
  "[&_.btn-primary]:rounded-[9px]",
  "[&_.btn-primary]:bg-[#244B39]",
  "[&_.btn-primary]:border-[#244B39]",
  "[&_.btn-primary]:hover:bg-[#1D3B2E]",
  "[&_.btn-primary]:focus-visible:ring-2",
  "[&_.btn-primary]:focus-visible:ring-[#B8CBB9]",
  "[&_.btn-secondary]:rounded-[9px]",
  "[&_.btn-secondary]:border-[#D3DDD1]",
  "[&_.btn-secondary]:text-[#2F4939]",
  "[&_.btn-secondary]:hover:border-[#AFC2AE]",
  "[&_.btn-secondary]:hover:bg-[#F1F4ED]",
  "[&_.btn-accent]:rounded-[9px]",
  "[&_.btn-accent]:bg-[#244B39]",
  "[&_.btn-accent]:border-[#244B39]",
  "[&_.btn-accent]:hover:bg-[#1D3B2E]",
  "[&_.input]:rounded-[9px]",
  "[&_.input]:border-[#C8D4C7]",
  "[&_.input]:focus:border-[#66806B]",
  "[&_.input]:focus:shadow-[0_0_0_3px_rgba(102,128,107,0.14)]",
  "[&_.card]:rounded-[10px]",
  "[&_.card]:border-[#DCE3D6]",
  "[&_.card]:bg-[#FFFDF8]",
  "[&_.card]:shadow-[0_1px_2px_rgba(35,58,43,0.04)]",
  "[&_.table-shell]:rounded-[10px]",
  "[&_.table-shell]:border-[#DCE3D6]",
  "[&_.table-shell]:shadow-[0_1px_2px_rgba(35,58,43,0.04)]",
  "[&_.table-head-row]:bg-[#F1F4ED]",
  "[&_.table-head-row]:border-[#DCE3D6]",
  "[&_.table-th]:text-[#607063]",
  "[&_.table-td]:border-[#E3E8E0]",
  "[&_.table-row:hover_.table-td]:bg-[#F7F9F4]",
  "[&_h2]:text-[#2F3A32]",
  "[&_h2+p]:text-[#6E786F]",
].join(" ");

const STONE_TYPE_PRESETS = ["Diamond", "Ruby", "Emerald", "Pearl", "Sapphire", "Tanzanite", "Amethyst", "Topaz", "Opal", "Aquamarine"];

// Mirrors Inventory.jsx's STATUS_META colors for the status chip on this page.
const DISPLAY_STATUS_META = {
  available: { label: "Available", chip: "bg-green-50 text-green-700 border-green-200" },
  on_display: { label: "On Display", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  reserved: { label: "Reserved", chip: "bg-blue-50 text-blue-700 border-blue-200" },
  estimation: { label: "Estimation", chip: "bg-blue-50 text-blue-700 border-blue-200" },
  damaged: { label: "Damaged", chip: "bg-red-50 text-red-700 border-red-200" },
  sold: { label: "Sold out", chip: "bg-[#F1F4ED] text-[#5F6D62] border-[#DCE3D6]" },
  discontinued: { label: "Discontinued", chip: "bg-[#F1F4ED] text-[#5F6D62] border-[#DCE3D6]" },
  deleted: { label: "Deleted", chip: "bg-[#F1F4ED] text-[#5F6D62] border-[#DCE3D6]" },
  deleted_p: { label: "Deleted P", chip: "bg-[#F1F4ED] text-[#5F6D62] border-[#DCE3D6]" },
};

const EMPTY_STONE_ROW = { stone_type: "", count: 1, total_carat: 0, price: 0 };

/** Prefer catalog rows that purities already link to; drop duplicate seed metals. */
function dedupeMetals(metals, purities) {
  const list = asArray(metals);
  const purs = asArray(purities);
  const linkedIds = new Set(
    purs.map((p) => asObject(p.meta).metal_type_id).filter(Boolean),
  );
  const byCode = new Map();
  for (const m of list) {
    const key = String(m.code || m.name || m.id).toUpperCase();
    const prev = byCode.get(key);
    if (!prev) {
      byCode.set(key, m);
      continue;
    }
    const prevLinked = linkedIds.has(prev.id);
    const nextLinked = linkedIds.has(m.id);
    if (nextLinked && !prevLinked) byCode.set(key, m);
  }
  return [...byCode.values()];
}

function purityMatchesMetal(purity, metal, allMetals) {
  const meta = asObject(purity.meta);
  const metalCode = String(metal?.code || "").toUpperCase();
  const siblingIds = new Set(
    asArray(allMetals)
      .filter((m) => String(m.code || "").toUpperCase() === metalCode)
      .map((m) => m.id),
  );
  if (metal?.id) siblingIds.add(metal.id);

  if (meta.metal_type_id) return siblingIds.has(meta.metal_type_id);

  // Seed purities often have empty meta — match by purity code family
  const pCode = String(purity.code || purity.name || "").toUpperCase();
  if (metalCode === "GOLD") return /^(24K|22K|18K|14K|10K)/.test(pCode);
  if (metalCode === "SILVER") return /^S\d|^925|^999|^958/.test(pCode) || pCode.includes("SILVER");
  if (metalCode === "PLATINUM") return /^PT/.test(pCode) || pCode.includes("PLAT");
  if (metalCode === "DIAMOND") return false;
  return !meta.metal_type_id;
}

function puritiesForMetal(purities, metalId, metals) {
  const all = asArray(purities);
  if (!metalId) return dedupeByCode(all);
  const metal = asArray(metals).find((m) => m.id === metalId);
  const matched = all.filter((p) => purityMatchesMetal(p, metal, metals));
  return dedupeByCode(matched.length ? matched : all);
}

function dedupeByCode(items) {
  const byCode = new Map();
  for (const item of asArray(items)) {
    const key = String(item.code || item.name || item.id).toUpperCase();
    const prev = byCode.get(key);
    if (!prev) {
      byCode.set(key, item);
      continue;
    }
    const prevLinked = Boolean(asObject(prev.meta).metal_type_id);
    const nextLinked = Boolean(asObject(item.meta).metal_type_id);
    // Prefer linked meta, else prefer longer descriptive name
    if (nextLinked && !prevLinked) byCode.set(key, item);
    else if (!prevLinked && !nextLinked && String(item.name || "").length > String(prev.name || "").length) {
      byCode.set(key, item);
    }
  }
  return [...byCode.values()];
}

/** Top-level categories: one per name (prefer code_prefix / more children). */
function dedupeTopCategories(categories) {
  const all = asArray(categories).filter((x) => !x.deleted_at);
  const childrenCount = new Map();
  for (const c of all) {
    if (c.parent_id) {
      childrenCount.set(c.parent_id, (childrenCount.get(c.parent_id) || 0) + 1);
    }
  }
  const byName = new Map();
  for (const c of all.filter((x) => !x.parent_id)) {
    const key = String(c.name || "").trim().toUpperCase().replace(/\s+/g, " ");
    if (!key) continue;
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, c);
      continue;
    }
    const score = (x) =>
      (x.code_prefix ? 100 : 0) + (childrenCount.get(x.id) || 0);
    if (score(c) > score(prev)) byName.set(key, c);
  }
  return [...byName.values()].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || "")),
  );
}

// Grams ↔ carats: 1 carat = 0.2 grams (i.e. 1 gram = 5 carats)
const GRAMS_PER_CARAT = 0.2;

// Hides the browser's native up/down spinner buttons — manual entry only.
const NO_SPINNER = "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none";

// ── Generate barcode as SVG data URL (mirrors BarcodeManager approach) ────────
function makeBarcodeDataUrl(code) {
  try {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    JsBarcode(svg, String(code), {
      format: "CODE128", width: 1.5, height: 35,
      displayValue: true, fontSize: 9, margin: 2,
      background: "#ffffff", lineColor: "#000000",
    });
    const str = new XMLSerializer().serializeToString(svg);
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
  } catch {
    return null;
  }
}


// ── Print a single product's 80×12mm strip label to the label printer ─────────
async function printBarcodeTag(product, shopName) {
  const code = product.barcode || product.code || product.id;
  if (!code) return { ok: false };
  const barcodeUrl = makePinTagBarcodeUrl(String(code));
  const items = [{ product, barcodeUrl, qty: 1 }];
  const { html, rawTspl, rawTsplBase64 } = await generateStripTagPrintPayload(items, shopName);
  return printHtml(html, { printerType: "label", rawTspl, rawTsplBase64 });
}

async function downloadLabelPdf(product, shopName) {
  const { loadBarcodeLayout } = await import("@/lib/barcodeLayout");
  const layout = await loadBarcodeLayout();
  const png = renderStripTagPng(product, shopName, { showGuides: false, scale: 3, layout });
  if (!png) throw new Error("Could not render label");
  const { jsPDF } = await import("jspdf");
  const w = layout.tag_w_mm || 80;
  const h = layout.tag_h_mm || 12;
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [w, h] });
  doc.addImage(png, "PNG", 0, 0, w, h);
  const tag = product.barcode || product.code || "label";
  doc.save(`label-${tag}.pdf`);
}

function estimateCreatedProductPrice(product, goldRate, allRates = {}) {
  const unitCode = String(product.unit_code || "").toLowerCase();
  if (unitCode === "pc") {
    const total = Number(product.selling_price) || 0;
    return { mode: "piece", total, goldValue: 0, wastage: 0, making: 0, stonePrice: 0, effectiveRate: 0, purityKey: "" };
  }

  const stonePrice = asArray(product.stone_details).reduce((s, r) => s + (Number(r.price) || 0), 0);
  const item = {
    gross_weight: product.gross_weight,
    net_weight: product.net_weight,
    purity: product.purity_name,
    purity_code: product.purity_code,
    metal: product.metal_name,
    making_charges: product.making_charges,
    making_charge_type: product.making_charge_type,
    wastage_pct: product.wastage_pct,
    stone_charges: stonePrice,
    quantity: 1,
  };
  const amounts = calcLineAmounts(item, goldRate, allRates);
  return {
    mode: "weight",
    total: amounts.line_total,
    goldValue: amounts.gold_value,
    wastage: amounts.wastage_amount,
    making: amounts.making_amount,
    stonePrice: amounts.stone_charges,
    effectiveRate: amounts.charged_rate,
    purityKey: product.purity_name || "",
  };
}

function OverviewRow({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5">
      <span className="text-[12.5px] text-[#6E786F]">{label}</span>
      <span className={`text-[12.5px] text-[#2F3A32] text-right ${mono ? "font-mono tabular-nums" : "font-medium"}`}>
        {value ?? "—"}
      </span>
    </div>
  );
}

/** Right-side pre-save overview — product is persisted only after Save product in the bottom bar. */
function CreateReviewPanel({ product, price, tagNo }) {
  const purityLabel = product.purity_name || null;
  const metalLabel = product.metal_name || null;
  const unitLabel = product.unit_name
    ? (product.unit_code ? `${product.unit_name} (${product.unit_code})` : product.unit_name)
    : (product.unit_code || null);

  return (
    <div className="bg-[#FFFDF8] rounded-[12px] border border-[#DCE3D6] shadow-[0_12px_30px_rgba(35,58,43,0.10)] overflow-hidden">
      <div className="px-4 py-4 border-b border-[#E3E8E0] bg-[#FDFBF7]">
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#B49042]">Review before save</div>
        <div className="text-[15px] font-semibold text-[#2F3A32] mt-1 leading-snug">
          Confirm product overview
        </div>
        <div className="flex items-end justify-between gap-2 mt-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[#2F3A32] truncate">{product.name || "Product"}</div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {purityLabel && (
                <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#DCFCE7] text-[#166534]">{purityLabel}</span>
              )}
              {metalLabel && (
                <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#FEF3C7] text-[#92400E]">{metalLabel}</span>
              )}
              {unitLabel && (
                <span className="inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-[#DBEAFE] text-[#1E40AF]">{unitLabel}</span>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[9px] uppercase tracking-[0.12em] font-semibold text-[#8D998F]">Tag No</div>
            <div className="text-[18px] font-bold font-mono text-[#2F3A32] tabular-nums leading-tight">#{tagNo || "—"}</div>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3 max-h-[min(70vh,640px)] overflow-y-auto">
        <div className="rounded-[10px] border border-[#DCE3D6] bg-[#F7F8F2] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#B49042] mb-1.5">Product overview</div>
          <OverviewRow label="Category" value={product.category_name} />
          <OverviewRow label="Sub-category" value={product.subcategory_name} />
          <OverviewRow label="Category Counter" value={product.counter_name} />
          <OverviewRow label="Hallmark" value={product.hallmark || null} mono />
          <OverviewRow label="Size" value={product.size || null} />
          <OverviewRow label="Stock" value={`${Number(product.stock_qty) || 0} pc`} mono />
          {(Number(product.gross_weight) > 0 || Number(product.net_weight) > 0) && (
            <>
              <div className="border-t border-[#DCE3D6] my-1.5" />
              <OverviewRow label="Gross wt" value={`${Number(product.gross_weight || 0).toFixed(3)} g`} mono />
              <OverviewRow label="Net wt" value={`${Number(product.net_weight || 0).toFixed(3)} g`} mono />
              <OverviewRow label="Stone wt" value={`${Number(product.stone_weight || 0).toFixed(3)} g`} mono />
            </>
          )}
        </div>

        <div className="rounded-[10px] border border-[#EADFBF] bg-[#FDFBF7] px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#B49042] mb-1.5">
            {price.mode === "piece" ? "Price summary" : "Estimated price"}
          </div>
          {price.mode === "piece" ? (
            <OverviewRow label="Selling price" value={fmtINR(price.total)} mono />
          ) : (
            <>
              <div className="text-[11px] text-[#6E786F] mb-1.5">
                Rate {fmtRatePerGram(price.effectiveRate || 0)}
                {price.purityKey ? ` · ${price.purityKey.toUpperCase()}` : ""}
              </div>
              <OverviewRow label="Metal value" value={fmtINR(price.goldValue)} mono />
              <OverviewRow label={`Wastage (${Number(product.wastage_pct) || 0}%)`} value={fmtINR(price.wastage)} mono />
              <OverviewRow label="Making" value={fmtINR(price.making)} mono />
              {price.stonePrice > 0 && (
                <OverviewRow label="Stone" value={fmtINR(price.stonePrice)} mono />
              )}
            </>
          )}
          <div className="border-t border-[#E8D5A8] mt-2 pt-2 flex justify-between items-center">
            <span className="text-[12.5px] font-semibold text-[#2F3A32]">
              {price.mode === "piece" ? "Total" : "Est. total"}
            </span>
            <span className="text-[16px] font-bold font-mono text-[#B49042] tabular-nums">
              {fmtINR(price.total)}
            </span>
          </div>
          {price.mode !== "piece" && (
            <p className="text-[10.5px] text-[#8D998F] mt-1.5 leading-relaxed">
              Final bill uses live gold rate at POS.
            </p>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-t border-[#E3E8E0] bg-[#FFFDF8]">
        <p className="text-[11.5px] text-[#6E786F] text-center leading-relaxed">
          Use <span className="font-semibold text-[#2F3A32]">Save product</span> in the bottom bar to confirm.
        </p>
      </div>
    </div>
  );
}

function SavedProductPanel({ product, shopName, onInventory, onAddAnother, goldRate, allRates }) {
  const [printState, setPrintState] = useState("idle"); // idle | printing | done | error | no_printer
  const [pdfBusy, setPdfBusy] = useState(false);
  const printedOnce = useRef(false);

  const tagNo = product.barcode || product.code || "—";
  const purityLabel = product.purity_name || null;
  const metalLabel = product.metal_name || null;
  const unitLabel = product.unit_name
    ? (product.unit_code ? `${product.unit_name} (${product.unit_code})` : product.unit_name)
    : (product.unit_code || null);

  const price = useMemo(
    () => estimateCreatedProductPrice(product, goldRate || FALLBACK_GOLD_RATE, allRates || {}),
    [product, goldRate, allRates],
  );

  useEffect(() => {
    if (printedOnce.current) return;
    printedOnce.current = true;
    setPrintState("printing");
    printBarcodeTag(product, shopName)
      .then((r) => {
        if (r && r.ok === false) setPrintState(r.cancelled ? "idle" : "error");
        else setPrintState("done");
      })
      .catch((err) => {
        if (err?.printerNotConnected) {
          setPrintState("no_printer");
        } else {
          setPrintState("error");
          /* printHtml already showed toast */
        }
      });
  }, [product, shopName]);

  const handlePrint = () => {
    setPrintState("printing");
    printBarcodeTag(product, shopName)
      .then((r) => {
        if (r && r.ok === false) setPrintState(r.cancelled ? "idle" : "no_printer");
        else setPrintState("done");
      })
      .catch((err) => {
        if (err?.printerNotConnected) setPrintState("no_printer");
        else setPrintState("error");
      });
  };

  const handleDownloadPdf = async () => {
    setPdfBusy(true);
    try {
      await downloadLabelPdf(product, shopName);
      toast.success("Label PDF downloaded");
    } catch (err) {
      toast.error(err?.message || "PDF download failed");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className={`${TRADE_PAGE_CLASS} max-w-[720px] mx-auto mt-6 mb-16 px-4`}>
      <div className="bg-[#FFFDF8] rounded-[12px] border border-[#DCE3D6] shadow-[0_12px_30px_rgba(35,58,43,0.10)] overflow-hidden">
        {/* Success banner */}
        <div className="px-6 py-5 border-b border-[#E3E8E0] bg-[#F1F4ED] flex items-start gap-4">
          <div className="w-11 h-11 rounded-full bg-[#16A34A] flex items-center justify-center shrink-0 shadow-[0_4px_14px_rgba(22,163,74,0.3)]">
            <Check size={22} strokeWidth={2.5} className="text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-semibold text-[#2F3A32] tracking-tight">Product created</div>
            <div className="text-[13px] text-[#6E786F] mt-0.5">Added to inventory — review the overview below.</div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#8D998F]">Tag No</div>
            <div className="text-[22px] font-bold font-mono text-[#2F3A32] tabular-nums leading-tight">#{tagNo}</div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          {/* Identity */}
          <div className="flex items-start gap-3">
            <div className="w-12 h-12 rounded-[10px] bg-[#FDFBF7] flex items-center justify-center shrink-0 border border-[#EADFBF]">
              <Gem size={20} strokeWidth={1.5} className="text-[#8B6914]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[16px] font-semibold text-[#2F3A32]">{product.name || "Product"}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {purityLabel && (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#DCFCE7] text-[#166534]">{purityLabel}</span>
                )}
                {metalLabel && (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#FEF3C7] text-[#92400E]">{metalLabel}</span>
                )}
                {unitLabel && (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#DBEAFE] text-[#1E40AF]">{unitLabel}</span>
                )}
                {product.subcategory_name ? (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F1F4ED] text-[#5F6D62]">{product.subcategory_name}</span>
                ) : product.category_name ? (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#F1F4ED] text-[#5F6D62]">{product.category_name}</span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Details */}
            <div className="rounded-xl border border-[#DCE3D6] bg-[#F7F8F2] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#B49042] mb-2">Product overview</div>
              <OverviewRow label="Category" value={product.category_name} />
              <OverviewRow label="Sub-category" value={product.subcategory_name} />
              <OverviewRow label="Category Counter" value={product.counter_name} />
              <OverviewRow label="Hallmark" value={product.hallmark} mono />
              <OverviewRow label="Size" value={product.size} />
              <OverviewRow label="Stock" value={`${Number(product.stock_qty) || 0} pc`} mono />
              {(Number(product.gross_weight) > 0 || Number(product.net_weight) > 0) && (
                <>
                  <div className="border-t border-[#DCE3D6] my-2" />
                  <OverviewRow label="Gross wt" value={`${Number(product.gross_weight || 0).toFixed(3)} g`} mono />
                  <OverviewRow label="Net wt" value={`${Number(product.net_weight || 0).toFixed(3)} g`} mono />
                  <OverviewRow label="Stone wt" value={`${Number(product.stone_weight || 0).toFixed(3)} g`} mono />
                </>
              )}
            </div>

            {/* Price summary */}
            <div className="rounded-[10px] border border-[#EADFBF] bg-[#FDFBF7] px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-[#B49042] mb-2">
                {price.mode === "piece" ? "Price summary" : "Estimated price summary"}
              </div>
              {price.mode === "piece" ? (
                <OverviewRow label="Selling price" value={fmtINR(price.total)} mono />
              ) : (
                <>
                  <div className="text-[11px] text-[#6E786F] mb-2">
                    Rate {fmtRatePerGram(price.effectiveRate || 0)}
                    {price.purityKey ? ` · ${price.purityKey.toUpperCase()}` : ""}
                  </div>
                  <OverviewRow label="Metal value" value={fmtINR(price.goldValue)} mono />
                  <OverviewRow label={`Wastage (${Number(product.wastage_pct) || 0}%)`} value={fmtINR(price.wastage)} mono />
                  <OverviewRow label="Making" value={fmtINR(price.making)} mono />
                  {price.stonePrice > 0 && (
                    <OverviewRow label="Stone" value={fmtINR(price.stonePrice)} mono />
                  )}
                  <div className="border-t border-[#E8D5A8] mt-2 pt-2 flex justify-between items-center">
                    <span className="text-[13px] font-semibold text-[#2F3A32]">Estimated total</span>
                    <span className="text-[18px] font-bold font-mono text-[#B49042] tabular-nums">
                      {fmtINR(price.total)}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#8D998F] mt-2 leading-relaxed">
                    Final bill uses live gold rate at POS.
                  </p>
                </>
              )}
              {price.mode === "piece" && (
                <div className="border-t border-[#E8D5A8] mt-2 pt-2 flex justify-between items-center">
                  <span className="text-[13px] font-semibold text-[#2F3A32]">Total</span>
                  <span className="text-[18px] font-bold font-mono text-[#B49042] tabular-nums">
                    {fmtINR(price.total)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Compact label + print status */}
          <div className="rounded-[10px] border border-[#DCE3D6] bg-[#F7F8F2] p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] uppercase tracking-[0.09em] font-semibold text-[#8D998F]">Label</div>
              {printState === "printing" && (
                <span className="text-[11px] text-[#6E786F] flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 border-2 border-[#8D998F] border-t-transparent rounded-full animate-spin" />
                  Printing…
                </span>
              )}
              {printState === "done" && <span className="text-[11px] text-[#16A34A] font-medium">Printed</span>}
              {printState === "no_printer" && <span className="text-[11px] text-amber-700">Printer not connected</span>}
            </div>
            <JewelleryTagPreview product={product} shopName={shopName} className="w-full" />
          </div>

          {printState === "no_printer" && (
            <div className="border border-[#EADFBF] bg-[#FDFBF7] rounded-[9px] px-4 py-3 text-[11.5px] text-[#8A6D2F]">
              Connect your label printer in Settings → Printers & Devices, then tap Print Label.
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              className="btn-secondary flex-1 justify-center text-[13px] py-2.5"
              onClick={handlePrint}
              disabled={printState === "printing"}
            >
              <Printer size={14} strokeWidth={1.5} />
              Print Label
            </button>
            <button
              type="button"
              className="btn-secondary flex-1 justify-center text-[13px] py-2.5"
              onClick={handleDownloadPdf}
              disabled={pdfBusy}
            >
              <FileDown size={14} strokeWidth={1.5} />
              {pdfBusy ? "Preparing…" : "Download PDF"}
            </button>
            <button
              type="button"
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-[9px] bg-[#244B39] hover:bg-[#1D3B2E] text-white text-[13px] font-semibold py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors"
              onClick={onInventory}
            >
              Go to Inventory
              <ArrowRight size={15} strokeWidth={2} />
            </button>
          </div>

          <div className="text-center">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#244B39] hover:text-[#1D3B2E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
              onClick={onAddAnother}
            >
              Add another product
              <Plus size={14} strokeWidth={2} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Editing an existing product asks before printing (a new product's own
// SavedProductPanel still auto-prints — see submit() below) ──
function UpdatedBarcodeModal({ product, shopName, onClose }) {
  const [printState, setPrintState] = useState("confirm"); // confirm | printing | done | error | no_printer | skipped

  const doPrint = () => {
    setPrintState("printing");
    printBarcodeTag(product, shopName)
      .then((r) => {
        if (r && r.ok === false) setPrintState(r.cancelled ? "idle" : "no_printer");
        else setPrintState("done");
      })
      .catch((err) => {
        if (err?.printerNotConnected) setPrintState("no_printer");
        else setPrintState("error");
      });
  };

  const handlePrintAgain = () => doPrint();

  return (
    <div className="fixed inset-0 z-50 bg-[#20352A]/35 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#FFFDF8] rounded-[14px] border border-[#DCE3D6] shadow-[0_18px_50px_rgba(35,58,43,0.18)] w-full max-w-[460px] flex flex-col items-center gap-5 py-8 px-6 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col items-center gap-2">
          <div className="w-11 h-11 rounded-full bg-[#F0FDF4] flex items-center justify-center">
            <Printer size={20} strokeWidth={1.5} className="text-[#16A34A]" />
          </div>
          <div className="text-[15px] font-semibold text-[#2F3A32]">Product Updated</div>
          {printState === "confirm" && (
            <div className="text-[12px] text-[#6E786F]">Print the updated barcode label?</div>
          )}
          {printState === "printing" && (
            <div className="text-[12px] text-[#6E786F] flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 border-2 border-[#8D998F] border-t-transparent rounded-full animate-spin" />
              Sending label to printer…
            </div>
          )}
          {printState === "done" && <div className="text-[12px] text-[#16A34A]">Printed successfully</div>}
          {printState === "no_printer" && <div className="text-[12px] text-amber-700">Label printer not connected</div>}
          {printState === "error" && <div className="text-[12px] text-red-600">Print failed</div>}
          {printState === "skipped" && <div className="text-[12px] text-[#6E786F]">Label not printed</div>}
        </div>

        <div className="w-full flex flex-col items-center gap-2">
          <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F]">Label Preview</div>
          <JewelleryTagPreview product={product} shopName={shopName} className="w-full max-w-[440px]" />
        </div>

        {printState === "no_printer" && (
          <div className="w-full border border-[#EADFBF] bg-[#FDFBF7] rounded-[9px] px-4 py-3 text-left text-[11.5px] text-[#8A6D2F]">
            Connect your TSC TE244 and assign it in Settings → Printers &amp; Devices, then retry.
          </div>
        )}

        {printState === "confirm" ? (
          <div className="flex flex-col gap-2 w-full">
            <button className="btn-primary w-full justify-center" onClick={doPrint}>
              <Printer size={13} strokeWidth={1.5} /> Print Label
            </button>
            <button className="btn-secondary w-full justify-center" onClick={() => setPrintState("skipped")}>
              Don't Print
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 w-full">
            <button className="btn-secondary w-full justify-center" onClick={handlePrintAgain} disabled={printState === "printing"}>
              <Printer size={13} strokeWidth={1.5} />
              {printState === "no_printer" || printState === "error"
                ? "Retry Print"
                : printState === "skipped"
                  ? "Print Label"
                  : "Print Again"}
            </button>
            <button className="btn-primary w-full justify-center" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useAuth();
  const editing = Boolean(id);
  const [form, setForm] = useState(EMPTY);
  const [catalog, setCatalog] = useState({
    categories: [],
    metals: [],
    purities: [],
    stones: [],
    units: [],
    collections: [],
    tags: [],
  });
  const [attributes, setAttributes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [savedProduct, setSavedProduct] = useState(null);
  const [updatedPreview, setUpdatedPreview] = useState(null);
  const [statusHistory, setStatusHistory] = useState([]);
  const [goldRate, setGoldRate] = useState(FALLBACK_GOLD_RATE);
  const [allRates, setAllRates] = useState({});
  // Feature 3: track whether making/wastage fields were auto-filled from category
  const [categoryDefaults, setCategoryDefaults] = useState(false);
  // Feature 4: shop name for barcode tag
  const [shopName, setShopName] = useState("Sri Srinivasa Jewellers");
  const [counters, setCounters] = useState([]);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [displayBusy, setDisplayBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [barcodeAlert, setBarcodeAlert] = useState(null);
  // Settings → Application Management → Profit & Loss: shows a mandatory Purchase Price field.
  const [profitLossEnabled, setProfitLossEnabled] = useState(false);
  // Settings → Application Management → Cal Code: shows an optional Cal Code field.
  const [calCodeEnabled, setCalCodeEnabled] = useState(false);
  const [confirm, confirmModal] = useConfirm();
  const draftReadyRef = useRef(false);

  // load live gold rate + shop name
  useEffect(() => {
    api.get("/settings/gold-rate").then(({ data }) => {
      if (data?.gold_24k) setGoldRate(Number(data.gold_24k));
      setAllRates({
        "24K": Number(data?.gold_24k) || 0,
        "22K": Number(data?.gold_22k) || 0,
        "18K": Number(data?.gold_18k) || 0,
        "Silver": Number(data?.silver) || 0,
        "PureSilver": Number(data?.pure_silver) || 0,
        "PT950": Number(data?.platinum) || 0,
      });
    }).catch(() => {});
    // Fetch shop name for barcode tag (best-effort)
    api.get("/settings").then(({ data }) => {
      const arr = Array.isArray(data) ? data : [];
      const co = arr.find((e) => e.key === "company");
      if (co?.value?.name) setShopName(co.value.name);
    }).catch(() => {});
    api.get("/settings/counters").then(({ data }) => {
      setCounters(Array.isArray(data?.data) ? data.data : []);
    }).catch(() => {});
    api.get("/settings/profit-loss").then(({ data }) => {
      setProfitLossEnabled(data?.enabled === true);
    }).catch(() => {});
    api.get("/settings/cal-code").then(({ data }) => {
      setCalCodeEnabled(data?.enabled === true);
    }).catch(() => {});
  }, []);

  // load catalog
  useEffect(() => {
    Promise.all([
      api.get("/categories"),
      api.get("/catalog/metal-types"),
      api.get("/catalog/purities"),
      api.get("/catalog/stone-types"),
      api.get("/catalog/units"),
      api.get("/catalog/collections"),
      api.get("/catalog/tags"),
    ])
      .then(([cats, metals, purs, stones, units, colls, tags]) => {
        const purities = dedupeByCode(purs.data);
        const metalList = dedupeMetals(metals.data, purities);
        setCatalog({
          categories: asArray(cats.data),
          metals: metalList,
          purities,
          stones: dedupeByCode(stones.data),
          units: dedupeByCode(units.data),
          collections: dedupeByCode(colls.data),
          tags: dedupeByCode(tags.data),
        });
      })
      .catch((err) => {
        toast.error(formatApiError(err) || "Failed to load catalog (metals / purities)");
      });
  }, []);

  // New products: restore local draft (same tag + fields) or allocate barcode once.
  useEffect(() => {
    let cancelled = false;
    if (!editing) {
      ensureProductDraft(async () => {
        const { data } = await api.get("/products/next-barcode");
        return data?.barcode || "";
      })
        .then(({ draft }) => {
          if (cancelled || !draft?.form) return;
          const f = draft.form;
          setForm({
            ...EMPTY,
            ...f,
            stone_details: asArray(f.stone_details),
            collection_ids: asArray(f.collection_ids),
            tag_ids: asArray(f.tag_ids),
            stone_type_ids: asArray(f.stone_type_ids),
            attribute_values: asObject(f.attribute_values),
            barcode: f.barcode || draft.barcode || "",
            code: f.code || f.barcode || draft.barcode || "",
          });
          setRestoredDraft(draftHasUserInput(f));
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) {
            draftReadyRef.current = true;
            setLoading(false);
          }
        });
      return () => { cancelled = true; };
    }
    draftReadyRef.current = false;
    api.get(`/products/${id}`)
      .then(({ data }) => {
        setForm({
          ...EMPTY,
          ...data,
          stone_details: asArray(data.stone_details),
          collection_ids: asArray(data.collection_ids),
          tag_ids: asArray(data.tag_ids),
          stone_type_ids: asArray(data.stone_type_ids),
          attribute_values: asObject(data.attribute_values),
          gross_weight: hydrateWeight(data.gross_weight),
          net_weight: hydrateWeight(data.net_weight),
          stone_weight: hydrateWeight(data.stone_weight),
          tray_total_weight: hydrateWeight(data.tray_total_weight),
          piece_weight: hydrateWeight(data.piece_weight),
        });
        api.get(`/masters/products/${id}/status-history`)
          .then(({ data: h }) => setStatusHistory(h?.data || []))
          .catch(() => setStatusHistory([]));
      })
      .catch(() => toast.error("Failed to load product"))
      .finally(() => setLoading(false));
    return undefined;
  }, [id, editing]);

  // Autosave new-product draft so leaving the page keeps data + tag.
  useEffect(() => {
    if (editing || loading || savedProduct || !draftReadyRef.current) return undefined;
    const handle = setTimeout(() => {
      if (form.barcode || form.code) saveProductDraft(form);
    }, 900);
    return () => clearTimeout(handle);
  }, [form, editing, loading, savedProduct]);

  // Only show categories tagged for the selected metal (or untagged/generic ones).
  const topCategories = useMemo(() => {
    const all = dedupeTopCategories(catalog.categories);
    if (!form.metal_type_id) return all;
    return all.filter((c) => !c.default_metal_type_id || c.default_metal_type_id === form.metal_type_id);
  }, [catalog.categories, form.metal_type_id]);
  const subcategories = useMemo(() => {
    const all = asArray(catalog.categories);
    const kids = all.filter((c) => c.parent_id === form.category_id && !c.deleted_at);
    // Dedupe subcategory names under the selected parent
    const byName = new Map();
    for (const c of kids) {
      const key = String(c.name || "").trim().toUpperCase();
      if (!byName.has(key)) byName.set(key, c);
    }
    return [...byName.values()];
  }, [catalog.categories, form.category_id]);

  // load attributes based on category/subcategory
  useEffect(() => {
    if (!form.category_id) {
      setAttributes([]);
      return;
    }
    const params = { category_id: form.category_id };
    if (form.subcategory_id) params.subcategory_id = form.subcategory_id;
    api.get("/attributes/for-product", { params }).then(({ data }) => setAttributes(data));
  }, [form.category_id, form.subcategory_id]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setAttr = (code, v) => set("attribute_values", { ...asObject(form.attribute_values), [code]: v });

  // When category is picked, auto-fill making/wastage defaults + counter from category.
  // Tag stays as the plain serial from next-barcode (never RNG-/DIA- prefixes).
  const handleCategoryChange = (catId) => {
    const cat = catalog.categories.find((c) => c.id === catId);
    const hasDefaults = cat && (cat.default_wastage_pct != null || cat.default_making_charge != null);
    setForm((f) => {
      const metal = catalog.metals.find((m) => m.id === f.metal_type_id);
      // Temporary until a sub-category is chosen — prefer sub-category name when set.
      const autoName = [metal?.name, cat?.name].filter(Boolean).join(" ");
      return {
        ...f,
        category_id: catId,
        subcategory_id: "",
        name: autoName || f.name,
        counter_id: cat?.counter_id || "",
        ...(hasDefaults && cat.default_wastage_pct != null ? { wastage_pct: cat.default_wastage_pct } : {}),
        ...(hasDefaults && cat.default_making_charge != null ? { making_charges: cat.default_making_charge } : {}),
        ...(hasDefaults && cat.default_making_charge_type ? { making_charge_type: cat.default_making_charge_type } : {}),
      };
    });
    setCategoryDefaults(Boolean(hasDefaults));
  };

  // Sub-category defaults take precedence over the parent category's — a
  // sub-category (e.g. "Chains" under "Gold") is the more specific choice.
  const handleSubcategoryChange = (subId) => {
    const sub = catalog.categories.find((c) => c.id === subId);
    const parent = catalog.categories.find((c) => c.id === form.category_id);
    const hasDefaults = sub && (sub.default_wastage_pct != null || sub.default_making_charge != null);
    setForm((f) => {
      const metal = catalog.metals.find((m) => m.id === f.metal_type_id);
      const parentName = parent?.name || "";
      // "Still auto" must recognize the name generated from whichever
      // sub-category was previously picked, not just the bare category —
      // otherwise re-picking a different sub-category later (e.g. correcting
      // "Bracelet Gents" to "Bracelet Girls") sees the name as manually
      // edited and freezes it, leaving the old sub-category's name behind.
      const prevSub = catalog.categories.find((c) => c.id === f.subcategory_id);
      const prevAutoBare = [metal?.name, parentName].filter(Boolean).join(" ");
      const prevAutoSub = [metal?.name, prevSub?.name].filter(Boolean).join(" ");
      // Prefer sub-category in the display name (e.g. "Gold Plain" not "Gold Rings").
      const nextAuto = [metal?.name, sub?.name].filter(Boolean).join(" ");
      const nameStillAuto = !f.name || f.name === prevAutoBare || f.name === prevAutoSub || f.name === nextAuto;
      return {
        ...f,
        subcategory_id: subId,
        name: nameStillAuto && nextAuto ? nextAuto : f.name,
        counter_id: sub?.counter_id || parent?.counter_id || f.counter_id || "",
        ...(hasDefaults && sub.default_wastage_pct != null ? { wastage_pct: sub.default_wastage_pct } : {}),
        ...(hasDefaults && sub.default_making_charge != null ? { making_charges: sub.default_making_charge } : {}),
        ...(hasDefaults && sub.default_making_charge_type ? { making_charge_type: sub.default_making_charge_type } : {}),
      };
    });
    if (hasDefaults) setCategoryDefaults(true);
  };

  // Unit drives which sections are shown, and nothing shows until a unit is
  // picked: "Piece" → Price & Stock, "Tray" → Tray Stock, anything else
  // (Gram, Pair, Set, ...) → Weight/Stone/Making (weight-priced).
  const selectedUnit = catalog.units.find((u) => u.id === form.unit_id);
  const isPieceUnit = selectedUnit?.code === "pc";
  const isTrayUnit = selectedUnit?.code === "tray";
  const isWeightUnit = !!selectedUnit && !isPieceUnit && !isTrayUnit;

  // Stone type suggestions — catalog-managed list (Catalog → Stone Types) first,
  // falling back to the built-in presets so the field isn't empty before any are added.
  const stoneTypeOptions = useMemo(() => {
    const catalogNames = asArray(catalog.stones).map((s) => s.name).filter(Boolean);
    return [...new Set([...catalogNames, ...STONE_TYPE_PRESETS])];
  }, [catalog.stones]);

  // Purity options for selected metal (handles duplicate seed metal ids + empty meta)
  const availablePurities = useMemo(
    () => puritiesForMetal(catalog.purities, form.metal_type_id, catalog.metals),
    [catalog.purities, catalog.metals, form.metal_type_id],
  );

  const handleMetalChange = (metalId) => {
    const metal = catalog.metals.find((m) => m.id === metalId);
    const validPurities = puritiesForMetal(catalog.purities, metalId, catalog.metals);
    const stillValid = validPurities.some((p) => p.id === form.purity_id);

    let nextPurityId = form.purity_id;
    if (!stillValid) {
      const default22k =
        String(metal?.code || "").toUpperCase() === "GOLD"
          ? validPurities.find((p) => String(p.code || "").toUpperCase() === "22K")
          : null;
      nextPurityId = default22k ? default22k.id : (validPurities[0]?.id || "");
    }
    // Gold is priced/weighed in grams far more often than any other unit —
    // default to it so the common case needs no extra click, but only when
    // the user hasn't already picked a unit themselves.
    const isGold = String(metal?.code || "").toUpperCase() === "GOLD";
    const gramUnit = catalog.units.find((u) => u.code === "g");
    setForm((f) => {
      const cat = catalog.categories.find((c) => c.id === f.category_id);
      const autoName = [metal?.name, cat?.name].filter(Boolean).join(" ");
      const nextUnitId = !f.unit_id && isGold && gramUnit ? gramUnit.id : f.unit_id;
      return { ...f, metal_type_id: metalId, purity_id: nextPurityId, unit_id: nextUnitId, name: autoName || f.name };
    });
  };
  const toggleAttrMulti = (code, opt) => {
    const cur = (form.attribute_values || {})[code] || [];
    setAttr(code, cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt]);
  };

  // Stone detail helpers
  const addStoneRow = () => set("stone_details", [...asArray(form.stone_details), { ...EMPTY_STONE_ROW }]);
  const removeStoneRow = (idx) => set("stone_details", asArray(form.stone_details).filter((_, i) => i !== idx));
  const setStoneField = (idx, field, value) => {
    const rows = asArray(form.stone_details).map((r, i) => (i === idx ? { ...r, [field]: value } : r));
    set("stone_details", rows);
  };

  const otherWeight = useMemo(() => {
    const v = Number(form.gross_weight) - Number(form.net_weight) - Number(form.stone_weight);
    return Math.max(0, parseFloat(v.toFixed(3)));
  }, [form.gross_weight, form.net_weight, form.stone_weight]);

  const makingChargeLabel = form.making_charge_type === "per_gram" ? "₹/g" : form.making_charge_type === "percentage" ? "%" : "₹";

  const previewProduct = useMemo(() => {
    const metal = catalog.metals.find((m) => m.id === form.metal_type_id);
    const purity = catalog.purities.find((p) => p.id === form.purity_id);
    const cat = catalog.categories.find((c) => c.id === form.category_id);
    const sub = catalog.categories.find((c) => c.id === form.subcategory_id);
    const counter = counters.find((c) => c.id === form.counter_id);
    const unit = catalog.units.find((u) => u.id === form.unit_id);
    const autoName = form.name || [metal?.name, cat?.name].filter(Boolean).join(" ") || "Product";
    return {
      ...form,
      name: autoName,
      category_name: cat?.name || null,
      subcategory_name: sub?.name || null,
      metal_name: metal?.name || null,
      purity_name: purity?.name || null,
      purity_code: purity?.code || null,
      counter_name: counter?.name || null,
      unit_name: unit?.name || null,
      unit_code: unit?.code || null,
    };
  }, [form, catalog, counters]);

  const previewPrice = useMemo(
    () => estimateCreatedProductPrice(previewProduct, goldRate, allRates),
    [previewProduct, goldRate, allRates],
  );
  const pricePreview = previewPrice;

  const openReview = () => {
    if (!form.metal_type_id) {
      toast.error("Select metal type first");
      return;
    }
    if (!form.category_id) {
      toast.error("Select category first");
      return;
    }
    if (!form.unit_id) {
      toast.error("Select unit first");
      return;
    }
    setSubmitError(null);
    setReviewOpen(true);
    // Bring the review panel into view on smaller screens
    setTimeout(() => {
      document.getElementById("product-review-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    // New products must confirm from the right-side overview first
    if (!editing && !reviewOpen) {
      openReview();
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      if (!form.metal_type_id) throw new Error("Metal Type is required");
      if (!form.purity_id) throw new Error("Purity is required");
      if (!form.unit_id) throw new Error("Unit is required");
      if (!form.category_id) throw new Error("Category is required");
      if (subcategories.length > 0 && !form.subcategory_id) throw new Error("Sub-category is required");
      if (!String(form.hsn_code || "").trim()) throw new Error("HSN Code is required");
      if (form.gst_slab === "" || form.gst_slab == null) throw new Error("GST % is required");
      if (isWeightUnit) {
        if (!(Number(form.gross_weight) > 0)) throw new Error("Gross Weight is required");
        if (!(Number(form.net_weight) > 0)) throw new Error("Net Weight is required");
      }
      if (isTrayUnit) {
        if (!(Number(form.tray_total_weight) > 0)) throw new Error("Tray Total Weight is required");
        if (!(Number(form.stock_qty) > 0)) throw new Error("No. of Pieces is required");
      }
      if (isPieceUnit && !(Number(form.selling_price) > 0)) {
        throw new Error("Price is required");
      }
      if (!editing && !isTrayUnit && (form.stock_qty === "" || form.stock_qty == null)) {
        throw new Error("Stock Qty is required");
      }
      if (profitLossEnabled && !editing && !(Number(form.purchase_price) > 0)) {
        throw new Error(isTrayUnit ? "Total Tray Purchase Amount is required" : "Purchase Price is required");
      }

      // Prefer form (set from category pick); fall back to category/sub defaults.
      const parentCat = catalog.categories.find((c) => c.id === form.category_id);
      const subCat = catalog.categories.find((c) => c.id === form.subcategory_id);
      const resolvedCounterId = form.counter_id || subCat?.counter_id || parentCat?.counter_id || null;
      if (counters.length > 0 && !resolvedCounterId) {
        throw new Error("Selected category has no showcase counter. Allocate it under Catalog → Categories.");
      }

      // Auto-derive name from metal + sub-category (fallback: category) if not set
      const metalName = catalog.metals.find((m) => m.id === form.metal_type_id)?.name || "";
      const labelName = subCat?.name || parentCat?.name || "";
      const autoName = form.name || [metalName, labelName].filter(Boolean).join(" ") || "Product";

      const payload = {
        name: autoName,
        category_id: form.category_id || null,
        subcategory_id: form.subcategory_id || null,
        collection_ids: asArray(form.collection_ids),
        tag_ids: asArray(form.tag_ids),
        metal_type_id: form.metal_type_id || null,
        purity_id: form.purity_id || null,
        stone_type_ids: asArray(form.stone_type_ids),
        unit_id: form.unit_id || null,
        attribute_values: asObject(form.attribute_values),
        gross_weight: isTrayUnit ? roundWeight(form.tray_total_weight) : roundWeight(form.gross_weight),
        net_weight: isTrayUnit ? roundWeight(form.tray_total_weight) : roundWeight(form.net_weight),
        stone_weight: roundWeight(form.stone_weight),
        making_charges: Number(form.making_charges) || 0,
        making_charge_type: form.making_charge_type || "fixed",
        wastage_pct: Number(form.wastage_pct) || 0,
        hallmark: form.hallmark || "",
        hsn_code: form.hsn_code || "",
        gst_slab: Number(form.gst_slab) || 3,
        purchase_price: Number(form.purchase_price) || 0,
        selling_price: Number(form.selling_price) || 0,
        low_stock_threshold: 0,
        description: form.description || "",
        design_no: form.design_no || "",
        cal_code: form.cal_code || "",
        size: form.size || "",
        showcase_location: form.showcase_location || "",
        counter_id: resolvedCounterId,
        certification: form.certification || "",
        vendor_id: form.vendor_id || null,
        purchase_date: form.purchase_date || null,
        // Tray edit only — on create the server derives it from purchase_price ÷ tray weight.
        ...(editing && isTrayUnit && profitLossEnabled
          ? { purchase_cost_per_gram: Number(form.purchase_cost_per_gram) || null }
          : {}),
        stone_details: asArray(form.stone_details),
        // Tray unit only: total weight of all pieces combined.
        tray_total_weight: roundWeight(form.tray_total_weight),
      };
      // stock_qty: editable for quantity-mode; unique_tag stays protected server-side
      payload.stock_qty = Number(form.stock_qty) || 0;
      if (!editing) {
        payload.code = form.code;
        payload.barcode = form.barcode;
        payload.status = form.status || "available";
        payload.inventory_mode = form.inventory_mode || "quantity";
      }

      if (editing) {
        const { data: updated } = await api.patch(`/products/${id}`, payload);
        if (updated?._inventory_fields_ignored?.length) {
          toast.success("Product updated (stock/status unchanged — use stock adjustment)");
        } else {
          toast.success("Product updated");
        }
        setUpdatedPreview({
          ...(updated || {}),
          ...previewProduct,
          id: updated?.id || id,
          barcode: updated?.barcode || form.barcode,
          code: updated?.code || form.code,
          gross_weight: payload.gross_weight,
          net_weight: payload.net_weight,
          stone_weight: payload.stone_weight,
          tray_total_weight: payload.tray_total_weight,
          stock_qty: payload.stock_qty ?? updated?.stock_qty,
          stone_details: payload.stone_details,
        });
      } else {
        const { data: created } = await api.post("/products", payload);
        clearProductDraft();
        draftReadyRef.current = false;
        setSavedProduct(created);
      }
    } catch (err) {
      const code = err?.response?.data?.code;
      const msg = formatApiError(err);
      if (code === "BARCODE_EXISTS" || code === "BARCODE_LOCKED") {
        playStockAlertSound();
        setBarcodeAlert({
          title: code === "BARCODE_LOCKED" ? "Barcode cannot be edited" : "Tag already added",
          message: msg,
        });
      } else {
        setSubmitError(msg);
        toast.error(msg);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    } finally {
      setBusy(false);
    }
  };

  const startFreshProduct = () => {
    clearProductDraft();
    setSavedProduct(null);
    setReviewOpen(false);
    setRestoredDraft(false);
    setSubmitError(null);
    setLoading(true);
    draftReadyRef.current = false;
    setForm(EMPTY);
    ensureProductDraft(async () => {
      const { data } = await api.get("/products/next-barcode");
      return data?.barcode || "";
    })
      .then(({ draft }) => {
        if (!draft?.form) return;
        setForm({ ...EMPTY, ...draft.form });
      })
      .catch(() => {})
      .finally(() => {
        draftReadyRef.current = true;
        setLoading(false);
      });
  };

  const remove = async () => {
    if (!(await confirm("Delete this product?"))) return;
    try {
      await api.delete(`/products/${id}`);
      toast.success("Product deleted");
      nav("/inventory");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const toggleDisplayStatus = async () => {
    const onDisplay = form.status !== "on_display";
    setDisplayBusy(true);
    try {
      const { data: updated } = await api.patch(`/products/${id}/display`, { on_display: onDisplay });
      set("status", updated.status);
      toast.success(onDisplay ? "Marked as On Display" : "Moved back to Available");
      api.get(`/masters/products/${id}/status-history`)
        .then(({ data: h }) => setStatusHistory(h?.data || []))
        .catch(() => {});
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setDisplayBusy(false);
    }
  };

  if (loading) return (
    <div className={`${TRADE_PAGE_CLASS} space-y-4`}>
      <PageLoadingBadge />
      <div className="h-96 shimmer rounded-[10px]" />
    </div>
  );

  if (savedProduct) return (
    <SavedProductPanel
      product={savedProduct}
      shopName={shopName}
      goldRate={goldRate}
      allRates={allRates}
      onInventory={() => nav("/inventory")}
      onAddAnother={startFreshProduct}
    />
  );

  const productTag = form.barcode || form.code || "";

  return (
    <div className={`${TRADE_PAGE_CLASS} mx-auto pb-24 ${reviewOpen && !editing ? "max-w-[1280px]" : "max-w-[1100px]"}`}>
      <button
        type="button"
        onClick={() => nav("/inventory")}
        className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6E786F] hover:text-[#244B39] mb-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors"
      >
        <ArrowLeft size={13} strokeWidth={1.5} /> Back to inventory
      </button>

      {/* Hero header */}
      <div
        className="relative overflow-hidden rounded-[12px] border border-[#DCE3D6] mb-5 shadow-[0_1px_2px_rgba(35,58,43,0.04)]"
        style={{ background: "#FFFDF8" }}
      >
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-40"
          style={{ background: "radial-gradient(circle, rgba(180,144,66,0.10) 0%, transparent 70%)" }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-5 px-6 py-5">
          <div className="min-w-0 pt-0.5">
            <div className="text-[11px] uppercase tracking-[0.14em] font-semibold text-[#B49042] mb-1.5">
              Inventory
            </div>
            <h2 className="font-display text-[26px] font-semibold text-[#2F3A32] tracking-tight">
              {editing ? form.name || "Edit Product" : "New Product"}
            </h2>
            <p className="text-[13px] text-[#6E786F] mt-1.5 max-w-xl leading-relaxed">
              {editing
                ? "Update weights, charges and stock. Price at billing uses the live gold rate."
                : "Fill metal, identity and weights. Your tag stays reserved until you create the product."}
            </p>
            {editing && (
              <div className="mt-4 flex flex-wrap items-center gap-2.5">
                <span className={`inline-flex items-center h-9 px-3 rounded-lg border text-[12.5px] font-medium ${DISPLAY_STATUS_META[form.status]?.chip || "bg-[#F1F4ED] text-[#5F6D62] border-[#DCE3D6]"}`}>
                  {DISPLAY_STATUS_META[form.status]?.label || form.status}
                </span>
                {can("inventory", "edit") && (form.status === "available" || form.status === "on_display") && (
                  <button
                    type="button"
                    onClick={toggleDisplayStatus}
                    disabled={displayBusy}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[9px] border border-[#DCE3D6] bg-white text-[12.5px] font-medium text-[#2F3A32] hover:bg-[#F1F4ED] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors disabled:opacity-50"
                  >
                    {form.status === "on_display" ? <EyeOff size={13} strokeWidth={1.5} /> : <Eye size={13} strokeWidth={1.5} />}
                    {displayBusy ? "Updating…" : form.status === "on_display" ? "Remove from Display" : "Mark as On Display"}
                  </button>
                )}
                {can("inventory", "delete") && (
                  <button
                    type="button"
                    onClick={remove}
                    className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-[9px] border border-[#F1C7C4] bg-white text-[12.5px] font-medium text-[#9B3E3A] hover:bg-[#FEF3F2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8B5B2] transition-colors"
                  >
                    <Trash2 size={13} strokeWidth={1.5} /> Delete product
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="shrink-0 text-right">
            <div
              className="inline-flex flex-col items-end rounded-[10px] border px-6 py-4 min-w-[180px]"
              style={{
                borderColor: "#EADFBF",
                background: "#FDFBF7",
                boxShadow: "0 4px 14px rgba(180,144,66,0.08)",
              }}
            >
              <div className="text-[10px] uppercase tracking-[0.16em] font-semibold text-[#B49042]">Tag No</div>
              <div className="text-[34px] leading-none font-semibold font-mono text-[#2F3A32] mt-2 tabular-nums tracking-tight">
                {productTag || "—"}
              </div>
              <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#166534] bg-[#DCFCE7] px-2 py-0.5 rounded-full">
                {editing ? "Auto generated" : "Reserved"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {!editing && restoredDraft && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-[10px] border border-[#CFE1D1] bg-[#EDF4EE] px-4 py-3">
          <div className="text-[12.5px] text-[#166534]">
            Draft restored with tag <span className="font-mono font-semibold">#{productTag || "—"}</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              className="text-[12px] font-medium text-[#356747] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
              onClick={startFreshProduct}
            >
              Start fresh
            </button>
            <button
              type="button"
              className="text-[12px] font-medium text-[#356747] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
              onClick={() => setRestoredDraft(false)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className={reviewOpen && !editing ? "grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start" : undefined}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (editing) submit(e);
          else if (reviewOpen) submit(e);
          else openReview();
        }}
        data-testid={T.productForm}
        className="space-y-4 min-w-0"
      >

        {/* ── Section 1: Metal & Purity ── */}
        <FormSection title="Metal & Purity" hint="Required for pricing">
          <div className="grid grid-cols-2 gap-4">
            <F label="Metal Type" required>
              <select
                data-testid="product-metal-select"
                className="input"
                value={form.metal_type_id || ""}
                onChange={(e) => handleMetalChange(e.target.value)}
                required
              >
                <option value="">Select metal</option>
                {catalog.metals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </F>
            <F label="Purity" required>
              <select
                data-testid="product-purity-select"
                className="input"
                value={form.purity_id || ""}
                onChange={(e) => set("purity_id", e.target.value)}
                disabled={!form.metal_type_id}
                required
              >
                <option value="">{form.metal_type_id ? "Select purity" : "Select a metal first"}</option>
                {availablePurities.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </F>
            <F label="Hallmark No (BIS HUID)">
              <input
                className="input font-mono"
                value={form.hallmark || ""}
                onChange={(e) => set("hallmark", e.target.value)}
                placeholder="e.g. AA12345"
              />
            </F>
            <F label="Certification">
              <select
                className="input"
                value={form.certification || ""}
                onChange={(e) => set("certification", e.target.value)}
              >
                <option value="">Select certification</option>
                <option value="BIS">BIS</option>
                <option value="GIA">GIA</option>
                <option value="IGI">IGI</option>
                <option value="None">None</option>
              </select>
            </F>
            <F label="Unit" required>
              <select
                className="input"
                value={form.unit_id || ""}
                onChange={(e) => set("unit_id", e.target.value)}
                required
              >
                <option value="">Select unit</option>
                {catalog.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <span className="block text-[11px] text-[#8D998F] mt-1">
                Defaults to Gram for Gold. Piece shows Price. Tray shows tray stock. Other units show weight & making.
              </span>
            </F>
            {calCodeEnabled && (
              <F label="Cal Code">
                <input
                  className="input font-mono"
                  data-testid="product-cal-code-input"
                  value={form.cal_code || ""}
                  onChange={(e) => set("cal_code", e.target.value)}
                  placeholder="Optional"
                  maxLength={40}
                />
              </F>
            )}
          </div>
        </FormSection>

        {/* ── Section 2: Identity ── */}
        <FormSection title="Identity" hint="Category drives counter">
          <div className="grid grid-cols-2 gap-4">
            <F label="Category" required>
              <select
                className="input"
                data-testid="product-category-select"
                value={form.category_id}
                onChange={(e) => handleCategoryChange(e.target.value)}
                disabled={!form.metal_type_id}
                required
              >
                <option value="">{form.metal_type_id ? "Select category" : "Select a metal first"}</option>
                {topCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </F>
            <F label="Sub-category" required={subcategories.length > 0}>
              <select
                className="input"
                data-testid="product-subcategory-select"
                value={form.subcategory_id || ""}
                onChange={(e) => handleSubcategoryChange(e.target.value)}
                disabled={!form.category_id || subcategories.length === 0}
                required={subcategories.length > 0}
              >
                <option value="">{!form.category_id ? "Select a category first" : subcategories.length === 0 ? "—" : "Select sub-category"}</option>
                {subcategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </F>
            <F label="Category Counter" hint="From the category’s showcase — set under Catalog → Categories">
              <input
                className="input bg-[#FAFAFA]"
                value={
                  counters.find((c) => c.id === form.counter_id)?.name
                  || (form.category_id ? "Not set on category" : "Select a category")
                }
                readOnly
                tabIndex={-1}
              />
            </F>
          </div>
        </FormSection>

        {/* ── Section 2b: Tray Information (Tray unit only) ── */}
        {isTrayUnit && (
        <FormSection title="Tray Information" hint="Tray unit only">
          <p className="text-[12px] text-[#6E786F] mb-4">Enter total weight and number of pieces for this tray.</p>
          <div className="grid grid-cols-2 gap-4">
            <F label="Total Weight (g)" required>
              <NumField
                step="0.001"
                min="0"
                maxDecimals={3}
                className={`input font-mono ${NO_SPINNER}`}
                value={form.tray_total_weight}
                onChange={(v) => set("tray_total_weight", v)}
                placeholder="0.000"
                required
              />
              <span className="block text-[11px] text-[#8D998F] mt-1">Combined weight of all pieces</span>
            </F>
            <F label="No. of Pieces" required>
              <NumField
                min="0"
                className={`input font-mono ${NO_SPINNER}`}
                value={form.stock_qty}
                onChange={(v) => set("stock_qty", v)}
                required
              />
              <span className="block text-[11px] text-[#8D998F] mt-1">Auto-reflected in Stock Qty</span>
            </F>
          </div>
        </FormSection>
        )}

        {/* ── Section 3: Weight Details (Gram-like units only) ── */}
        {isWeightUnit && (
        <FormSection title="Weight Details" hint="Grams (g)">
          <div className="grid grid-cols-4 gap-4">
            <F label="Gross Weight (g)" required>
              <NumField
                step="0.001"
                min="0"
                maxDecimals={3}
                className={`input font-mono ${NO_SPINNER}`}
                value={form.gross_weight}
                onChange={(v) => set("gross_weight", v)}
                placeholder="0.000"
                required
              />
              <span className="block text-[11px] text-[#8D998F] mt-1">Total incl. stones</span>
            </F>
            <F label="Net Weight / Gold Weight (g)" required>
              <NumField
                step="0.001"
                min="0"
                maxDecimals={3}
                className={`input font-mono ${NO_SPINNER}`}
                value={form.net_weight}
                onChange={(v) => set("net_weight", v)}
                placeholder="0.000"
                required
              />
              <span className="block text-[11px] text-[#8D998F] mt-1">Pure gold used for pricing</span>
            </F>
            <F label="Stone Weight (g)" required>
              <NumField
                step="0.001"
                min="0"
                maxDecimals={3}
                className={`input font-mono ${NO_SPINNER}`}
                value={form.stone_weight}
                onChange={(v) => set("stone_weight", v)}
                placeholder="0.000"
              />
              <span className="block text-[11px] text-[#8D998F] mt-1">Weight of all stones (enter 0 if none)</span>
            </F>
            <div>
              <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F] mb-1.5">
                Other Weight (g)
              </span>
              <div className="input font-mono bg-[#F5F5F5] text-[#6E786F] cursor-default select-none">
                {otherWeight.toFixed(3)}
              </div>
              <span className="block text-[11px] text-[#8D998F] mt-1">Gross − Net − Stone</span>
            </div>
          </div>
        </FormSection>
        )}

        {/* ── Section 4: Stone Details (Gram-like units + Tray) ── */}
        {(isWeightUnit || isTrayUnit) && (
        <FormSection
          title="Stone Details"
          hint="Weight in grams — carats auto-calculated"
          action={
            <button
              type="button"
              onClick={addStoneRow}
              className="btn-secondary inline-flex items-center gap-1.5 text-[12px]"
            >
              <Plus size={13} strokeWidth={1.5} /> Add Stone
            </button>
          }
        >
          {(asArray(form.stone_details).length === 0) ? (
            <div className="text-center py-8 text-[13px] text-[#8D998F] border border-dashed border-[#DCE3D6] rounded-[9px]">
              No stones added — click &quot;Add Stone&quot; to record stone details
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#DCE3D6]">
                    {["Stone Type", "Count", "Weight (g)", "Price (₹)", ""].map((h) => (
                      <th key={h} className="text-left text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F] pb-2 pr-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F5F5F5]">
                  {asArray(form.stone_details).map((row, idx) => {
                    const carats = (row.total_carat ?? 0);
                    const grams = Math.round(carats * GRAMS_PER_CARAT * 1000) / 1000;
                    return (
                    <tr key={idx} className="align-top">
                      <td className="py-2 pr-3 min-w-[140px]">
                        <input
                          className="input text-[12.5px]"
                          list={`stone-presets-${idx}`}
                          value={row.stone_type || ""}
                          onChange={(e) => setStoneField(idx, "stone_type", e.target.value)}
                          placeholder="Diamond…"
                        />
                        <datalist id={`stone-presets-${idx}`}>
                          {stoneTypeOptions.map((s) => <option key={s} value={s} />)}
                        </datalist>
                      </td>
                      <td className="py-2 pr-3 w-[80px]">
                        <NumField
                          min="1"
                          className={`input font-mono text-[12.5px] ${NO_SPINNER}`}
                          value={row.count ?? 1}
                          onChange={(v) => setStoneField(idx, "count", v)}
                        />
                      </td>
                      <td className="py-2 pr-3 w-[130px]">
                        <NumField
                          value={grams}
                          step="0.001"
                          min="0"
                          maxDecimals={3}
                          className={`input font-mono text-[12.5px] ${NO_SPINNER}`}
                          onChange={(g) => setStoneField(idx, "total_carat", Math.round((g / GRAMS_PER_CARAT) * 10000) / 10000)}
                          placeholder="0.000"
                        />
                        <span className="block text-[10.5px] text-[#8D998F] mt-1 font-mono">
                          = {carats.toFixed(3)} carat{carats === 1 ? "" : "s"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 w-[120px]">
                        <MoneyInput
                          value={row.price ?? 0}
                          min="0"
                          className={`input font-mono text-[12.5px] ${NO_SPINNER}`}
                          onValueChange={(_, amount) => setStoneField(idx, "price", amount)}
                          placeholder="0.00"
                        />
                      </td>
                      <td className="py-2 w-[36px]">
                        <button
                          type="button"
                          onClick={() => removeStoneRow(idx)}
                          className="p-1 rounded hover:bg-[#FEF2F2] text-[#8D998F] hover:text-[#991B1B] transition-colors"
                          title="Remove stone"
                        >
                          <X size={14} strokeWidth={1.5} />
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </FormSection>
        )}

        {/* ── Section 5: Making & Charges (Gram-like units + Tray) ── */}
        {(isWeightUnit || isTrayUnit) && (
        <FormSection
          title="Making & Charges"
          hint={categoryDefaults ? "Defaults from category — editable" : undefined}
        >
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-4">
              {/* Making charge type toggle */}
              <div>
                <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F] mb-2">
                  Making Charge Type <span className="text-[#DC2626]">*</span>
                </span>
                <div className="flex gap-2">
                  {[
                    { value: "per_gram", label: "Per Gram" },
                    { value: "fixed", label: "Flat Amount" },
                    { value: "percentage", label: "Percentage" },
                  ].map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => { set("making_charge_type", opt.value); setCategoryDefaults(false); }}
                      className={`chip cursor-pointer ${form.making_charge_type === opt.value ? "chip-gold" : "chip-neutral"}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <F label={`Making Charges (${makingChargeLabel})`} required>
                {form.making_charge_type === "percentage" ? (
                  <NumField
                    step="0.01"
                    min="0"
                    className={`input font-mono ${NO_SPINNER}`}
                    value={form.making_charges}
                    onChange={(v) => { set("making_charges", v); setCategoryDefaults(false); }}
                  />
                ) : (
                  <MoneyInput
                    min="0"
                    className={`input font-mono ${NO_SPINNER}`}
                    value={form.making_charges}
                    onValueChange={(_, amount) => { set("making_charges", amount); setCategoryDefaults(false); }}
                  />
                )}
              </F>

              <F label="Wastage % (typically 2–12%)" required>
                <NumField
                  step="0.1"
                  min="0"
                  max="50"
                  className={`input font-mono ${NO_SPINNER}`}
                  value={form.wastage_pct}
                  onChange={(v) => { set("wastage_pct", v); setCategoryDefaults(false); }}
                />
              </F>
            </div>

            <div className="rounded-[10px] border border-[#EADFBF] p-4 bg-[#FDFBF7]">
              <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#B49042] mb-3">
                Estimated Price Preview
              </div>
              <div className="text-[12px] text-[#6E786F] mb-3">
                At {fmtRatePerGram(pricePreview.effectiveRate || goldRate)}
                ({pricePreview.purityKey ? pricePreview.purityKey.toUpperCase() : "24K"} live rate)
              </div>
              <div className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[#5F6D62]">Metal Value</span>
                  <span className="font-mono text-[#2F3A32]">{fmtINR(pricePreview.goldValue, { decimals: 0 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5F6D62]">Wastage ({form.wastage_pct}%)</span>
                  <span className="font-mono text-[#2F3A32]">{fmtINR(pricePreview.wastage, { decimals: 0 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#5F6D62]">Making</span>
                  <span className="font-mono text-[#2F3A32]">{fmtINR(pricePreview.making, { decimals: 0 })}</span>
                </div>
                {pricePreview.stonePrice > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[#5F6D62]">Stone Price</span>
                    <span className="font-mono text-[#2F3A32]">{fmtINR(pricePreview.stonePrice, { decimals: 0 })}</span>
                  </div>
                )}
                <div className="border-t border-[#E8D99A] pt-2 mt-2 flex justify-between font-semibold">
                  <span className="text-[#2F3A32]">Estimated Total</span>
                  <span className="font-mono text-[#B49042] text-[14px]">
                    {fmtINR(pricePreview.total, { decimals: 0 })}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-[#8D998F] mt-3 leading-relaxed">
                Actual price is calculated at billing using the live gold rate.
              </p>
            </div>
          </div>
        </FormSection>
        )}

        {/* ── Section 6: Tax & Compliance ── */}
        <FormSection title="Tax & Compliance">
          <div className="grid grid-cols-3 gap-4">
            <F label="HSN Code" required>
              <input
                className="input font-mono"
                value={form.hsn_code || ""}
                onChange={(e) => set("hsn_code", e.target.value)}
                placeholder="7113 for gold, 7114 for silver"
                required
              />
            </F>
            <F label="GST %" required>
              <NumField
                step="0.1"
                min="0"
                className={`input font-mono ${NO_SPINNER}`}
                value={form.gst_slab}
                onChange={(v) => set("gst_slab", v)}
                required
              />
            </F>
            <F label="Size">
              <input
                className="input"
                value={form.size || ""}
                onChange={(e) => set("size", e.target.value)}
                placeholder="Ring: 16, Bangle: 2.6, Chain: 18 in"
              />
            </F>
            <F label="Purchase Date">
              <input
                type="date"
                className="input"
                value={form.purchase_date || ""}
                onChange={(e) => set("purchase_date", e.target.value)}
              />
            </F>
            {profitLossEnabled && isTrayUnit && editing && (
              // Tray edit: the per-gram cost is what's stored and used — the
              // tray's weight is now only what's left, so a total amount
              // can't be re-divided by it.
              <F label="Purchase Cost per Gram (₹/g)">
                <MoneyInput
                  min="0"
                  maximumFractionDigits={4}
                  data-testid="product-purchase-cost-per-gram-input"
                  className={`input font-mono ${NO_SPINNER}`}
                  value={form.purchase_cost_per_gram ?? ""}
                  onValueChange={(_, amount) => set("purchase_cost_per_gram", amount)}
                />
                <p className="text-[11px] text-[#8D998F] mt-1">
                  {Number(form.purchase_cost_per_gram) > 0 && Number(form.tray_total_weight) > 0
                    ? `Tray value now: ${fmtINR(Number(form.purchase_cost_per_gram) * Number(form.tray_total_weight))} for ${formatWeight(form.tray_total_weight)} g left.`
                    : "COGS = cost per gram × weight sold."}
                </p>
              </F>
            )}
            {profitLossEnabled && !(isTrayUnit && editing) && (
              <F label={isTrayUnit ? "Total Tray Purchase Amount (₹)" : "Purchase Price per Piece (₹)"} required={!editing}>
                <MoneyInput
                  min="0"
                  data-testid="product-purchase-price-input"
                  className={`input font-mono ${NO_SPINNER}`}
                  value={form.purchase_price}
                  onValueChange={(_, amount) => set("purchase_price", amount)}
                  required={!editing}
                />
                {isTrayUnit ? (
                  <p className="text-[11px] text-[#8D998F] mt-1">
                    {Number(form.purchase_price) > 0 && Number(form.tray_total_weight) > 0
                      ? `= ${fmtINR(Number(form.purchase_price) / Number(form.tray_total_weight))}/g over ${formatWeight(form.tray_total_weight)} g. COGS is charged by weight sold.`
                      : "Amount paid for the whole tray. Divided by Tray Total Weight to get the cost per gram."}
                  </p>
                ) : (
                  <p className="text-[11px] text-[#8D998F] mt-1">
                    Cost of one piece — multiplied by quantity for stock value and COGS.
                  </p>
                )}
              </F>
            )}
          </div>
        </FormSection>

        {/* ── Section 7: Price (Piece unit) + Stock (all except Tray, which has its own above) ── */}
        <FormSection title={isPieceUnit ? "Price & Stock" : "Stock"}>
          <div className="grid grid-cols-2 gap-4">
            {isPieceUnit && (
              <F label="Price (₹)" required>
                <MoneyInput
                  min="0"
                  data-testid="product-price-input"
                  className={`input font-mono ${NO_SPINNER}`}
                  value={form.selling_price}
                  onValueChange={(_, amount) => set("selling_price", amount)}
                  required
                />
              </F>
            )}
            {isTrayUnit ? (
              <F label="Stock Qty">
                <div className="input font-mono bg-[#F5F5F5] text-[#6E786F] cursor-default select-none">
                  {form.stock_qty || 0}
                </div>
                <p className="text-[11px] text-[#8D998F] mt-1">
                  Auto-filled from &quot;No. of Pieces&quot; in Tray Information above.
                </p>
              </F>
            ) : (
              <F label="Stock Qty" required={!editing}>
                <NumField
                  min="0"
                  data-testid="product-stock-input"
                  className={`input font-mono ${NO_SPINNER}`}
                  value={form.stock_qty}
                  onChange={(v) => set("stock_qty", v)}
                />
                <p className="text-[11px] text-[#6E786F] mt-1">
                  Number of pieces in stock (use 1 for unique tagged jewellery). Low-stock alerts use the sub-category threshold from Catalog.
                </p>
              </F>
            )}
          </div>
        </FormSection>

        {/* ── Section 8: Collections & Tags ── */}
        <FormSection title="Collections & Tags">
          <div className="grid grid-cols-2 gap-4">
            <F label="Collections">
              <MultiPicker
                options={catalog.collections}
                value={form.collection_ids}
                onChange={(v) => set("collection_ids", v)}
                placeholder="Select collections"
              />
            </F>
            <F label="Tags">
              <MultiPicker
                options={catalog.tags}
                value={form.tag_ids}
                onChange={(v) => set("tag_ids", v)}
                placeholder="Select tags"
              />
            </F>
          </div>
        </FormSection>

        {/* ── Section 9: Category Attributes (dynamic) ── */}
        {attributes.length > 0 && (
          <FormSection
            title={
              <span className="inline-flex items-center gap-2">
                <Sparkles size={14} strokeWidth={1.5} className="text-[#B49042]" />
                Category attributes
              </span>
            }
            hint="Defined in Catalog"
          >
            <div className="grid grid-cols-2 gap-4">
              {attributes.map((a) => (
                <AttributeInput
                  key={a.id}
                  attr={a}
                  value={(form.attribute_values || {})[a.code]}
                  onChange={(v) => setAttr(a.code, v)}
                  onToggleMulti={(opt) => toggleAttrMulti(a.code, opt)}
                />
              ))}
            </div>
          </FormSection>
        )}

        {editing && statusHistory.length > 0 && (
          <FormSection title="Tag status history">
            <ul className="text-[12.5px] space-y-1.5 text-[#5F6D62]">
              {statusHistory.map((h) => (
                <li key={h.id} className="flex justify-between gap-3 border-b border-[#F5F5F5] pb-1">
                  <span>{h.from_status || "—"} → <strong>{h.to_status}</strong> · {h.reason || h.reference_type || ""}</span>
                  <span className="text-[#8D998F] font-mono shrink-0">{h.created_at ? new Date(h.created_at).toLocaleString("en-IN") : ""}</span>
                </li>
              ))}
            </ul>
          </FormSection>
        )}

        {/* hidden backward-compat field */}
        <input type="hidden" name="stone_type_ids" value={JSON.stringify(form.stone_type_ids || [])} />

        {submitError && (
          <div className="flex items-center gap-3 p-4 bg-[#FEF3F2] border border-[#F1C7C4] rounded-[9px]">
            <AlertTriangle size={16} className="text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="text-[13px] font-semibold text-red-800 mb-0.5">Could not save product</div>
              <div className="text-[12.5px] text-red-700 font-mono whitespace-pre-wrap">{submitError}</div>
            </div>
            <button type="button" onClick={() => setSubmitError(null)} className="text-[#8D998F] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]">
              <X size={14} />
            </button>
          </div>
        )}

        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#DCE3D6] bg-[#FFFDF8]/95 backdrop-blur-sm md:left-64 shadow-[0_-4px_18px_rgba(35,58,43,0.06)]">
          <div className={`mx-auto px-8 py-3 flex items-center justify-between gap-3 ${reviewOpen && !editing ? "max-w-[1280px]" : "max-w-[1100px]"}`}>
            <button type="button" onClick={() => nav("/inventory")} className="btn-secondary">
              Cancel
            </button>
            <div className="flex items-center gap-2">
              {!editing && reviewOpen && (
                <button type="button" onClick={() => setReviewOpen(false)} className="btn-secondary" disabled={busy}>
                  Back to edit
                </button>
              )}
              {!editing && !reviewOpen && (
                <button
                  type="button"
                  data-testid={T.productSave}
                  disabled={busy}
                  onClick={openReview}
                  className="btn-accent min-w-[160px]"
                >
                  Create product
                  <ArrowRight size={14} strokeWidth={1.5} />
                </button>
              )}
              {!editing && reviewOpen && (
                <button type="submit" disabled={busy} className="btn-accent min-w-[160px]">
                  <Save size={14} strokeWidth={1.5} /> {busy ? "Saving…" : "Save product"}
                </button>
              )}
              {editing && (
                <button type="submit" data-testid={T.productSave} disabled={busy} className="btn-accent min-w-[140px]">
                  <Save size={14} strokeWidth={1.5} /> {busy ? "Saving…" : "Save changes"}
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      {!editing && reviewOpen && (
        <aside id="product-review-panel" className="xl:sticky xl:top-6 self-start">
          <CreateReviewPanel
            product={previewProduct}
            price={previewPrice}
            tagNo={productTag}
          />
        </aside>
      )}
      </div>

      {updatedPreview && (
        <UpdatedBarcodeModal
          product={updatedPreview}
          shopName={shopName}
          onClose={() => { setUpdatedPreview(null); nav("/inventory"); }}
        />
      )}
      {confirmModal}
      <StockAlertDialog
        open={!!barcodeAlert}
        title={barcodeAlert?.title || "Tag already added"}
        message={barcodeAlert?.message || ""}
        onClose={() => setBarcodeAlert(null)}
      />
    </div>
  );
}

function AttributeInput({ attr, value, onChange, onToggleMulti }) {
  const label = (
    <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F] mb-1.5">
      {attr.name} {attr.unit && <span className="text-[#8D998F] normal-case tracking-normal">({attr.unit})</span>}
    </span>
  );
  const tid = `product-attr-${attr.code}`;

  switch (attr.field_type) {
    case "text":
      return (
        <label className="block">
          {label}
          <input data-testid={tid} className="input" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "number":
    case "price":
    case "weight":
      return (
        <label className="block">
          {label}
          {attr.field_type === "price" ? (
            <MoneyInput
              data-testid={tid}
              className={`input font-mono ${NO_SPINNER}`}
              value={value ?? 0}
              onValueChange={(_, amount) => onChange(amount)}
            />
          ) : (
            <NumField
              data-testid={tid}
              className={`input font-mono ${NO_SPINNER}`}
              value={value ?? 0}
              onChange={(v) => onChange(v)}
            />
          )}
        </label>
      );
    case "date":
      return (
        <label className="block">
          {label}
          <input data-testid={tid} type="date" className="input" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "boolean":
      return (
        <label className="flex items-center gap-2 pt-6">
          <input data-testid={tid} type="checkbox" className="h-4 w-4 rounded border-[#d4d4d8] text-[#2F3A32]" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          <span className="text-[13px] text-[#2F3A32]">{attr.name}</span>
        </label>
      );
    case "color":
      return (
        <label className="block">
          {label}
          <input data-testid={tid} type="color" className="h-9 w-full border border-[#C8D4C7] rounded-[9px]" value={value || "#B49042"} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "image":
      return (
        <label className="block col-span-2">
          {label}
          <input data-testid={tid} className="input" placeholder="https://…" value={value || ""} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
    case "dropdown":
      return (
        <label className="block">
          {label}
          <select data-testid={tid} className="input" value={value || ""} onChange={(e) => onChange(e.target.value)}>
            <option value="">Select</option>
            {asArray(attr.options).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      );
    case "multiselect": {
      const arr = value || [];
      return (
        <div className="block col-span-2">
          {label}
          <div className="flex flex-wrap gap-2" data-testid={tid}>
            {asArray(attr.options).map((o) => (
              <button
                type="button"
                key={o}
                onClick={() => onToggleMulti(o)}
                className={`chip ${arr.includes(o) ? "chip-gold" : "chip-neutral"} cursor-pointer`}
              >
                {o}
              </button>
            ))}
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

function MultiPicker({ options, value, onChange, placeholder }) {
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div>
      <div className="flex flex-wrap gap-2 min-h-[42px] border border-[#C8D4C7] rounded-[9px] p-2">
        {options.length === 0 && <span className="text-[12px] text-[#8D998F] px-2 py-1">{placeholder}</span>}
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <button
              type="button"
              key={o.id}
              onClick={() => toggle(o.id)}
              className={`chip ${on ? "chip-gold" : "chip-neutral"} cursor-pointer`}
            >
              {o.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function hydrateWeight(value) {
  if (value == null || value === "") return value;
  return roundWeight(value);
}

function numFieldText(value, maxDecimals) {
  if (value == null || value === "" || Number(value) === 0) return "";
  if (maxDecimals === 3) return formatWeight(value);
  return String(value);
}

// A numeric input that mirrors exactly what's typed (leading zeros, trailing
// decimal points, "0.9" while typing) instead of re-formatting on every
// keystroke from a derived/round-tripped value — which is what caused digits
// to vanish or scramble on the stone Weight/Price fields.
function NumField({ value, onChange, maxDecimals, ...props }) {
  const [text, setText] = useState(() => numFieldText(value, maxDecimals));
  const inputRef = useRef(null);

  useEffect(() => {
    const parsed = text === "" ? 0 : Number(text);
    // Tolerant of floating-point noise (e.g. 0.18 * 5 = 0.8999999999999999) —
    // an exact-equality check here would force the display back to that ugly
    // value on every render instead of leaving what the user actually typed.
    if (Number.isNaN(parsed) || Math.abs(parsed - Number(value || 0)) > 1e-6) {
      setText(numFieldText(value, maxDecimals));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return undefined;
    const onWheel = (e) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <input
      ref={inputRef}
      {...props}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        let v = e.target.value;
        // No use of NumField (weight, stock qty, making charges, wastage %,
        // GST slab, stone count/carat, custom numeric attributes) is ever
        // meant to go negative — a leading "-" here used to slip through
        // whole-number input and flow straight into gross/net/stone weight,
        // producing a negative line value with no sign check anywhere downstream.
        if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
        if (typeof maxDecimals === "number" && v.includes(".")) {
          if (maxDecimals === 3) {
            v = sanitizeWeightDraft(v);
          } else {
            const [whole, fraction = ""] = v.split(".");
            if (fraction.length > maxDecimals) {
              v = String(roundWeight(v, maxDecimals));
            }
          }
        }
        setText(v);
        onChange(v === "" || Number.isNaN(Number(v)) ? 0 : Number(v));
      }}
      onWheel={(e) => e.preventDefault()}
    />
  );
}

function FormSection({ title, hint, action, children }) {
  return (
    <section className="rounded-[10px] border border-[#DCE3D6] bg-[#FFFDF8] overflow-hidden shadow-[0_1px_2px_rgba(35,58,43,0.04)]">
      <div className="px-5 py-3 border-b border-[#E3E8E0] bg-[#F7F8F2] flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-baseline gap-2.5">
          <h3 className="font-display text-[14px] font-semibold text-[#2F3A32] truncate">{title}</h3>
          {hint ? <span className="text-[11px] text-[#8D998F] shrink-0">{hint}</span> : null}
        </div>
        {action || null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function F({ label, children, required, hint }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6E786F] mb-1.5">
        {label} {required && <span className="text-[#DC2626]">*</span>}
      </span>
      {hint && <span className="block text-[11px] text-[#8D998F] mb-1.5 -mt-1">{hint}</span>}
      {children}
    </label>
  );
}
