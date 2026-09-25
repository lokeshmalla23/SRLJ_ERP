import { useEffect, useState, useMemo, useRef } from "react";
import { ListSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import { Link } from "react-router-dom";
import {
  Search,
  Plus,
  Sparkles,
  Filter,
  Download,
  Upload,
  Loader2,
  ChevronDown,
  ChevronRight,
  Layers,
  Package,
  Scale,
  Box,
  Feather,
  AlertTriangle,
  CheckCircle2,
  LayoutGrid,
  Trash2,
  Ban,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import { fmtWeight } from "@/lib/format";
import { weightContribution } from "@/lib/trayWeight";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import PureInventoryTab from "@/components/inventory/PureInventoryTab";
import { FilterMultiSelect } from "@/pages/reports/FilterBar";
import ImportProgressModal from "@/components/inventory/ImportProgressModal";
import { productStatusLabel, isOutOfStockProduct } from "@/lib/productStatus";
import {
  JewelleryBannerArt,
  BullionArt,
  JewellerySwatch,
} from "@/components/dashboard/JewelleryArt";
import { swatchVariantFor } from "@/components/dashboard/swatchVariant";
import {
  INVENTORY_CSV_COLUMNS,
  csvEscape,
  emptyImportProgress,
  formatImportSummary,
  importProductsFromCsv,
} from "@/lib/productCsvImport";

/* ── decorative stat motifs (no data — pure presentation) ──────────────────── */
const MINI_BAR_HEIGHTS = [38, 62, 48, 82, 58, 94, 70];

/** Small static bar motif used as a card accent. Carries no values. */
function MiniBars({ className = "" }) {
  return (
    <svg viewBox="0 0 44 30" className={className} aria-hidden="true" focusable="false" role="presentation">
      {MINI_BAR_HEIGHTS.map((h, i) => (
        <rect key={i} x={i * 6.4} y={30 - h} width="3.6" height={h} rx="1.6" fill="currentColor" />
      ))}
    </svg>
  );
}


/* ── product status metadata ─────────────────────────────────────────── */
const STATUS_META = {
  available: { label: "Available", cls: "chip chip-success" },
  on_display: { label: "On Display", cls: "chip chip-gold" },
  reserved: { label: "Reserved", cls: "chip chip-warning" },
  estimation: { label: "Estimation", cls: "chip chip-warning" },
  damaged: { label: "Damaged", cls: "chip chip-danger" },
  sold: { label: "Sold out", cls: "chip chip-danger" },
  discontinued: { label: "Discontinued", cls: "chip chip-danger" },
  deleted: { label: "Deleted", cls: "chip chip-danger" },
  deleted_p: { label: "Deleted P", cls: "chip chip-danger" },
};
const STATUS_PILLS = ["all", "available", "on_display", "reserved", "estimation", "damaged"];

/** Zero qty, sold tags, deleted, or discontinued — not shown on the live inventory tab. */
const isOutOfStock = isOutOfStockProduct;

/* ═══════════════════════════════════════════════════════════════════════
   CATEGORY OVERVIEW
═══════════════════════════════════════════════════════════════════════ */
/** One tag/product card — used inside an expanded sub-category group. */
function ProductTagCard({ p, canEdit }) {
  const isLow = p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold || 3);
  const isOut = isOutOfStock(p);
  const statusLabel = STATUS_META[p.status]?.label || productStatusLabel(p.status);
  const productLabel = p.subcategory_name || p.name || "—";
  return (
    <Link to={canEdit ? `/inventory/${p.id}` : "#"}
      className="flex items-center gap-2.5 p-2.5 rounded-lg border border-[#E2E7E2] hover:border-[#CBDED2] hover:bg-[#FAF7EF] transition-colors group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#214F3A]/40 focus-visible:outline-offset-2">
      {/* Icon */}
      <div className="h-12 w-12 rounded-md bg-[#FAF7EF] border border-[#E8D6A6] flex items-center justify-center flex-shrink-0">
        <Sparkles size={12} className="text-[#D3DCD5]" strokeWidth={1.5} />
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-[#17201C] truncate leading-tight">{productLabel}</div>
        <div className="text-[10.5px] text-[#89928C] font-mono">{p.code || "—"}</div>
        <div className="flex items-center gap-1.5 mt-1">
          {p.purity_name && <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">{p.purity_name}</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isOut ? "bg-red-50 text-red-700" : isLow ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>
            {isOut
              ? (statusLabel && statusLabel !== "Available" ? statusLabel : "Out")
              : `${p.stock_qty} pcs`}
          </span>
        </div>
        <div className="text-[10.5px] text-[#6F7772] mt-0.5">
          {p.net_weight ? `${p.net_weight}g net` : ""}
          {p.hallmark ? ` · ${p.hallmark}` : ""}
        </div>
      </div>
    </Link>
  );
}

/** Group a product list into per-sub-category summary buckets (qty + purities), newest-first by name. */
function groupBySubcategory(prods) {
  const buckets = new Map();
  for (const p of prods) {
    const key = p.subcategory_id || p.subcategory_name || "__none__";
    if (!buckets.has(key)) {
      buckets.set(key, { key, label: p.subcategory_name || "Other", prods: [], purities: new Set() });
    }
    const bucket = buckets.get(key);
    bucket.prods.push(p);
    if (p.purity_name) bucket.purities.add(p.purity_name);
  }
  return [...buckets.values()]
    .map((b) => ({
      ...b,
      purities: [...b.purities],
      totalQty: b.prods.reduce((s, p) => s + (p.stock_qty || 0), 0),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Sub-category summary cards for one category's products — click a card to reveal its tags. */
function SubCategoryGroups({ prods, canEdit, groupPrefix, expandedSub, toggleSub }) {
  const groups = useMemo(() => groupBySubcategory(prods), [prods]);
  return (
    <div className="p-4 space-y-2">
      {groups.map((g) => {
        const subKey = `${groupPrefix}:${g.key}`;
        const isSubOpen = !!expandedSub[subKey];
        return (
          <div key={subKey} className="border border-[#E2E7E2] rounded-lg overflow-hidden bg-[#FFFDF9]">
            <button onClick={() => toggleSub(subKey)}
              className="w-full flex items-center gap-3 p-3 hover:bg-[#FBF9F4] transition-colors text-left">
              <div className="h-10 w-10 rounded-md bg-[#FAF7EF] border border-[#E8D6A6] flex items-center justify-center flex-shrink-0">
                <Sparkles size={14} className="text-[#D3DCD5]" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[#17201C] truncate">{g.label}</div>
                {g.purities.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {g.purities.map((pu) => (
                      <span key={pu} className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">{pu}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[13px] font-semibold text-[#17201C] tabular-nums">{g.totalQty} pcs</div>
                <div className="text-[10.5px] text-[#6F7772]">{g.prods.length} tag{g.prods.length === 1 ? "" : "s"}</div>
              </div>
              {isSubOpen ? <ChevronDown size={14} className="text-[#6F7772] flex-shrink-0" /> : <ChevronRight size={14} className="text-[#6F7772] flex-shrink-0" />}
            </button>
            {isSubOpen && (
              <div className="p-3 pt-0 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}>
                {g.prods.map((p) => <ProductTagCard key={p.id} p={p} canEdit={canEdit} />)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CategoryOverview({ products, categories, canEdit, stockTab = "in_stock" }) {
  const [expanded, setExpanded] = useState({});
  const [expandedSub, setExpandedSub] = useState({});

  const toggle = (id) => setExpanded((p) => ({ ...p, [id]: !p[id] }));
  const toggleSub = (key) => setExpandedSub((p) => ({ ...p, [key]: !p[key] }));

  // Build category tree with product stats
  const topCats = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const subCatMap = useMemo(() => {
    const m = {};
    categories.filter((c) => c.parent_id).forEach((c) => {
      if (!m[c.parent_id]) m[c.parent_id] = [];
      m[c.parent_id].push(c);
    });
    return m;
  }, [categories]);

  // Get products for a category (including those tagged via subcategory_id)
  const catProducts = (catId) => {
    const subIds = (subCatMap[catId] || []).map((s) => s.id);
    return products.filter(
      (p) =>
        p.category_id === catId
        || subIds.includes(p.category_id)
        || subIds.includes(p.subcategory_id),
    );
  };

  const catStats = (prods) => {
    const total = prods.length;
    const inStock = prods.filter((p) => p.stock_qty > 0).length;
    const totalQty = prods.reduce((s, p) => s + (p.stock_qty || 0), 0);
    const netWt = prods.reduce((s, p) => s + weightContribution(p, "net_weight"), 0);
    const available = prods.filter((p) => p.status === "available").length;
    const onDisplay = prods.filter((p) => p.status === "on_display").length;
    const reserved = prods.filter((p) => p.status === "reserved").length;
    const damaged = prods.filter((p) => p.status === "damaged").length;
    const sold = prods.filter((p) => p.status === "sold").length;
    const discontinued = prods.filter((p) => p.status === "discontinued").length;
    const deletedP = prods.filter((p) => p.status === "deleted_p").length;
    const deleted = prods.filter((p) => p.status === "deleted").length;
    const lowStock = prods.filter((p) => p.stock_qty > 0 && p.stock_qty <= (p.low_stock_threshold || 3)).length;
    const outOfStock = prods.filter((p) => p.stock_qty === 0).length;
    return { total, inStock, totalQty, netWt, available, onDisplay, reserved, damaged, sold, discontinued, deletedP, deleted, lowStock, outOfStock };
  };

  const overallStats = catStats(products);
  const isOutTab = stockTab === "out_of_stock";

  /* Compact summary tiles. `tone` only drives the surface/icon treatment —
   * every number below is the existing computed stat. */
  const SUMMARY_TONES = {
    neutral: { card: "border-[#E2E7E2] bg-[linear-gradient(150deg,#FFFDF9_0%,#F7F5F0_100%)]", icon: "border-[#E2E7E2] bg-[#F4F6F3]", iconFg: "text-[#4E5A53]" },
    gold:    { card: "border-[#EADFC4] bg-[linear-gradient(150deg,#FFFCF5_0%,#FAF3E4_100%)]", icon: "border-[#E6D3A6] bg-[linear-gradient(140deg,#FAF0D6,#EFDDB2)]", iconFg: "text-[#9A6C25]" },
    green:   { card: "border-[#D8E7DA] bg-[linear-gradient(150deg,#F9FCF9_0%,#EDF5EE_100%)]", icon: "border-[#CFE2D5] bg-[linear-gradient(140deg,#E9F3EB,#D6E8DC)]", iconFg: "text-[#2F6B4F]" },
    warn:    { card: "border-[#F0DFC2] bg-[linear-gradient(150deg,#FFFCF6_0%,#FBF3E2_100%)]", icon: "border-[#EBD9B0] bg-[linear-gradient(140deg,#FAF0DC,#F2E2BC)]", iconFg: "text-[#B07C1E]" },
    danger:  { card: "border-[#EFD9D6] bg-[linear-gradient(150deg,#FFFCFB_0%,#FAF0EE_100%)]", icon: "border-[#EBCBC7] bg-[linear-gradient(140deg,#FAE9E7,#F2D8D5)]", iconFg: "text-[#9D4B47]" },
  };

  const summaryTiles = isOutTab
    ? [
        { label: "Out of Stock", val: overallStats.total, color: "text-[#9D4B47]", tone: "danger", Icon: Ban },
        { label: "Sold out", val: overallStats.sold, color: "text-[#17201C]", tone: "neutral", Icon: Package },
        { label: "Deleted P", val: overallStats.deletedP, color: "text-[#6F7772]", tone: "neutral", Icon: Trash2 },
        { label: "Zero Qty", val: overallStats.outOfStock, color: "text-[#9D4B47]", tone: "danger", Icon: AlertTriangle },
        { label: "Damaged", val: overallStats.damaged, color: "text-[#B07C1E]", tone: "warn", Icon: AlertTriangle },
      ]
    : [
        { label: "Categories", val: topCats.length, color: "text-[#17201C]", tone: "neutral", Icon: LayoutGrid },
        { label: "In Stock Products", val: overallStats.total, color: "text-[#17201C]", tone: "gold", Icon: Box },
        { label: "Pieces", val: overallStats.totalQty, color: "text-[#2F6B4F]", tone: "green", Icon: Layers },
        { label: "Low Stock", val: overallStats.lowStock, color: "text-[#B07C1E]", tone: "warn", Icon: AlertTriangle },
        { label: "Available", val: overallStats.available, color: "text-[#2F6B4F]", tone: "green", Icon: CheckCircle2 },
      ];

  return (
    <div>
      {/* Overall summary bar */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        {summaryTiles.map((s) => {
          const t = SUMMARY_TONES[s.tone];
          return (
            <div key={s.label} className={`relative overflow-hidden rounded-[14px] border p-3.5 shadow-[0_8px_22px_-18px_rgba(32,43,38,0.5)] transition-[border-color,box-shadow] duration-200 hover:shadow-[0_10px_26px_-18px_rgba(32,43,38,0.55)] ${t.card}`}>
              <div className="flex items-center gap-2.5">
                <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[10px] border ${t.icon}`}>
                  <s.Icon size={14} strokeWidth={1.6} className={t.iconFg} />
                </span>
                <div className="min-w-0">
                  <div className={`font-display text-[18px] font-semibold leading-none tabular-nums ${s.color}`}>{s.val}</div>
                  <div className="mt-1 truncate text-[10.5px] text-[#6F7772]">{s.label}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Category cards */}
      <div className="space-y-3">
        {topCats.map((cat) => {
          const prods = catProducts(cat.id);
          if (prods.length === 0) return null;

          const s = catStats(prods);
          const isOpen = expanded[cat.id];

          return (
            <div key={cat.id} className="overflow-hidden rounded-[14px] border border-[#E2E7E2] bg-white shadow-[0_1px_2px_rgba(23,56,42,0.04)] transition-colors duration-200 hover:border-[#CBDED2]">
              {/* Category header */}
              <button onClick={() => toggle(cat.id)}
                className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[#FBFAF5]">
                <JewellerySwatch
                  variant={swatchVariantFor(cat.name)}
                  className="h-11 w-11 flex-shrink-0 rounded-[12px] border border-[#EFE6D2]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-semibold tracking-[-0.01em] text-[#17201C]">{cat.name}</span>
                    <span className="rounded-full border border-[#D3DCD5] bg-[#F1F4F0] px-2 py-0.5 text-[11px] tabular-nums text-[#6F7772]">{s.total} items</span>
                    {!isOutTab && s.lowStock > 0 && <span className="rounded-full border border-[#F0DFC2] bg-[#FBF4E3] px-2 py-0.5 text-[11px] tabular-nums text-[#B07C1E]">{s.lowStock} low</span>}
                    {isOutTab && s.sold > 0 && <span className="rounded-full border border-[#E8C9C5] bg-[#F9ECEA] px-2 py-0.5 text-[11px] tabular-nums text-[#9D4B47]">{s.sold} sold</span>}
                  </div>

                  {/* Stock distribution bar */}
                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[#F1F4F0]">
                      {s.total > 0 && <>
                        <div className="h-full bg-green-500" style={{ width: `${(s.available / s.total) * 100}%` }} />
                        <div className="h-full bg-[#D9A441]" style={{ width: `${(s.onDisplay / s.total) * 100}%` }} />
                        <div className="h-full bg-amber-400" style={{ width: `${(s.reserved / s.total) * 100}%` }} />
                        <div className="h-full bg-red-400" style={{ width: `${(s.damaged / s.total) * 100}%` }} />
                      </>}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3 text-[11px] text-[#6F7772]">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />{s.available} avail</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#D9A441]" />{s.onDisplay} display</span>
                      {s.reserved > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{s.reserved} reserved</span>}
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="hidden flex-shrink-0 items-center gap-6 text-right md:flex">
                  <div>
                    <div className="text-[11px] text-[#6F7772]">Net Weight</div>
                    <div className="text-[14px] font-semibold tabular-nums text-[#17201C]">{fmtWeight(s.netWt)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#6F7772]">In Stock</div>
                    <div className="text-[14px] font-semibold tabular-nums text-[#2F6B4F]">{s.totalQty}</div>
                  </div>
                </div>

                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[9px] border border-[#E2E7E2] bg-[#FBFAF5] text-[#6F7772]">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>

              {/* Expanded content — one summary card per sub-category (qty + purities); click to reveal tags */}
              {isOpen && (
                <div className="border-t border-[#E2E7E2]">
                  <SubCategoryGroups
                    prods={prods}
                    canEdit={canEdit}
                    groupPrefix={cat.id}
                    expandedSub={expandedSub}
                    toggleSub={toggleSub}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Uncategorized products */}
        {(() => {
          const knownCatIds = new Set(categories.map((c) => c.id));
          const uncat = products.filter((p) => !p.category_id || !knownCatIds.has(p.category_id));
          if (uncat.length === 0) return null;
          const s = catStats(uncat);
          const isOpen = expanded["__uncat__"];
          return (
            <div className="overflow-hidden rounded-[14px] border border-[#E2E7E2] bg-white shadow-[0_1px_2px_rgba(23,56,42,0.04)] transition-colors duration-200 hover:border-[#CBDED2]">
              <button onClick={() => toggle("__uncat__")}
                className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-[#FBFAF5]">
                <JewellerySwatch
                  variant="coin"
                  className="h-11 w-11 flex-shrink-0 rounded-[12px] border border-[#EFE6D2]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-semibold tracking-[-0.01em] text-[#17201C]">Uncategorized</span>
                    <span className="rounded-full border border-[#D3DCD5] bg-[#F1F4F0] px-2 py-0.5 text-[11px] tabular-nums text-[#6F7772]">{s.total} items</span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3">
                    <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[#F1F4F0]">
                      {s.total > 0 && <>
                        <div className="h-full bg-green-500" style={{ width: `${(s.available / s.total) * 100}%` }} />
                        <div className="h-full bg-[#D9A441]" style={{ width: `${(s.onDisplay / s.total) * 100}%` }} />
                        <div className="h-full bg-amber-400" style={{ width: `${(s.reserved / s.total) * 100}%` }} />
                        <div className="h-full bg-red-400" style={{ width: `${(s.damaged / s.total) * 100}%` }} />
                      </>}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-3 text-[11px] text-[#6F7772]">
                      <span>{s.totalQty} in stock</span>
                    </div>
                  </div>
                </div>
                <div className="hidden flex-shrink-0 items-center gap-6 text-right md:flex">
                  <div><div className="text-[11px] text-[#6F7772]">Net Weight</div><div className="text-[14px] font-semibold tabular-nums text-[#17201C]">{fmtWeight(s.netWt)}</div></div>
                  <div><div className="text-[11px] text-[#6F7772]">In Stock</div><div className="text-[14px] font-semibold tabular-nums text-[#2F6B4F]">{s.totalQty}</div></div>
                </div>
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[9px] border border-[#E2E7E2] bg-[#FBFAF5] text-[#6F7772]">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              </button>
              {isOpen && (
                <div className="border-t border-[#E2E7E2]">
                  <SubCategoryGroups
                    prods={uncat}
                    canEdit={canEdit}
                    groupPrefix="__uncat__"
                    expandedSub={expandedSub}
                    toggleSub={toggleSub}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {topCats.every((c) => catProducts(c.id).length === 0) && products.filter((p) => !p.category_id).length === 0 && (
          <div className="text-center py-16 text-[#6F7772]">
            <Package size={32} className="mx-auto mb-3 text-[#D3DCD5]" strokeWidth={1} />
            <div className="text-[13px]">No products match the selected filter</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   MAIN PAGE
═══════════════════════════════════════════════════════════════════════ */
export default function Inventory() {
  const { can } = useAuth();
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [metals, setMetals] = useState([]);
  const [purities, setPurities] = useState([]);
  const [loading, setLoading] = useState(true);

  /* filters */
  const [q, setQ] = useState("");
  const [categoryIds, setCategoryIds] = useState([]);
  const [metalIds, setMetalIds] = useState([]);
  const [purityIds, setPurityIds] = useState([]);
  const [weightAbove, setWeightAbove] = useState("");
  const [weightBelow, setWeightBelow] = useState("");
  const [status, setStatus] = useState("all");
  const [lowOnly, setLowOnly] = useState(false);
  const [stockTab, setStockTab] = useState("in_stock"); // in_stock | out_of_stock | pure
  const [reloadKey, setReloadKey] = useState(0);
  const pureAddRef = useRef(null);
  const importFileRef = useRef(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importProgress, setImportProgress] = useState(null);

  /* ── catalog bootstrap ── */
  useEffect(() => {
    Promise.all([
      api.get("/categories?include_tree=true"),
      api.get("/catalog/metal-types"),
      api.get("/catalog/purities"),
    ])
      .then(([{ data: cats }, { data: m }, { data: p }]) => {
        setCategories(cats);
        setMetals(m);
        setPurities(p);
      })
      .catch(() => {});
  }, []);

  /* ── product fetch ── */
  const load = () => {
    setLoading(true);
    const params = {};
    if (q) params.q = q;
    if (categoryIds.length) params.category_id = categoryIds.join(",");
    if (metalIds.length) params.metal_type_id = metalIds.join(",");
    if (purityIds.length) params.purity_id = purityIds.join(",");
    if (status !== "all") params.status = status;
    if (lowOnly) params.low_stock = true;
    api.get("/products", { params })
      .then(({ data }) => setProducts(Array.isArray(data) ? data : data?.items || []))
      .catch(() => setProducts([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [q, categoryIds, metalIds, purityIds, status, lowOnly, reloadKey]);

  useEffect(() => {
    const handler = (e) => {
      const t = e.detail?.type;
      if (t === 'product:changed' || t === 'invoice:created' || t === 'invoice:cancelled') setReloadKey((k) => k + 1);
    };
    window.addEventListener('realtime', handler);
    return () => window.removeEventListener('realtime', handler);
  }, []);

  const hasFilters = q || categoryIds.length || metalIds.length || purityIds.length || weightAbove !== "" || weightBelow !== "" || status !== "all" || lowOnly;

  /* ── weight-range filter (gross weight, grams) ──
   * Either field alone is an open-ended bound. With both filled, treat them
   * as a min/max pair regardless of which one is numerically larger — so
   * "Above 3g, Below 1g" still reads as "between 1g and 3g" rather than an
   * impossible (empty) range. */
  const weightFilteredProducts = useMemo(() => {
    const aboveNum = weightAbove !== "" ? Number(weightAbove) : null;
    const belowNum = weightBelow !== "" ? Number(weightBelow) : null;
    const hasAbove = aboveNum != null && Number.isFinite(aboveNum);
    const hasBelow = belowNum != null && Number.isFinite(belowNum);
    if (!hasAbove && !hasBelow) return products;
    const lo = hasAbove && hasBelow ? Math.min(aboveNum, belowNum) : (hasAbove ? aboveNum : null);
    const hi = hasAbove && hasBelow ? Math.max(aboveNum, belowNum) : (hasBelow ? belowNum : null);
    return products.filter((p) => {
      const w = Number(p.gross_weight) || 0;
      if (lo != null && w < lo) return false;
      if (hi != null && w > hi) return false;
      return true;
    });
  }, [products, weightAbove, weightBelow]);

  const inStockProducts = useMemo(
    () => weightFilteredProducts.filter((p) => !isOutOfStock(p)),
    [weightFilteredProducts],
  );
  const outOfStockProducts = useMemo(
    () => weightFilteredProducts.filter((p) => isOutOfStock(p)),
    [weightFilteredProducts],
  );
  const visibleProducts = stockTab === "out_of_stock" ? outOfStockProducts : inStockProducts;

  /* ── stats (live inventory only) ── */
  const stats = useMemo(() => {
    const total = inStockProducts.length;
    const totalItems = inStockProducts.reduce((s, p) => s + (p.stock_qty || 0), 0);
    const grossWt = inStockProducts.reduce((s, p) => s + weightContribution(p, "gross_weight"), 0);
    const netWt = inStockProducts.reduce((s, p) => s + weightContribution(p, "net_weight"), 0);
    return { total, totalItems, grossWt, netWt, outCount: outOfStockProducts.length };
  }, [inStockProducts, outOfStockProducts]);

  /* ── gross/net weight split by metal — Gold and Silver always shown (the
   * two metals every showroom deals in), any other metal type (e.g.
   * Platinum) only appears once the inventory actually holds some. */
  const weightByMetal = useMemo(() => {
    const map = new Map();
    for (const p of inStockProducts) {
      const key = (p.metal_name || "").trim() || "Other";
      if (!map.has(key)) map.set(key, { gross: 0, net: 0 });
      const entry = map.get(key);
      entry.gross += weightContribution(p, "gross_weight");
      entry.net += weightContribution(p, "net_weight");
    }
    for (const key of ["Gold", "Silver"]) {
      if (!map.has(key)) map.set(key, { gross: 0, net: 0 });
    }
    const order = ["Gold", "Silver", "Platinum"];
    return [...map.entries()]
      .sort(([a], [b]) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
      })
      .map(([name, w]) => ({ name, ...w }));
  }, [inStockProducts]);

  /* ── import CSV ── */
  const triggerImportCsv = () => importFileRef.current?.click();

  const handleImportCsvFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;

    setImportBusy(true);
    setImportProgress(emptyImportProgress());
    try {
      const csv = await file.text();
      const result = await importProductsFromCsv({
        csvText: csv,
        fileName: file.name,
        onProgress: setImportProgress,
      });
      const summary = formatImportSummary(result);
      if (result.errors.length) {
        toast.error(`${summary}. ${result.errors.length} error(s).`);
      } else {
        toast.success(`Import complete — ${summary}.`);
      }
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new CustomEvent("inventory:changed"));
    } catch (err) {
      setImportProgress(null);
      toast.error(formatApiError(err) || "Import failed. Check the file is the CSV exported from Inventory.");
    } finally {
      setImportBusy(false);
    }
  };

  /* ── export CSV ── */
  const exportCsv = () => {
    const header = INVENTORY_CSV_COLUMNS.map((c) => csvEscape(c.label)).join(",") + "\n";
    const rows = visibleProducts
      .map((p) => INVENTORY_CSV_COLUMNS.map((c) => csvEscape(c.value ? c.value(p) : p[c.key])).join(","))
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = stockTab === "out_of_stock" ? "out-of-stock.csv" : "inventory.csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success(stockTab === "out_of_stock" ? "Out of stock exported" : "Inventory exported");
  };

  const canEdit = can("inventory", "update") || can("inventory", "edit");
  const canImport = can("inventory", "create") || can("inventory", "import");
  const isPureTab = stockTab === "pure";

  return (
    <div className="max-w-[1400px] [&>div:first-child]:mb-5">
      {/* ── Hero: subtle jewellery banner behind the header, buttons untouched ── */}
      <section className="relative mb-5 overflow-hidden rounded-[18px] border border-[#E9E2D2] bg-[linear-gradient(115deg,#FDFCF8_0%,#FAF6EC_52%,#F3EBDC_100%)] px-5 py-5 shadow-[0_16px_40px_-32px_rgba(88,70,38,0.5)] sm:px-7 sm:py-6 [&>div:first-child]:mb-0">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(80%_130%_at_100%_50%,rgba(222,192,128,0.26),transparent_62%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-60 [background-image:repeating-linear-gradient(100deg,rgba(178,139,72,0.04)_0px,rgba(178,139,72,0.04)_1px,transparent_1px,transparent_9px)]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-[-1%] hidden w-[42%] lg:block xl:w-[38%]">
          <JewelleryBannerArt className="h-full w-full" />
        </div>
        <div className="relative z-10 lg:max-w-[58%]">
          <PageHeader
            title="Inventory"
            subtitle="Every piece in your showroom — catalogued, weighed and hallmarked."
            actions={
              <>
                {!isPureTab && canImport && (
                  <>
                    <input
                      ref={importFileRef}
                      type="file"
                      accept=".csv,text/csv,application/vnd.ms-excel"
                      className="hidden"
                      onChange={handleImportCsvFile}
                    />
                    <button className="btn-secondary" onClick={triggerImportCsv} disabled={importBusy}>
                      {importBusy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} strokeWidth={1.5} />}
                      {importBusy
                        ? `Importing ${importProgress?.percent ?? 0}%`
                        : "Import"}
                    </button>
                  </>
                )}
                {!isPureTab && (
                  <button className="btn-secondary" onClick={exportCsv}>
                    <Download size={14} strokeWidth={1.5} /> Export
                  </button>
                )}
                {can("inventory", "create") && (
                  isPureTab ? (
                    <button
                      type="button"
                      data-testid={T.inventoryAddBtn}
                      className="btn-primary"
                      onClick={() => pureAddRef.current?.()}
                    >
                      <Plus size={14} strokeWidth={1.5} /> Add Product
                    </button>
                  ) : (
                    <Link
                      to="/inventory/new"
                      data-testid={T.inventoryAddBtn}
                      className="btn-primary"
                    >
                      <Plus size={14} strokeWidth={1.5} /> Add Product
                    </Link>
                  )
                )}
              </>
            }
          />
        </div>
      </section>

      {/* ── Stats bar (jewellery tabs only) ── */}
      {!isPureTab && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {/* Total Products */}
        <div className="relative overflow-hidden rounded-[16px] border border-[#EADFC4] bg-[linear-gradient(150deg,#FFFCF5_0%,#FBF4E4_55%,#F6EBD6_100%)] p-4 shadow-[0_12px_28px_-22px_rgba(88,70,38,0.55)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_130%_at_92%_4%,rgba(217,164,65,0.14),transparent_62%)]" />
          <div className="relative z-10 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-[#E6D3A6] bg-[linear-gradient(140deg,#FAF0D6,#EFDDB2)]">
                <Box size={15} strokeWidth={1.6} className="text-[#9A6C25]" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9A855A]">Total Products</div>
                <div className="mt-1.5 font-display text-[24px] font-semibold leading-none tabular-nums text-[#2C2A24]">
                  {stats.total}
                </div>
              </div>
            </div>
            <MiniBars className="mt-1 h-7 w-9 flex-shrink-0 text-[#D9A441]/45" />
          </div>
          <div className="relative z-10 mt-2.5 text-[11px] text-[#8A8172]">All catalogued products</div>
        </div>

        {/* Total Items in Stock */}
        <div className="relative overflow-hidden rounded-[16px] border border-[#D8E7DA] bg-[linear-gradient(150deg,#F9FCF9_0%,#EFF6EF_55%,#E6F1E9_100%)] p-4 shadow-[0_12px_28px_-22px_rgba(40,72,58,0.5)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(110%_130%_at_92%_4%,rgba(47,107,79,0.12),transparent_62%)]" />
          <div className="relative z-10 flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-[#CFE2D5] bg-[linear-gradient(140deg,#E9F3EB,#D6E8DC)]">
                <Layers size={15} strokeWidth={1.6} className="text-[#2F6B4F]" />
              </span>
              <div className="min-w-0">
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5E7A68]">Total Items in Stock</div>
                <div className="mt-1.5 font-display text-[24px] font-semibold leading-none tabular-nums text-[#1E2A23]">
                  {stats.totalItems}
                </div>
              </div>
            </div>
            <MiniBars className="mt-1 h-7 w-9 flex-shrink-0 text-[#2F6B4F]/40" />
          </div>
          <div className="relative z-10 mt-2.5 text-[11px] text-[#75857B]">Available stock items</div>
        </div>

        {/* Total Gross Weight — gold bullion artwork */}
        <div className="relative overflow-hidden rounded-[16px] border border-[#E7D5AA] bg-[linear-gradient(150deg,#FEFBF4_0%,#FAF4E6_55%,#F3E7CF_100%)] p-4 shadow-[0_12px_28px_-22px_rgba(88,70,38,0.55)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_130%_at_100%_55%,rgba(214,168,74,0.2),transparent_64%)]" />
          <div className="relative z-10 flex items-center gap-2.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-[#E6D3A6] bg-[linear-gradient(140deg,#FAF0D6,#EFDDB2)]">
              <Scale size={15} strokeWidth={1.6} className="text-[#9A6C25]" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#9A855A]">Total Gross Weight</div>
            </div>
          </div>
          <div className="relative z-10 mt-2.5 space-y-1 pr-[40%]">
            {weightByMetal.map((m) => (
              <div key={m.name} className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] text-[#6F7671]">{m.name}</span>
                <span className="font-display text-[15px] font-semibold text-[#76581D] tabular-nums">
                  {fmtWeight(m.gross)}
                </span>
              </div>
            ))}
          </div>
          <span aria-hidden="true" className="pointer-events-none absolute -right-7 top-1/2 h-[168%] w-[37%] -translate-y-1/2">
            <BullionArt metal="gold" className="h-full w-full" />
          </span>
        </div>

        {/* Total Net Weight — silver bullion artwork */}
        <div className="relative overflow-hidden rounded-[16px] border border-[#D6E2EB] bg-[linear-gradient(150deg,#F9FCFD_0%,#EFF5F9_55%,#E7EFF5_100%)] p-4 shadow-[0_12px_28px_-22px_rgba(44,66,80,0.5)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_130%_at_100%_55%,rgba(126,158,175,0.18),transparent_64%)]" />
          <div className="relative z-10 flex items-center gap-2.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[11px] border border-[#CFDFEA] bg-[linear-gradient(140deg,#E8F0F7,#D6E4EE)]">
              <Feather size={15} strokeWidth={1.6} className="text-[#3E6474]" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5D7787]">Total Net Weight</div>
            </div>
          </div>
          <div className="relative z-10 mt-2.5 space-y-1 pr-[40%]">
            {weightByMetal.map((m) => (
              <div key={m.name} className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] text-[#6F7671]">{m.name}</span>
                <span className="font-display text-[15px] font-semibold text-[#49636E] tabular-nums">
                  {fmtWeight(m.net)}
                </span>
              </div>
            ))}
          </div>
          <span aria-hidden="true" className="pointer-events-none absolute -right-7 top-1/2 h-[168%] w-[37%] -translate-y-1/2">
            <BullionArt metal="silver" className="h-full w-full" />
          </span>
        </div>
      </div>
      )}

      {/* ── In Stock / Out of Stock / Pure tabs ── */}
      <div className="mb-4 flex items-center gap-1.5 border-b border-[#E2E7E2]">
        {[
          { key: "in_stock", label: "In Stock", count: stats.total, icon: Package },
          { key: "out_of_stock", label: "Out of Stock", count: stats.outCount, icon: Package },
          { key: "pure", label: "Pure", count: null, icon: Scale },
        ].map(({ key, label, count, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setStockTab(key);
              if (key === "out_of_stock") {
                setLowOnly(false);
                setStatus("all");
              }
            }}
            className={`relative -mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 pb-2.5 pt-2 text-[12.5px] font-medium transition-colors ${
              stockTab === key
                ? "border-[#214F3A] text-[#17382A]"
                : "border-transparent text-[#6F7772] hover:border-[#D3DCD5] hover:text-[#214F3A]"
            }`}
            data-testid={key === "pure" ? "inventory-pure-tab" : undefined}
          >
            <Icon size={13} strokeWidth={1.5} className={stockTab === key ? "text-[#214F3A]" : "text-[#89928C]"} />
            {label}
            {count != null && (
              <span
                className={`ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  stockTab === key
                    ? key === "out_of_stock"
                      ? "bg-[#F9ECEA] text-[#9D4B47]"
                      : "bg-[#EAF2ED] text-[#214F3A]"
                    : "bg-[#F1F4F0] text-[#6F7772]"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {isPureTab ? (
        <PureInventoryTab onAddClickRef={pureAddRef} />
      ) : (
      <>
      {/* ── Filter bar ── */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative min-w-[220px] max-w-md flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#89928C]"
            strokeWidth={1.5}
          />
          <input
            data-testid={T.inventorySearch}
            className="input pl-9"
            placeholder="Search by name, code or barcode"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {/* Category */}
        <FilterMultiSelect
          value={categoryIds}
          onChange={setCategoryIds}
          options={categories}
          placeholder="All categories"
          className="max-w-[170px]"
        />

        {/* Metal */}
        <FilterMultiSelect
          value={metalIds}
          onChange={setMetalIds}
          options={metals}
          placeholder="All metals"
          className="max-w-[150px]"
        />

        {/* Purity */}
        <FilterMultiSelect
          value={purityIds}
          onChange={setPurityIds}
          options={purities}
          placeholder="All purities"
          className="max-w-[140px]"
        />

        {/* Weight range (gross weight, grams) */}
        <input
          type="number"
          step="0.001"
          min="0"
          className="input max-w-[120px]"
          placeholder="Weight above (g)"
          value={weightAbove}
          onChange={(e) => setWeightAbove(e.target.value)}
        />
        <input
          type="number"
          step="0.001"
          min="0"
          className="input max-w-[120px]"
          placeholder="Weight below (g)"
          value={weightBelow}
          onChange={(e) => setWeightBelow(e.target.value)}
        />

        {/* Low stock toggle — only meaningful for in-stock items */}
        {stockTab === "in_stock" && (
          <button
            className={`btn-secondary ${lowOnly ? "!bg-[#EAF2ED] !border-[#CBDED2] !text-[#17382A]" : ""}`}
            onClick={() => setLowOnly(!lowOnly)}
          >
            <Filter size={14} strokeWidth={1.5} /> Low stock
          </button>
        )}
      </div>

      {/* ── Status pills (in-stock sellable statuses) ── */}
      {stockTab === "in_stock" && (
        <div className="flex items-center gap-1.5 mb-5 flex-wrap">
          {STATUS_PILLS.map((s) => {
            const active = status === s;
            const meta = STATUS_META[s];
            return (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1 rounded-full text-[12px] font-medium border transition-colors ${
                  active
                    ? "bg-[#214F3A] text-white border-[#214F3A] shadow-[0_1px_2px_rgba(23,56,42,0.12)]"
                    : "bg-[#FFFDF9] text-[#6F7772] border-[#E2E7E2] hover:border-[#CBDED2] hover:text-[#214F3A]"
                }`}
              >
                {meta ? meta.label : "All"}
              </button>
            );
          })}
        </div>
      )}

      {stockTab === "out_of_stock" && (
        <p className="mb-4 text-[12px] text-[#6F7772]">
          Sold out, Deleted P, and zero-quantity items. They stay here until restocked or restored.
        </p>
      )}

      {/* ── Content ── */}
      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <ListSkeleton rows={5} />
        </div>
      ) : visibleProducts.length === 0 ? (
        <EmptyState
          title={
            hasFilters
              ? "No products match your filters"
              : stockTab === "out_of_stock"
                ? "No out-of-stock items"
                : "No products in stock"
          }
          description={
            hasFilters
              ? "Try adjusting your search or filters."
              : stockTab === "out_of_stock"
                ? "Everything currently has stock."
                : "Add your first piece to get started."
          }
          icon={Sparkles}
          action={
            !hasFilters && stockTab === "in_stock" && can("inventory", "create") ? (
              <Link to="/inventory/new" className="btn-primary">
                <Plus size={14} strokeWidth={1.5} /> Add Product
              </Link>
            ) : null
          }
        />
      ) : (
        <CategoryOverview
          products={visibleProducts}
          categories={categories}
          canEdit={canEdit}
          stockTab={stockTab}
        />
      )}
      </>
      )}

      <ImportProgressModal
        open={Boolean(importProgress)}
        progress={importProgress}
        onClose={() => setImportProgress(null)}
      />
    </div>
  );
}
