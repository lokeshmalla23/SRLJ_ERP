import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TableSkeleton, ListSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  Layers,
  Sparkles,
  Tag,
  Coins,
  Gem,
  Ruler,
  Percent,
  ListTree,
  LayoutGrid,
  Plus,
  X,
  Pencil,
  Trash2,
} from "lucide-react";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import MoneyInput from "@/components/ui/MoneyInput";
import { asArray, asObject } from "@/lib/jsonFields";
import { parseMoneyInput } from "@/lib/format";
import useConfirm from "@/hooks/useConfirm";

const KIND_META = {
  categories: { title: "Categories & Sub-categories", icon: ListTree, testId: "catalog-tab-categories" },
  counters: { title: "Category Counters", icon: LayoutGrid, testId: "catalog-tab-counters" },
  collections: { title: "Collections", icon: Sparkles, testId: "catalog-tab-collections" },
  tags: { title: "Tags", icon: Tag, testId: "catalog-tab-tags" },
  "metal-types": { title: "Metal Types", icon: Coins, testId: "catalog-tab-metals" },
  "stone-types": { title: "Stone Types", icon: Gem, testId: "catalog-tab-stones" },
  purities: { title: "Purities", icon: Percent, testId: "catalog-tab-purities" },
  units: { title: "Units", icon: Ruler, testId: "catalog-tab-units" },
};
const TABS = Object.keys(KIND_META);

export default function Catalog() {
  const [tab, setTab] = useState("categories");
  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Catalog"
        subtitle="The master library of your showroom. Everything here powers Inventory, POS and Reports."
      />

      {/* ── Horizontal tab bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 border-b border-[#E5E7EB] mb-6 overflow-x-auto">
        {TABS.map((t) => {
          const meta = KIND_META[t];
          const Icon = meta.icon;
          const active = tab === t;
          return (
            <button
              key={t}
              data-testid={meta.testId}
              onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-medium border-b-2 whitespace-nowrap transition-colors ${
                active
                  ? "border-[#B49042] text-[#0A0A0A]"
                  : "border-transparent text-[#737373] hover:text-[#0A0A0A] hover:border-[#E5E7EB]"
              }`}
            >
              <Icon size={13} strokeWidth={1.5} className={active ? "text-[#B49042]" : "text-[#a3a3a3]"} />
              {meta.title}
            </button>
          );
        })}
      </div>

      {/* ── Panel ────────────────────────────────────────────────────────────── */}
      {tab === "categories" ? (
        <CategoriesPanel />
      ) : tab === "counters" ? (
        <CountersPanel />
      ) : (
        <LookupPanel kind={tab} title={KIND_META[tab].title} />
      )}
    </div>
  );
}

