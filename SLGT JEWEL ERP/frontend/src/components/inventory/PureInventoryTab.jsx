import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, Scale, Package } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import EmptyState from "@/components/common/EmptyState";
import { ListSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import { useAuth } from "@/context/AuthContext";
import useConfirm from "@/hooks/useConfirm";
import WeightInput from "@/components/ui/WeightInput";

function formatWeight(w) {
  const n = Number(w);
  if (!Number.isFinite(n)) return "—";
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

function isBulkPure(formType) {
  const f = String(formType || "").toLowerCase();
  return f === "pure" || f === "biscuit";
}

function PureProductDialog({ initial, onClose, onSaved, canEdit = false }) {
  const editing = Boolean(initial?.id);
  const initialForm = isBulkPure(initial?.form_type) ? "pure" : (initial?.form_type || "coin");
  const existingStock = Number(initial?.stock_qty) || 0;
  const [form, setForm] = useState({
    metal: initial?.metal || "gold",
    form_type: initialForm,
    // For pure type, weight_g field shows stock grams (stock_qty)
    weight_g: isBulkPure(initial?.form_type)
      ? (initial?.stock_qty != null ? String(initial.stock_qty) : "")
      : (initial?.weight_g != null ? String(initial.weight_g) : ""),
    stock_qty: initial?.stock_qty != null && !isBulkPure(initial?.form_type)
      ? String(initial.stock_qty)
      : "",
    low_stock_threshold: initial?.low_stock_threshold != null ? String(initial.low_stock_threshold) : "0",
  });
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const isPureType = form.form_type === "pure";

  const addNum = Number(addAmount);
  const addValid = Number.isFinite(addNum) && addNum > 0;
  // Base to preview/add on top of — the directly-edited field value for
  // canEdit users, otherwise the stock as recorded (matches the save() logic).
  const editedBase = Number(isPureType ? form.weight_g : form.stock_qty);
  const previewBase = (canEdit && Number.isFinite(editedBase)) ? editedBase : existingStock;
  const resultingStock = editing
    ? previewBase + (addValid ? addNum : 0)
    : null;

  const previewName = useMemo(() => {
    const metal = form.metal === "silver" ? "Silver" : "Gold";
    if (isPureType) return `Pure ${metal}`;
    const wt = formatWeight(form.weight_g);
    if (!wt || wt === "—") return "—";
    return `${wt} g ${metal} Coin`;
  }, [form.metal, form.form_type, form.weight_g, isPureType]);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      let payload;
      // Direct edit access (users with inventory edit permission) lets the base
      // value itself be corrected; everyone else keeps the additive-only flow
      // (existingStock + Add amount), which never overwrites the recorded stock.
      const editedWeight = Number(form.weight_g);
      const editedQty = Number(form.stock_qty);
      const baseWeight = (editing && canEdit && Number.isFinite(editedWeight)) ? editedWeight : existingStock;
      const baseQty = (editing && canEdit && Number.isFinite(editedQty)) ? editedQty : existingStock;
      if (isPureType) {
        const stockGrams = editing
          ? (addValid ? baseWeight + addNum : baseWeight)
          : Number(form.weight_g);
        payload = {
          metal: form.metal,
          form_type: "pure",
          weight_g: stockGrams,
          low_stock_threshold: Number(form.low_stock_threshold || 0),
        };
      } else {
        const qty = editing
          ? (addValid ? baseQty + addNum : baseQty)
          : Number(form.stock_qty);
        payload = {
          metal: form.metal,
          form_type: "coin",
          weight_g: Number(form.weight_g),
          stock_qty: qty,
          low_stock_threshold: Number(form.low_stock_threshold || 0),
        };
      }
      if (editing) {
        const { data } = await api.patch(`/pure-products/${initial.id}`, payload);
        toast.success(
          addValid
            ? (isPureType
              ? `Added ${formatWeight(addNum)} g — stock now ${formatWeight(resultingStock)} g`
              : `Added ${addNum} — qty now ${resultingStock}`)
            : "Pure product updated",
        );
        onSaved(data);
      } else {
        const { data } = await api.post("/pure-products", payload);
        toast.success("Pure product added");
        onSaved(data);
      }
      onClose();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <form
        onSubmit={save}
        className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-md"
        data-testid="pure-product-dialog"
      >
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
          <div>
            <div className="section-title">{editing ? "Edit Pure Product" : "Add Pure Product"}</div>
            <div className="text-[12px] text-[#737373] mt-0.5">Coins & bulk pure stock</div>
          </div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-1.5">
              Metal
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "gold", label: "Gold" },
                { key: "silver", label: "Silver" },
              ].map((m) => (
                <button
                  key={m.key}
                  type="button"
                  disabled={editing}
                  onClick={() => set("metal", m.key)}
                  className={`h-10 rounded-lg border text-[13px] font-medium transition-colors ${
                    form.metal === m.key
                      ? "border-[#B49042] bg-[#FDFBF7] text-[#7a5e26]"
                      : "border-[#E5E7EB] bg-white text-[#525252] hover:border-[#B49042]"
                  } ${editing ? "opacity-70 cursor-not-allowed" : ""}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-1.5">
              Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { key: "coin", label: "Coin" },
                { key: "pure", label: "Pure" },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  disabled={editing}
                  onClick={() => {
                    set("form_type", t.key);
                    setAddOpen(false);
                    setAddAmount("");
                  }}
                  className={`h-10 rounded-lg border text-[13px] font-medium transition-colors ${
                    form.form_type === t.key
                      ? "border-[#B49042] bg-[#FDFBF7] text-[#7a5e26]"
                      : "border-[#E5E7EB] bg-white text-[#525252] hover:border-[#B49042]"
                  } ${editing ? "opacity-70 cursor-not-allowed" : ""}`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {isPureType ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-1.5">
                    {editing ? "Current Weight (g)" : "Weight (g)"}
                  </label>
                  <WeightInput
                    required={!editing || canEdit}
                    className={`input ${editing && !canEdit ? "bg-[#FAFAFA]" : ""}`}
                    value={editing && !canEdit ? formatWeight(existingStock) : form.weight_g}
                    onValueChange={(raw) => (!editing || canEdit) && set("weight_g", raw)}
                    readOnly={editing && !canEdit}
                    placeholder="100"
                    data-testid="pure-weight-input"
                  />
                  <div className="mt-1 text-[11px] text-[#A3A3A3]">
                    {editing ? (canEdit ? "Stock on hand — editable" : "Stock on hand") : "Stock on hand in grams"}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-1.5">
                    Threshold (g)
                  </label>
                    <WeightInput
                      className="input"
                      value={form.low_stock_threshold}
                      onValueChange={(raw) => set("low_stock_threshold", raw)}
                      placeholder="20"
                      data-testid="pure-threshold-input"
                    />
                  <div className="mt-1 text-[11px] text-[#A3A3A3]">Low-stock alert weight</div>
                </div>
              </div>

              {editing && (
                <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3 space-y-2">
                  {!addOpen ? (
                    <button
                      type="button"
                      className="btn-secondary w-full justify-center"
                      onClick={() => setAddOpen(true)}
                      data-testid="pure-add-weight-btn"
                    >
                      <Plus size={14} strokeWidth={1.5} /> Add Weight
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373]">
                          Add Weight (g)
                        </label>
                        <button
                          type="button"
                          className="text-[11px] text-[#737373] hover:text-[#0A0A0A]"
                          onClick={() => { setAddOpen(false); setAddAmount(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                      <WeightInput
                        min="0.001"
                        className="input"
                        value={addAmount}
                        onValueChange={(raw) => setAddAmount(raw)}
                        placeholder="e.g. 50"
                        autoFocus
                        data-testid="pure-add-weight-input"
                      />
                      {addValid && (
                        <div className="text-[12px] text-[#525252]">
                          {formatWeight(previewBase)} g + {formatWeight(addNum)} g ={" "}
                          <span className="font-semibold text-[#0A0A0A]">{formatWeight(resultingStock)} g</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-1.5">
                    Weight (g)
                  </label>
                  <WeightInput
                    required
                    className={`input ${editing && !canEdit ? "bg-[#FAFAFA]" : ""}`}
                    value={form.weight_g}
                    onValueChange={(raw) => (!editing || canEdit) && set("weight_g", raw)}
                    readOnly={editing && !canEdit}
                    placeholder="1"
                    data-testid="pure-weight-input"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-1.5">
                    {editing ? "Current Qty" : "Qty"}
                  </label>
                  <input
                    required={!editing || canEdit}
                    type="number"
                    step="1"
                    min="0"
                    className={`input ${editing && !canEdit ? "bg-[#FAFAFA]" : ""}`}
                    value={editing && !canEdit ? String(existingStock) : form.stock_qty}
                    onChange={(e) => (!editing || canEdit) && set("stock_qty", e.target.value)}
                    readOnly={editing && !canEdit}
                    placeholder="0"
                    data-testid="pure-qty-input"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-1.5">
                    Threshold
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    className="input"
                    value={form.low_stock_threshold}
                    onChange={(e) => set("low_stock_threshold", e.target.value)}
                    placeholder="0"
                    data-testid="pure-threshold-input"
                  />
                </div>
              </div>

              {editing && (
                <div className="rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-3 space-y-2">
                  {!addOpen ? (
                    <button
                      type="button"
                      className="btn-secondary w-full justify-center"
                      onClick={() => setAddOpen(true)}
                      data-testid="pure-add-qty-btn"
                    >
                      <Plus size={14} strokeWidth={1.5} /> Add Qty
                    </button>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373]">
                          Add Qty
                        </label>
                        <button
                          type="button"
                          className="text-[11px] text-[#737373] hover:text-[#0A0A0A]"
                          onClick={() => { setAddOpen(false); setAddAmount(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                      <input
                        type="number"
                        step="1"
                        min="1"
                        className="input"
                        value={addAmount}
                        onChange={(e) => setAddAmount(e.target.value)}
                        placeholder="e.g. 10"
                        autoFocus
                        data-testid="pure-add-qty-input"
                      />
                      {addValid && (
                        <div className="text-[12px] text-[#525252]">
                          {previewBase} + {addNum} ={" "}
                          <span className="font-semibold text-[#0A0A0A]">{resultingStock}</span>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg bg-[#FAFAFA] border border-[#E5E7EB] px-3 py-2 text-[12.5px] text-[#525252]">
            Will save as: <span className="font-semibold text-[#0A0A0A]">{previewName}</span>
          </div>
        </div>

        <div className="p-5 border-t border-[#E5E7EB] flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy} data-testid="pure-save-btn">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function MetalGroup({ title, items, canEdit, canDelete, onEdit, onDelete }) {
  if (!items.length) return null;
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E5E7EB] flex items-center gap-2">
        <Scale size={16} className="text-[#B49042]" strokeWidth={1.5} />
        <span className="font-semibold text-[15px] text-[#0A0A0A]">{title}</span>
        <span className="text-[11px] text-[#737373] bg-[#F3F4F6] px-2 py-0.5 rounded-full">
          {items.length} items
        </span>
      </div>
      <div className="divide-y divide-[#F3F4F6]">
        {items.map((p) => {
          const bulk = isBulkPure(p.form_type);
          const stock = Number(p.stock_qty) || 0;
          const thr = Number(p.low_stock_threshold) || 0;
          const low = stock > 0 && thr > 0 && stock <= thr;
          const out = stock <= 0;
          return (
            <div
              key={p.id}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#FAFAFA]"
              data-testid={`pure-row-${p.id}`}
            >
              <div className="h-9 w-9 rounded-lg bg-[#FDFBF7] border border-[#EADFBF] flex items-center justify-center flex-shrink-0">
                <Package size={15} className="text-[#B49042]" strokeWidth={1.5} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[14px] text-[#0A0A0A]">{p.name}</div>
                <div className="text-[12px] text-[#737373] mt-0.5">
                  {bulk
                    ? "Bulk pure · tracked by grams"
                    : `${formatWeight(p.weight_g)} g · Coin`}
                  {low && <span className="ml-2 text-amber-700">Low stock</span>}
                  {out && <span className="ml-2 text-red-600">Out of stock</span>}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-display text-[18px] font-semibold tabular-nums ${out ? "text-red-600" : "text-[#0A0A0A]"}`}>
                  {bulk ? formatWeight(stock) : stock}
                </div>
                <div className="text-[10.5px] text-[#737373] uppercase tracking-wide">
                  {bulk ? "Stock g" : "Qty"}
                </div>
              </div>
              <div className="text-right w-16">
                <div className="text-[13px] tabular-nums text-[#525252]">
                  {thr ? (bulk ? `${formatWeight(thr)} g` : thr) : "—"}
                </div>
                <div className="text-[10.5px] text-[#737373] uppercase tracking-wide">Alert</div>
              </div>
              <div className="flex items-center gap-1.5">
                {canEdit && (
                  <button
                    type="button"
                    className="btn-secondary !px-2.5 !py-1.5"
                    onClick={() => onEdit(p)}
                    title="Edit"
                  >
                    <Pencil size={13} strokeWidth={1.5} />
                  </button>
                )}
                {canDelete && (
                  <button
                    type="button"
                    className="btn-secondary !px-2.5 !py-1.5 text-red-600 hover:!border-red-300"
                    onClick={() => onDelete(p)}
                    title="Delete"
                    data-testid={`pure-delete-${p.id}`}
                  >
                    <Trash2 size={13} strokeWidth={1.5} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Inventory → Pure tab: gold/silver coins & bulk pure.
 */
export default function PureInventoryTab({ onAddClickRef }) {
  const { can } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [confirm, confirmModal] = useConfirm();
  const canCreate = can("inventory", "create");
  const canEdit = can("inventory", "edit") || can("inventory", "update");
  const canDelete = can("inventory", "delete");

  const load = () => {
    setLoading(true);
    api
      .get("/pure-products")
      .then(({ data }) => setItems(Array.isArray(data) ? data : []))
      .catch((err) => toast.error(formatApiError(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (onAddClickRef) {
      onAddClickRef.current = () => {
        if (!canCreate) return toast.error("No permission to add products");
        setDialog({});
      };
    }
  }, [onAddClickRef, canCreate]);

  const gold = useMemo(() => items.filter((i) => i.metal === "gold"), [items]);
  const silver = useMemo(() => items.filter((i) => i.metal === "silver"), [items]);

  const handleDelete = async (p) => {
    const stock = Number(p.stock_qty) || 0;
    const stockNote = stock > 0
      ? `\n\nThis item still has ${isBulkPure(p.form_type) ? `${formatWeight(stock)} g` : `${stock} pc(s)`} in stock.`
      : "";
    if (!(await confirm(`Delete "${p.name}"?${stockNote}`, { title: "Delete Pure Product", confirmLabel: "Delete" }))) return;
    try {
      await api.delete(`/pure-products/${p.id}`);
      toast.success(`${p.name} deleted`);
      load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const stats = useMemo(() => {
    const coinPcs = items
      .filter((i) => !isBulkPure(i.form_type))
      .reduce((s, i) => s + (Number(i.stock_qty) || 0), 0);
    const totalWeight = items.reduce((s, i) => {
      if (isBulkPure(i.form_type)) return s + (Number(i.stock_qty) || 0);
      return s + (Number(i.weight_g) || 0) * (Number(i.stock_qty) || 0);
    }, 0);
    const low = items.filter((i) => {
      const q = Number(i.stock_qty) || 0;
      const t = Number(i.low_stock_threshold) || 0;
      return q > 0 && t > 0 && q <= t;
    }).length;
    return { skus: items.length, coinPcs, totalWeight, low };
  }, [items]);

  /** Per-metal split — bulk "pure" stock (grams on hand) vs coin stock (pieces × weight/piece). */
  const metalStats = useMemo(() => {
    const split = (arr) => {
      const pureWeight = arr
        .filter((i) => isBulkPure(i.form_type))
        .reduce((s, i) => s + (Number(i.stock_qty) || 0), 0);
      const coinWeight = arr
        .filter((i) => !isBulkPure(i.form_type))
        .reduce((s, i) => s + (Number(i.weight_g) || 0) * (Number(i.stock_qty) || 0), 0);
      const coinPcs = arr
        .filter((i) => !isBulkPure(i.form_type))
        .reduce((s, i) => s + (Number(i.stock_qty) || 0), 0);
      return { pureWeight, coinWeight, coinPcs };
    };
    return { gold: split(gold), silver: split(silver) };
  }, [gold, silver]);

  return (
    <div data-testid="pure-inventory-tab">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "SKUs", val: stats.skus },
          { label: "Coin Pcs", val: stats.coinPcs },
          { label: "Total Weight (g)", val: formatWeight(stats.totalWeight) },
          { label: "Low Stock", val: stats.low, color: "text-amber-600" },
        ].map((s) => (
          <div key={s.label} className="card !p-3 text-center">
            <div className={`font-display text-[22px] font-bold tabular-nums ${s.color || "text-[#0A0A0A]"}`}>
              {s.val}
            </div>
            <div className="text-[11px] text-[#737373] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#737373] mb-2">
        By Metal
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Gold Pure (g)", val: formatWeight(metalStats.gold.pureWeight) },
          { label: "Gold Coins (g)", val: formatWeight(metalStats.gold.coinWeight), sub: `${metalStats.gold.coinPcs} pcs` },
          { label: "Silver Pure (g)", val: formatWeight(metalStats.silver.pureWeight) },
          { label: "Silver Coins (g)", val: formatWeight(metalStats.silver.coinWeight), sub: `${metalStats.silver.coinPcs} pcs` },
        ].map((s) => (
          <div key={s.label} className="card !p-3 text-center">
            <div className="font-display text-[22px] font-bold tabular-nums text-[#0A0A0A]">
              {s.val}
            </div>
            <div className="text-[11px] text-[#737373] mt-0.5">{s.label}</div>
            {s.sub && <div className="text-[10.5px] text-[#a3a3a3] mt-0.5">{s.sub}</div>}
          </div>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <ListSkeleton rows={4} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="No pure products yet"
          description="Add gold or silver coins and bulk pure to sell from Pure Gold / Silver POS."
          icon={Package}
          action={
            canCreate ? (
              <button type="button" className="btn-primary" onClick={() => setDialog({})}>
                <Plus size={14} strokeWidth={1.5} /> Add Product
              </button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-4">
          <MetalGroup title="Gold" items={gold} canEdit={canEdit} canDelete={canDelete} onEdit={(p) => setDialog(p)} onDelete={handleDelete} />
          <MetalGroup title="Silver" items={silver} canEdit={canEdit} canDelete={canDelete} onEdit={(p) => setDialog(p)} onDelete={handleDelete} />
        </div>
      )}

      {dialog && (
        <PureProductDialog
          initial={dialog.id ? dialog : {}}
          onClose={() => setDialog(null)}
          onSaved={() => load()}
          canEdit={canEdit}
        />
      )}
      {confirmModal}
    </div>
  );
}
