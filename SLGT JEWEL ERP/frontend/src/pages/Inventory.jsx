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
  INVENTORY_CSV_COLUMNS,
  csvEscape,
  emptyImportProgress,
  formatImportSummary,
  importProductsFromCsv,
} from "@/lib/productCsvImport";

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
      className="flex items-center gap-2.5 p-2.5 rounded-lg border border-[#E5E7EB] hover:border-[#0A0A0A] hover:bg-[#FAFAFA] transition-colors group">
      {/* Icon */}
      <div className="h-12 w-12 rounded-md bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-center flex-shrink-0">
        <Sparkles size={12} className="text-[#d4d4d8]" strokeWidth={1.5} />
      </div>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-medium text-[#0A0A0A] truncate leading-tight">{productLabel}</div>
        <div className="text-[10.5px] text-[#a3a3a3] font-mono">{p.code || "—"}</div>
        <div className="flex items-center gap-1.5 mt-1">
          {p.purity_name && <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">{p.purity_name}</span>}
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${isOut ? "bg-red-50 text-red-700" : isLow ? "bg-amber-50 text-amber-700" : "bg-green-50 text-green-700"}`}>
            {isOut
              ? (statusLabel && statusLabel !== "Available" ? statusLabel : "Out")
              : `${p.stock_qty} pcs`}
          </span>
        </div>
        <div className="text-[10.5px] text-[#737373] mt-0.5">
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
          <div key={subKey} className="border border-[#E5E7EB] rounded-lg overflow-hidden">
            <button onClick={() => toggleSub(subKey)}
              className="w-full flex items-center gap-3 p-3 hover:bg-[#FAFAFA] transition-colors text-left">
              <div className="h-10 w-10 rounded-md bg-[#F9FAFB] border border-[#E5E7EB] flex items-center justify-center flex-shrink-0">
                <Sparkles size={14} className="text-[#d4d4d8]" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[#0A0A0A] truncate">{g.label}</div>
                {g.purities.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    {g.purities.map((pu) => (
                      <span key={pu} className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded font-medium">{pu}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[13px] font-semibold text-[#0A0A0A] tabular-nums">{g.totalQty} pcs</div>
                <div className="text-[10.5px] text-[#737373]">{g.prods.length} tag{g.prods.length === 1 ? "" : "s"}</div>
              </div>
              {isSubOpen ? <ChevronDown size={14} className="text-[#737373] flex-shrink-0" /> : <ChevronRight size={14} className="text-[#737373] flex-shrink-0" />}
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

  return (
    <div>
      {/* Overall summary bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {(isOutTab
          ? [
              { label: "Out of Stock", val: overallStats.total, color: "text-red-600" },
              { label: "Sold out", val: overallStats.sold, color: "text-[#0A0A0A]" },
              { label: "Deleted P", val: overallStats.deletedP, color: "text-[#737373]" },
              { label: "Zero Qty", val: overallStats.outOfStock, color: "text-red-600" },
              { label: "Damaged", val: overallStats.damaged, color: "text-amber-600" },
            ]
          : [
              { label: "Categories", val: topCats.length, color: "text-[#0A0A0A]" },
              { label: "In Stock Products", val: overallStats.total, color: "text-[#0A0A0A]" },
              { label: "Pieces", val: overallStats.totalQty, color: "text-green-700" },
              { label: "Low Stock", val: overallStats.lowStock, color: "text-amber-600" },
              { label: "Available", val: overallStats.available, color: "text-green-700" },
            ]
        ).map((s) => (
          <div key={s.label} className="card !p-3 text-center">
            <div className={`font-display text-[22px] font-bold tabular-nums ${s.color}`}>{s.val}</div>
            <div className="text-[11px] text-[#737373] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category cards */}
      <div className="space-y-3">
        {topCats.map((cat) => {
          const prods = catProducts(cat.id);
          if (prods.length === 0) return null;

          const s = catStats(prods);
          const isOpen = expanded[cat.id];

          return (
            <div key={cat.id} className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
              {/* Category header */}
              <button onClick={() => toggle(cat.id)}
                className="w-full flex items-center gap-4 p-5 hover:bg-[#FAFAFA] transition-colors text-left">
                <div className="h-10 w-10 rounded-lg bg-[#FDFBF7] border border-[#EADFBF] flex items-center justify-center flex-shrink-0">
                  <Layers size={18} className="text-[#B49042]" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[15px] text-[#0A0A0A]">{cat.name}</span>
                    <span className="text-[11px] text-[#737373] bg-[#F3F4F6] px-2 py-0.5 rounded-full">{s.total} items</span>
                    {!isOutTab && s.lowStock > 0 && <span className="text-[11px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">{s.lowStock} low</span>}
                    {isOutTab && s.sold > 0 && <span className="text-[11px] text-red-700 bg-red-50 px-2 py-0.5 rounded-full">{s.sold} sold</span>}
                  </div>

                  {/* Stock distribution bar */}
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden flex">
                      {s.total > 0 && <>
                        <div className="bg-green-500 h-full" style={{ width: `${(s.available / s.total) * 100}%` }} />
                        <div className="bg-[#B49042] h-full" style={{ width: `${(s.onDisplay / s.total) * 100}%` }} />
                        <div className="bg-amber-400 h-full" style={{ width: `${(s.reserved / s.total) * 100}%` }} />
                        <div className="bg-red-400 h-full" style={{ width: `${(s.damaged / s.total) * 100}%` }} />
                      </>}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[#737373] flex-shrink-0">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-500" />{s.available} avail</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#B49042]" />{s.onDisplay} display</span>
                      {s.reserved > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{s.reserved} reserved</span>}
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="hidden md:flex items-center gap-6 flex-shrink-0 text-right">
                  <div>
                    <div className="text-[11px] text-[#737373]">Net Weight</div>
                    <div className="text-[14px] font-semibold text-[#0A0A0A] tabular-nums">{fmtWeight(s.netWt)}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-[#737373]">In Stock</div>
                    <div className="text-[14px] font-semibold text-green-700 tabular-nums">{s.totalQty}</div>
                  </div>
                </div>

                {isOpen ? <ChevronDown size={16} className="text-[#737373] flex-shrink-0" /> : <ChevronRight size={16} className="text-[#737373] flex-shrink-0" />}
              </button>

              {/* Expanded content — one summary card per sub-category (qty + purities); click to reveal tags */}
              {isOpen && (
                <div className="border-t border-[#E5E7EB]">
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
            <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
              <button onClick={() => toggle("__uncat__")}
                className="w-full flex items-center gap-4 p-5 hover:bg-[#FAFAFA] transition-colors text-left">
                <div className="h-10 w-10 rounded-lg bg-[#FDFBF7] border border-[#EADFBF] flex items-center justify-center flex-shrink-0">
                  <Layers size={18} className="text-[#B49042]" strokeWidth={1.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[15px] text-[#0A0A0A]">Uncategorized</span>
                    <span className="text-[11px] text-[#737373] bg-[#F3F4F6] px-2 py-0.5 rounded-full">{s.total} items</span>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden flex">
                      {s.total > 0 && <>
                        <div className="bg-green-500 h-full" style={{ width: `${(s.available / s.total) * 100}%` }} />
                        <div className="bg-[#B49042] h-full" style={{ width: `${(s.onDisplay / s.total) * 100}%` }} />
                        <div className="bg-amber-400 h-full" style={{ width: `${(s.reserved / s.total) * 100}%` }} />
                        <div className="bg-red-400 h-full" style={{ width: `${(s.damaged / s.total) * 100}%` }} />
                      </>}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[#737373] flex-shrink-0">
                      <span>{s.totalQty} in stock</span>
                    </div>
                  </div>
                </div>
                <div className="hidden md:flex items-center gap-6 flex-shrink-0 text-right">
                  <div><div className="text-[11px] text-[#737373]">Net Weight</div><div className="text-[14px] font-semibold text-[#0A0A0A] tabular-nums">{fmtWeight(s.netWt)}</div></div>
                  <div><div className="text-[11px] text-[#737373]">In Stock</div><div className="text-[14px] font-semibold text-green-700 tabular-nums">{s.totalQty}</div></div>
                </div>
                {isOpen ? <ChevronDown size={16} className="text-[#737373] flex-shrink-0" /> : <ChevronRight size={16} className="text-[#737373] flex-shrink-0" />}
              </button>
              {isOpen && (
                <div className="border-t border-[#E5E7EB]">
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
          <div className="text-center py-16 text-[#737373]">
            <Package size={32} className="mx-auto mb-3 text-[#d4d4d8]" strokeWidth={1} />
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
    <div className="max-w-[1400px]">
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

      {/* ── Stats bar (jewellery tabs only) ── */}
      {!isPureTab && (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="card">
          <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">
            Total Products
          </div>
          <div className="font-display text-[24px] font-semibold text-[#0A0A0A] mt-2 tabular-nums">
            {stats.total}
          </div>
        </div>
        <div className="card">
          <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">
            Total Items in Stock
          </div>
          <div className="font-display text-[24px] font-semibold text-[#0A0A0A] mt-2 tabular-nums">
            {stats.totalItems}
          </div>
        </div>
        <div className="card">
          <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">
            Total Gross Weight
          </div>
          <div className="mt-2 space-y-1">
            {weightByMetal.map((m) => (
              <div key={m.name} className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] text-[#737373]">{m.name}</span>
                <span className="font-display text-[16px] font-semibold text-[#0A0A0A] tabular-nums">
                  {fmtWeight(m.gross)}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">
            Total Net Weight
          </div>
          <div className="mt-2 space-y-1">
            {weightByMetal.map((m) => (
              <div key={m.name} className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] text-[#737373]">{m.name}</span>
                <span className="font-display text-[16px] font-semibold text-[#0A0A0A] tabular-nums">
                  {fmtWeight(m.net)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* ── In Stock / Out of Stock / Pure tabs ── */}
      <div className="flex items-center gap-1 mb-4 border-b border-[#E5E7EB]">
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
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[12.5px] font-medium whitespace-nowrap border-b-2 transition-colors ${
              stockTab === key
                ? "border-[#B49042] text-[#B49042]"
                : "border-transparent text-[#737373] hover:text-[#0A0A0A]"
            }`}
            data-testid={key === "pure" ? "inventory-pure-tab" : undefined}
          >
            <Icon size={13} strokeWidth={1.5} />
            {label}
            {count != null && (
              <span
                className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  stockTab === key
                    ? key === "out_of_stock"
                      ? "bg-red-50 text-red-700"
                      : "bg-[#FDFBF7] text-[#7a5e26]"
                    : "bg-[#F3F4F6] text-[#737373]"
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
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]"
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
            className={`btn-secondary ${lowOnly ? "!bg-[#FDFBF7] !border-[#EADFBF] !text-[#7a5e26]" : ""}`}
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
                    ? "bg-[#0A0A0A] text-white border-[#0A0A0A]"
                    : "bg-white text-[#525252] border-[#E5E7EB] hover:border-[#0A0A0A] hover:text-[#0A0A0A]"
                }`}
              >
                {meta ? meta.label : "All"}
              </button>
            );
          })}
        </div>
      )}

      {stockTab === "out_of_stock" && (
        <p className="mb-4 text-[12px] text-[#737373]">
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