/* ============================== CATEGORIES ============================== */
function CategoriesPanel() {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [openNew, setOpenNew] = useState(null); // null | {parent_id?}
  const [metalTypes, setMetalTypes] = useState([]);
  const [counters, setCounters] = useState([]);
  const [confirm, confirmModal] = useConfirm();

  const load = () => {
    setLoading(true);
    api.get("/categories?include_tree=true")
      .then(({ data }) => setTree(data))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    api.get("/catalog/metal-types").then(({ data }) => setMetalTypes(data)).catch(() => {});
    api.get("/settings/counters").then(({ data }) => {
      setCounters(Array.isArray(data?.data) ? data.data : []);
    }).catch(() => {});
  }, []);

  const remove = async (id) => {
    if (!(await confirm("Delete this category?"))) return;
    try {
      await api.delete(`/categories/${id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="section-title">Category Hierarchy</div>
          <div className="text-[12px] text-[#737373] mt-0.5">
            Build two-level categories exactly as your business is organised. Allocate each to a showcase counter.
          </div>
        </div>
        <button
          onClick={() => setOpenNew({})}
          data-testid="catalog-add-category-btn"
          className="btn-primary"
        >
          <Plus size={14} strokeWidth={1.5} /> New category
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <ListSkeleton rows={5} />
        </div>
      ) : tree.length === 0 ? (
        <EmptyState title="No categories yet" description="Start by creating a top-level category like Rings, Necklaces or Bangles." />
      ) : (
        <div className="space-y-3">
          {tree.map((cat) => (
            <div key={cat.id} className="card !p-0 overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-md bg-[#FDFBF7] border border-[#EADFBF] flex items-center justify-center">
                    <Layers size={14} strokeWidth={1.5} className="text-[#B49042]" />
                  </div>
                  <div>
                    <div className="font-display text-[15px] font-medium">{cat.name}</div>
                    <div className="text-[11.5px] text-[#737373]">
                      {cat.children.length} sub-categor{cat.children.length === 1 ? "y" : "ies"}
                      {(() => {
                        const cn = counters.find((c) => c.id === cat.counter_id)?.name;
                        return cn ? ` · Showcase: ${cn}` : "";
                      })()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button className="btn-secondary !py-1 !text-[12px]" onClick={() => setOpenNew({ parent_id: cat.id })}>
                    <Plus size={12} strokeWidth={1.5} /> Sub-category
                  </button>
                  <button className="p-1.5 text-[#737373] hover:text-[#0A0A0A]" onClick={() => setEditing(cat)}>
                    <Pencil size={13} strokeWidth={1.5} />
                  </button>
                  <button className="p-1.5 text-[#737373] hover:text-[#991B1B]" onClick={() => remove(cat.id)}>
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                </div>
              </div>
              {cat.children.length > 0 && (
                <div className="border-t border-[#E5E7EB] bg-[#FAFAFA] px-5 py-3">
                  <div className="flex flex-wrap gap-2">
                    {cat.children.map((sc) => (
                      <div
                        key={sc.id}
                        className={`group inline-flex items-center gap-2 bg-white border rounded-full pl-3 pr-1 py-1 text-[12.5px] ${
                          sc.is_low_stock ? "border-amber-300 bg-amber-50" : "border-[#E5E7EB]"
                        }`}
                      >
                        <span>{sc.name}</span>
                        <span className={`text-[10.5px] font-mono ${sc.is_low_stock ? "text-amber-700" : "text-[#a3a3a3]"}`}>
                          {Number(sc.stock_qty) || 0} pcs
                          {sc.low_stock_threshold != null && Number(sc.low_stock_threshold) > 0
                            ? ` · ≤${sc.low_stock_threshold}`
                            : ""}
                        </span>
                        <button
                          onClick={() => setEditing(sc)}
                          className="p-1 rounded-full text-[#737373] hover:text-[#0A0A0A] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Pencil size={11} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => remove(sc.id)}
                          className="p-1 rounded-full text-[#737373] hover:text-[#991B1B] opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 size={11} strokeWidth={1.5} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(openNew || editing) && (
        <CategoryModal
          initial={editing || (openNew?.parent_id ? {
            parent_id: openNew.parent_id,
            counter_id: tree.find((c) => c.id === openNew.parent_id)?.counter_id || "",
          } : {})}
          metalTypes={metalTypes}
          counters={counters}
          onClose={() => {
            setOpenNew(null);
            setEditing(null);
          }}
          onSaved={() => {
            load();
            setOpenNew(null);
            setEditing(null);
          }}
        />
      )}
      {confirmModal}
    </div>
  );
}

/* ============================== BILLING COUNTERS ============================== */
function CountersPanel() {
  const [rows, setRows] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [openNew, setOpenNew] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const load = () => {
    setLoading(true);
    Promise.all([
      api.get("/settings/counters"),
      api.get("/categories"),
    ])
      .then(([counterRes, catRes]) => {
        setRows(Array.isArray(counterRes.data?.data) ? counterRes.data.data : []);
        setCategories(Array.isArray(catRes.data) ? catRes.data : []);
      })
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const persist = async (next) => {
    const { data } = await api.put("/settings/counters", { counters: next });
    const saved = Array.isArray(data?.data) ? data.data : next;
    setRows(saved);
    return saved;
  };

  const saveOne = async (form, initial) => {
    const name = String(form.name || "").trim();
    const code = String(form.code || "").trim();
    if (!name) throw new Error("Counter name is required");

    let next;
    if (initial?.id) {
      next = rows.map((r) => (
        r.id === initial.id
          ? { ...r, name, code: code || null, is_default: Boolean(form.is_default) }
          : r
      ));
      if (form.is_default) {
        next = next.map((r) => ({ ...r, is_default: r.id === initial.id }));
      }
    } else {
      const makeDefault = Boolean(form.is_default) || rows.length === 0;
      next = [...rows, { name, code: code || null, is_default: makeDefault }];
      if (makeDefault) {
        next = next.map((r, i) => ({ ...r, is_default: i === next.length - 1 }));
      }
    }
    if (next.length && !next.some((r) => r.is_default)) next[0].is_default = true;
    await persist(next);
  };

  const remove = async (id) => {
    if (!(await confirm("Delete this counter?"))) return;
    try {
      let next = rows.filter((r) => r.id !== id);
      if (next.length && !next.some((r) => r.is_default)) next[0].is_default = true;
      await persist(next);
      toast.success("Counter deleted");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="section-title">Category Counters</div>
          <div className="text-[12px] text-[#737373] mt-0.5">
            Physical showcases in the shop. Assign a category (e.g. Rings) to a counter so its items sit there.
          </div>
        </div>
        <button
          onClick={() => setOpenNew(true)}
          data-testid="catalog-add-counter-btn"
          className="btn-primary"
        >
          <Plus size={14} strokeWidth={1.5} /> New counter
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <TableSkeleton rows={4} cols={5} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No category counters yet" description="Create a showcase counter (e.g. Rings Counter), then allocate categories to it." />
      ) : (
        <div className="table-shell">
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Name</th>
                <th className="table-th">Code</th>
                <th className="table-th">Categories</th>
                <th className="table-th">Default</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="table-td font-medium">{r.name}</td>
                  <td className="table-td font-mono text-[12px] text-[#525252]">{r.code || "—"}</td>
                  <td className="table-td text-[12.5px] text-[#525252]">
                    {(() => {
                      const names = categories
                        .filter((c) => !c.parent_id && c.counter_id === r.id)
                        .map((c) => c.name);
                      return names.length ? names.join(", ") : <span className="text-[#a3a3a3]">None allocated</span>;
                    })()}
                  </td>
                  <td className="table-td">
                    {r.is_default ? <span className="chip chip-gold">Default</span> : <span className="text-[#a3a3a3]">—</span>}
                  </td>
                  <td className="table-td text-right">
                    <button className="p-1.5 text-[#737373] hover:text-[#0A0A0A]" onClick={() => setEditing(r)}>
                      <Pencil size={13} strokeWidth={1.5} />
                    </button>
                    <button className="p-1.5 text-[#737373] hover:text-[#991B1B]" onClick={() => remove(r.id)}>
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(openNew || editing) && (
        <CounterModal
          initial={editing || {}}
          onClose={() => {
            setEditing(null);
            setOpenNew(false);
          }}
          onSaved={async (form, initial) => {
            await saveOne(form, initial);
            toast.success(initial?.id ? "Counter updated" : "Counter created");
            setEditing(null);
            setOpenNew(false);
          }}
        />
      )}
      {confirmModal}
    </div>
  );
}

function CounterModal({ initial, onClose, onSaved }) {
  const editing = Boolean(initial.id);
  const [form, setForm] = useState({
    name: initial.name || "",
    code: initial.code || "",
    is_default: Boolean(initial.is_default),
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSaved(form, initial);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="section-title">{editing ? "Edit category counter" : "New category counter"}</div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <F label="Name">
            <input
              required
              data-testid="counter-name-input"
              className="input"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Rings Showcase"
            />
          </F>
          <F label="Code" hint="Short code for reports (e.g. RNG, C1)">
            <input
              className="input font-mono uppercase"
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
              placeholder="e.g. C1"
              maxLength={8}
            />
          </F>
          <label className="flex items-center gap-2 text-[12.5px] text-[#525252]">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => set("is_default", e.target.checked)}
              className="h-4 w-4 rounded border-[#d4d4d8] text-[#0A0A0A]"
            />
            Default showcase (used if a category has no counter)
          </label>
        </div>
        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" data-testid="counter-save-btn" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function CategoryModal({ initial, metalTypes = [], counters = [], onClose, onSaved }) {
  const editing = Boolean(initial.id);
  const isSubcategory = Boolean(initial.parent_id);
  const [form, setForm] = useState({
    name: initial.name || "",
    description: initial.description || "",
    parent_id: initial.parent_id || null,
    code_prefix: initial.code_prefix || "",
    default_metal_type_id: initial.default_metal_type_id || "",
    default_wastage_pct: initial.default_wastage_pct ?? "",
    default_making_charge: initial.default_making_charge ?? "",
    default_making_charge_type: initial.default_making_charge_type || "percentage",
    low_stock_threshold: initial.low_stock_threshold ?? "",
    counter_id: initial.counter_id || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      // Empty strings must never be sent for numeric columns — the backend's
      // wastage/making-charge fields are FLOAT and reject "" outright.
      const payload = {
        ...form,
        default_wastage_pct: form.default_wastage_pct === "" ? null : Number(form.default_wastage_pct),
        default_making_charge: form.default_making_charge === "" ? null : parseMoneyInput(form.default_making_charge),
        default_making_charge_type: form.default_making_charge_type || "percentage",
        low_stock_threshold: form.low_stock_threshold === "" || form.low_stock_threshold == null
          ? null
          : Number(form.low_stock_threshold),
        counter_id: form.counter_id || null,
      };
      if (editing) await api.patch(`/categories/${initial.id}`, payload);
      else await api.post("/categories", payload);
      toast.success(editing ? "Category updated" : "Category created");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between shrink-0">
          <div className="section-title">
            {editing ? "Edit" : form.parent_id ? "New sub-category" : "New category"}
          </div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">
          {!isSubcategory && (
            <F label="Metal Type">
              <select
                className="input"
                value={form.default_metal_type_id}
                onChange={(e) => set("default_metal_type_id", e.target.value)}
              >
                <option value="">Select metal type</option>
                {metalTypes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </F>
          )}
          <F label={isSubcategory ? "Sub-category Name" : "Name"}>
            <input required data-testid="category-name-input" className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </F>
            <F
              label="Category Counter"
              required={counters.length > 0}
              hint="Showcase this category is displayed on. Items added under it are stocked at this counter."
            >
            <select
              className="input"
              value={form.counter_id || ""}
              onChange={(e) => set("counter_id", e.target.value)}
              required={counters.length > 0}
            >
              <option value="">{counters.length ? "Select category counter" : "— None —"}</option>
              {counters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.code ? ` (${c.code})` : ""}</option>
              ))}
            </select>
          </F>
          {isSubcategory && (
            <F
              label="Low Stock Threshold"
              hint="Alert when total pieces under this sub-category fall to this number or below"
            >
              <input
                type="text"
                inputMode="decimal"
                min="0"
                step="1"
                className="input no-spinner font-mono"
                value={form.low_stock_threshold}
                onChange={(e) => set("low_stock_threshold", e.target.value === "" ? "" : e.target.value)}
                placeholder="e.g. 3"
              />
            </F>
          )}
          {!isSubcategory && (
            <>
              <F label="Description">
                <input className="input" value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
              </F>
              <F label="Product Code Prefix" hint="Used to auto-generate barcodes in Inventory (e.g. RNG, NCK, EAR)">
                <input
                  className="input font-mono uppercase"
                  value={form.code_prefix}
                  onChange={(e) => set("code_prefix", e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                  placeholder="e.g. RNG"
                  maxLength={6}
                />
              </F>
            </>
          )}

          {/* Default Charges section */}
          <div className="border-t border-[#E5E7EB] pt-3 mt-3">
            <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-2.5">
              Default Charges <span className="text-[#a3a3a3] font-normal normal-case tracking-normal">— auto-fill in Inventory</span>
            </div>
            <div className="space-y-3">
              <F label="Default Wastage">
                <div className="flex items-center gap-2">
                  <input
                    type="text" inputMode="decimal"
                    min="0"
                    max="100"
                    step="0.01"
                    className="input no-spinner"
                    value={form.default_wastage_pct}
                    onChange={(e) => set("default_wastage_pct", e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="e.g. 5"
                  />
                  <span className="text-[12px] text-[#737373] font-medium shrink-0">%</span>
                </div>
              </F>
              <F label="Default Making Charge">
                <MoneyInput
                  min="0"
                  step="0.01"
                  className="input no-spinner"
                  value={form.default_making_charge}
                  onValueChange={(raw) => set("default_making_charge", raw)}
                  placeholder="e.g. 500"
                />
              </F>
              <F label="Making Charge Type">
                <select
                  className="input"
                  value={form.default_making_charge_type}
                  onChange={(e) => set("default_making_charge_type", e.target.value)}
                >
                  <option value="percentage">% of gold value</option>
                  <option value="per_gram">₹ per gram</option>
                  <option value="fixed">Fixed ₹ per piece</option>
                </select>
              </F>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" data-testid="category-save-btn" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================== ATTRIBUTES ============================== */
const FIELD_TYPES = [
  { value: "text", label: "Text field" },
  { value: "number", label: "Number field" },
  { value: "dropdown", label: "Dropdown" },
  { value: "multiselect", label: "Multi-select" },
  { value: "date", label: "Date picker" },
  { value: "boolean", label: "Boolean switch" },
  { value: "image", label: "Image upload" },
  { value: "color", label: "Color picker" },
  { value: "price", label: "Price" },
  { value: "weight", label: "Weight" },
];

function AttributesPanel() {
  const [attributes, setAttributes] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [openNew, setOpenNew] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const load = async () => {
    setLoading(true);
    try {
      const [{ data: a }, { data: c }] = await Promise.all([
        api.get("/attributes"),
        api.get("/categories"),
      ]);
      setAttributes(a);
      setCategories(c);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id) => {
    if (!(await confirm("Delete this attribute?"))) return;
    try {
      await api.delete(`/attributes/${id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const catName = (id) => categories.find((c) => c.id === id)?.name || id;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="section-title">Custom Attributes</div>
          <div className="text-[12px] text-[#737373] mt-0.5">
            Fields like Ring Size, Stone Type, Length — attach them to categories to make Product forms adaptive.
          </div>
        </div>
        <button
          onClick={() => setOpenNew(true)}
          data-testid="catalog-add-attribute-btn"
          className="btn-primary"
        >
          <Plus size={14} strokeWidth={1.5} /> New attribute
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <TableSkeleton rows={5} cols={5} />
        </div>
      ) : attributes.length === 0 ? (
        <EmptyState title="No attributes yet" description="Add fields like Ring Size or Stone Type to enrich your product catalog." />
      ) : (
        <div className="table-shell">
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Name</th>
                <th className="table-th">Code</th>
                <th className="table-th">Type</th>
                <th className="table-th">Categories</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {attributes.map((a) => (
                <tr key={a.id} className="table-row">
                  <td className="table-td font-medium">{a.name}</td>
                  <td className="table-td font-mono text-[12px] text-[#525252]">{a.code}</td>
                  <td className="table-td">
                    <span className="chip chip-neutral capitalize">{a.field_type}</span>
                    {asArray(a.options).length > 0 && (
                      <span className="ml-2 text-[11px] text-[#737373]">{asArray(a.options).length} option{asArray(a.options).length === 1 ? "" : "s"}</span>
                    )}
                  </td>
                  <td className="table-td text-[12.5px] text-[#525252]">
                    {a.category_ids && a.category_ids.length > 0 ? (
                      <span>{a.category_ids.map(catName).join(", ")}</span>
                    ) : (
                      <span className="text-[#a3a3a3]">Global</span>
                    )}
                  </td>
                  <td className="table-td text-right">
                    <button className="p-1.5 text-[#737373] hover:text-[#0A0A0A]" onClick={() => setEditing(a)}>
                      <Pencil size={13} strokeWidth={1.5} />
                    </button>
                    <button className="p-1.5 text-[#737373] hover:text-[#991B1B]" onClick={() => remove(a.id)}>
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(openNew || editing) && (
        <AttributeModal
          initial={editing || {}}
          categories={categories}
          onClose={() => {
            setEditing(null);
            setOpenNew(false);
          }}
          onSaved={() => {
            load();
            setEditing(null);
            setOpenNew(false);
          }}
        />
      )}
      {confirmModal}
    </div>
  );
}

function AttributeModal({ initial, categories, onClose, onSaved }) {
  const editing = Boolean(initial.id);
  const [form, setForm] = useState({
    name: initial.name || "",
    code: initial.code || "",
    field_type: initial.field_type || "text",
    options: asArray(initial.options),
    required: initial.required || false,
    unit: initial.unit || "",
    category_ids: initial.category_ids || [],
    display_order: initial.display_order || 0,
    help_text: initial.help_text || "",
  });
  const [optDraft, setOptDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const toggleCat = (id) => {
    set("category_ids", form.category_ids.includes(id) ? form.category_ids.filter((x) => x !== id) : [...form.category_ids, id]);
  };
  const addOption = (e) => {
    e.preventDefault();
    if (!optDraft.trim()) return;
    set("options", [...form.options, optDraft.trim()]);
    setOptDraft("");
  };
  const removeOption = (i) => set("options", form.options.filter((_, idx) => idx !== i));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = { ...form };
      if (!payload.code) payload.code = payload.name.toLowerCase().replace(/[^a-z0-9]+/g, "_");
      if (editing) await api.patch(`/attributes/${initial.id}`, payload);
      else await api.post("/attributes", payload);
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  const hasOptions = ["dropdown", "multiselect"].includes(form.field_type);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between sticky top-0 bg-white">
          <div className="section-title">{editing ? "Edit attribute" : "New attribute"}</div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <F label="Name">
              <input required data-testid="attribute-name-input" className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
            </F>
            <F label="Code (auto-slug if blank)">
              <input className="input font-mono" value={form.code} onChange={(e) => set("code", e.target.value)} />
            </F>
            <F label="Field type">
              <select data-testid="attribute-type-select" className="input" value={form.field_type} onChange={(e) => set("field_type", e.target.value)}>
                {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </F>
            <F label="Unit (optional)">
              <input className="input" value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="mm, g, in" />
            </F>
          </div>

          {hasOptions && (
            <div>
              <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">Options</div>
              <div className="flex flex-wrap gap-2 mb-2">
                {form.options.map((o, i) => (
                  <span key={i} className="chip chip-neutral">
                    {o}
                    <button type="button" onClick={() => removeOption(i)} className="ml-1 text-[#a3a3a3] hover:text-[#991B1B]">
                      <X size={11} strokeWidth={1.5} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  data-testid="attribute-option-input"
                  className="input"
                  value={optDraft}
                  onChange={(e) => setOptDraft(e.target.value)}
                  placeholder="e.g. Diamond, Ruby…"
                  onKeyDown={(e) => e.key === "Enter" && addOption(e)}
                />
                <button type="button" onClick={addOption} className="btn-secondary">Add</button>
              </div>
            </div>
          )}

          <div>
            <div className="text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">
              Applies to categories <span className="text-[#a3a3a3] font-normal normal-case tracking-normal">— leave empty for global</span>
            </div>
            <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto border border-[#E5E7EB] rounded-md p-3">
              {categories.filter((c) => !c.parent_id).map((c) => {
                const on = form.category_ids.includes(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => toggleCat(c.id)}
                    className={`chip ${on ? "chip-gold" : "chip-neutral"} cursor-pointer`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[12.5px] text-[#525252]">
            <input type="checkbox" checked={form.required} onChange={(e) => set("required", e.target.checked)} className="h-4 w-4 rounded border-[#d4d4d8] text-[#0A0A0A]" />
            Required in product form
          </div>
        </div>
        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2 sticky bottom-0 bg-white">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" data-testid="attribute-save-btn" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Save attribute"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ============================== GENERIC LOOKUP ============================== */
function LookupPanel({ kind, title }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [openNew, setOpenNew] = useState(false);
  const [metals, setMetals] = useState([]);
  const [confirm, confirmModal] = useConfirm();

  const load = () => {
    setLoading(true);
    api.get(`/catalog/${kind}`)
      .then(({ data }) => setRows(data))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    load();
  }, [kind]);

  useEffect(() => {
    if (kind === "purities") {
      api.get("/catalog/metal-types").then(({ data }) => setMetals(data)).catch(() => {});
    }
  }, [kind]);

  const metalNameById = Object.fromEntries(metals.map((m) => [m.id, m.name]));

  const remove = async (id) => {
    if (!(await confirm(`Delete this ${title.toLowerCase()}?`))) return;
    try {
      await api.delete(`/catalog/${kind}/${id}`);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="section-title">{title}</div>
          <div className="text-[12px] text-[#737373] mt-0.5">
            Reusable master data referenced by products, invoices and reports.
          </div>
        </div>
        <button
          onClick={() => setOpenNew(true)}
          data-testid={`catalog-add-${kind}-btn`}
          className="btn-primary"
        >
          <Plus size={14} strokeWidth={1.5} /> New {title.slice(0, -1).toLowerCase()}
        </button>
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <TableSkeleton rows={5} cols={4} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title={`No ${title.toLowerCase()} yet`} description="Add your first entry to get started." />
      ) : (
        <div className="table-shell">
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Name</th>
                <th className="table-th">Code</th>
                {kind === "purities" && <th className="table-th">Metal Type</th>}
                <th className="table-th">Description</th>
                <th className="table-th"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="table-row">
                  <td className="table-td font-medium">
                    <div className="flex items-center gap-2">
                      {r.color && (
                        <span className="h-3 w-3 rounded-full border border-[#E5E7EB]" style={{ background: r.color }} />
                      )}
                      {r.name}
                    </div>
                  </td>
                  <td className="table-td font-mono text-[12px] text-[#525252]">{r.code}</td>
                  {kind === "purities" && (
                    <td className="table-td text-[12.5px] text-[#525252]">
                      {metalNameById[asObject(r.meta).metal_type_id] || "—"}
                    </td>
                  )}
                  <td className="table-td text-[12.5px] text-[#525252]">{r.description || "—"}</td>
                  <td className="table-td text-right">
                    <button className="p-1.5 text-[#737373] hover:text-[#0A0A0A]" onClick={() => setEditing(r)}>
                      <Pencil size={13} strokeWidth={1.5} />
                    </button>
                    {!r.is_system && (
                      <button className="p-1.5 text-[#737373] hover:text-[#991B1B]" onClick={() => remove(r.id)}>
                        <Trash2 size={13} strokeWidth={1.5} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(openNew || editing) && (
        <LookupModal
          kind={kind}
          title={title}
          metals={metals}
          initial={editing || {}}
          onClose={() => {
            setEditing(null);
            setOpenNew(false);
          }}
          onSaved={() => {
            load();
            setEditing(null);
            setOpenNew(false);
          }}
        />
      )}
      {confirmModal}
    </div>
  );
}

function LookupModal({ kind, title, metals, initial, onClose, onSaved }) {
  const editing = Boolean(initial.id);
  const isSystem = Boolean(initial.is_system);
  const [form, setForm] = useState({
    name: initial.name || "",
    code: initial.code || "",
    description: initial.description || "",
    color: initial.color || "",
    metal_type_id: asObject(initial.meta).metal_type_id || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    if (kind === "purities" && !form.metal_type_id) return toast.error("Select a metal type");
    setBusy(true);
    try {
      const { metal_type_id, ...rest } = form;
      const payload = {
        ...rest,
        meta: kind === "purities" ? { metal_type_id } : {},
      };
      if (isSystem) {
        // Code is locked for system rows — never send a changed code.
        payload.code = initial.code;
      }
      if (editing) await api.patch(`/catalog/${kind}/${initial.id}`, payload);
      else await api.post(`/catalog/${kind}`, payload);
      toast.success("Saved");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-md">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="section-title">{editing ? `Edit ${title.slice(0, -1).toLowerCase()}` : `New ${title.slice(0, -1).toLowerCase()}`}</div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <F label="Name">
            <input required data-testid="lookup-name-input" className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
          </F>
          <F label={
            isSystem
              ? "Code (system — locked)"
              : kind === "purities"
                ? "Code — karat or fineness"
                : "Code (auto if blank)"
          }>
            <input
              className="input font-mono"
              value={form.code}
              onChange={(e) => set("code", e.target.value)}
              disabled={isSystem}
              readOnly={isSystem}
              placeholder={kind === "purities" ? "e.g. 16 or 667" : undefined}
            />
            {kind === "purities" && !isSystem && (
              <p className="mt-1 text-[11px] text-[#737373]">
                Gold: enter karat 1–24 (16 for 16K) or fineness 25–1000 (667 or 916).
                Silver: enter fineness out of 999 (925 sterling, 999 fine).
                Built-in 24K / 22K / 18K / 14K / Silver already have a shop rate.
              </p>
            )}
          </F>
          <F label="Description">
            <input className="input" value={form.description || ""} onChange={(e) => set("description", e.target.value)} />
          </F>
          {kind === "purities" && (
            <F label="Metal Type">
              <select required className="input" value={form.metal_type_id} onChange={(e) => set("metal_type_id", e.target.value)}>
                <option value="">Select metal type</option>
                {metals.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </F>
          )}
          {(kind === "metal-types" || kind === "stone-types" || kind === "tags") && (
            <F label="Color (optional)">
              <div className="flex items-center gap-2">
                <input type="color" value={form.color || "#B49042"} onChange={(e) => set("color", e.target.value)} className="h-9 w-14 border border-[#E5E7EB] rounded-md" />
                <input className="input font-mono" value={form.color || ""} onChange={(e) => set("color", e.target.value)} placeholder="#B49042" />
              </div>
            </F>
          )}
        </div>
        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" data-testid="lookup-save-btn" disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function F({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">{label}</span>
      {hint && <span className="block text-[11px] text-[#a3a3a3] mb-1.5 -mt-1">{hint}</span>}
      {children}
    </label>
  );
}
