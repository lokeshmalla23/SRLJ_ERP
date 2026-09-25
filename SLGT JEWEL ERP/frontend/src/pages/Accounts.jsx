import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import { FilterMultiSelect } from "@/pages/reports/FilterBar";
import {
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronDown,
  Receipt,
  BookOpen,
  Tag,
  Check,
  Loader2,
  CalendarCheck,
  Users,
  Scale,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useBusinessDate } from "@/context/BusinessDateContext";
import { hasFullAccessRole } from "@/lib/roleLabel";
import HiddenBillPasswordDialog from "@/components/pos/HiddenBillPasswordDialog";
import { hiddenUnlockBleedClass } from "@/lib/hiddenUnlockSurface";
import MoneyInput from "@/components/ui/MoneyInput";
import AccountsModule from "@/components/accounts/AccountsModule";
import StatementsTab from "@/components/accounts/StatementsTab";
import EmployeeSalesTab from "@/components/accounts/EmployeeSalesTab";
import DailyClosingTab from "@/components/accounts/DailyClosingTab";
import useConfirm from "@/hooks/useConfirm";
import { fmtINR, parseMoneyInput } from "@/lib/format";
import { PAYMENT_MODES, currentTimeHHMM, fmtDateTimeParts } from "@/components/accounts/accountsShared";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Local calendar date YYYY-MM-DD (avoid UTC shift for IST shops). */
const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const PRESET_COLORS = [
  "#EF4444", "#F97316", "#EAB308", "#22C55E",
  "#14B8A6", "#3B82F6", "#8B5CF6", "#EC4899",
  "#6B7280", "#0A0A0A",
];

// ─── Sub-components ─────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1C2621]/50 p-4 backdrop-blur-[2px]"
      style={{ background: "rgba(28,38,33,0.50)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`flex flex-col rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_22px_60px_rgba(20,31,25,0.22)] ${wide ? "w-full max-w-2xl" : "w-full max-w-lg"}`}
        style={{ maxHeight: "90vh" }}
      >
        <div
          className="flex items-center justify-between border-b border-[#DDD7CA] bg-[#FBF8F1] px-6 py-4"
          style={{ borderColor: "#DDD7CA" }}
        >
          <h2 className="font-semibold text-base" style={{ color: "#0A0A0A" }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} style={{ color: "#737373" }} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, required }) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-xs font-medium"
        style={{ color: "#737373" }}
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function Badge({ status }) {
  const map = {
    closed: { bg: "#DCFCE7", color: "#15803D", label: "Closed" },
    draft: { bg: "#FEF9C3", color: "#A16207", label: "Draft" },
    open: { bg: "#F3F4F6", color: "#525252", label: "Open" },
  };
  const cfg = map[status] || map.open;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

// ─── Tab 1: Expenses ─────────────────────────────────────────────────────────

const EXPENSE_DEFAULTS = {
  date: today(),
  time: currentTimeHHMM(),
  description: "",
  category_id: "",
  amount: "",
  payment_mode: "cash",
  reference: "",
  notes: "",
};

const CAT_DEFAULTS = { name: "", icon: "🏷️", color: "#3B82F6" };

function ExpensesTab() {
  const { date: activeBillingDate } = useBusinessDate();
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [showCatModal, setShowCatModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [form, setForm] = useState(EXPENSE_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [filterTo, setFilterTo] = useState(today());
  const [filterCat, setFilterCat] = useState([]);
  const [filterMode, setFilterMode] = useState([]);

  const [catForm, setCatForm] = useState(CAT_DEFAULTS);
  const [catSaving, setCatSaving] = useState(false);
  const [editingCat, setEditingCat] = useState(null);

  const [confirm, confirmModal] = useConfirm();

  const loadExpenses = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filterFrom) params.from = filterFrom;
    if (filterTo) params.to = filterTo;
    if (filterCat.length) params.category_id = filterCat.join(",");
    if (filterMode.length) params.payment_mode = filterMode.join(",");
    api
      .get("/accounts/expenses", { params })
      .then(({ data }) => setExpenses(Array.isArray(data) ? data : data.items || []))
      .catch(() => toast.error("Failed to load expenses"))
      .finally(() => setLoading(false));
  }, [filterFrom, filterTo, filterCat, filterMode]);

  const loadCategories = useCallback(() => {
    api
      .get("/accounts/expense-categories")
      .then(({ data }) => setCategories(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadExpenses();
    loadCategories();
  }, [loadExpenses, loadCategories]);

  const openAdd = () => {
    setEditingExpense(null);
    // Default to the active (unclosed) business day, not necessarily real
    // "today" — still freely editable for a genuinely back-dated expense.
    setForm({ ...EXPENSE_DEFAULTS, date: activeBillingDate || today() });
    setShowForm(true);
  };

  const openEdit = (exp) => {
    setEditingExpense(exp);
    setForm({
      date: exp.date || today(),
      time: exp.time || currentTimeHHMM(),
      description: exp.description || "",
      category_id: exp.category_id || "",
      amount: exp.amount || "",
      payment_mode: exp.payment_mode || "cash",
      reference: exp.reference || "",
      notes: exp.notes || "",
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!(await confirm("Delete this expense?"))) return;
    try {
      await api.delete(`/accounts/expenses/${id}`);
      toast.success("Expense deleted");
      loadExpenses();
    } catch {
      toast.error("Failed to delete expense");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.description.trim()) return toast.error("Description is required");
    const amount = parseMoneyInput(form.amount, Number.NaN);
    if (!form.amount || !Number.isFinite(amount))
      return toast.error("Valid amount is required");
    setSaving(true);
    try {
      const payload = { ...form, amount };
      if (editingExpense) {
        await api.put(`/accounts/expenses/${editingExpense.id}`, payload);
        toast.success("Expense updated");
      } else {
        await api.post("/accounts/expenses", payload);
        toast.success("Expense added");
      }
      setShowForm(false);
      loadExpenses();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save expense");
    } finally {
      setSaving(false);
    }
  };

  // Category handlers
  const openAddCat = () => {
    setEditingCat(null);
    setCatForm(CAT_DEFAULTS);
  };

  const openEditCat = (cat) => {
    setEditingCat(cat);
    setCatForm({ name: cat.name, icon: cat.icon || "🏷️", color: cat.color || "#3B82F6" });
  };

  const handleSaveCat = async (e) => {
    e.preventDefault();
    if (!catForm.name.trim()) return toast.error("Category name is required");
    setCatSaving(true);
    try {
      if (editingCat) {
        await api.put(`/accounts/expense-categories/${editingCat.id}`, catForm);
        toast.success("Category updated");
      } else {
        await api.post("/accounts/expense-categories", catForm);
        toast.success("Category added");
      }
      setEditingCat(null);
      setCatForm(CAT_DEFAULTS);
      loadCategories();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save category");
    } finally {
      setCatSaving(false);
    }
  };

  const handleDeleteCat = async (id) => {
    if (!(await confirm("Delete this category?"))) return;
    try {
      await api.delete(`/accounts/expense-categories/${id}`);
      toast.success("Category deleted");
      loadCategories();
    } catch {
      toast.error("Failed to delete category");
    }
  };

  const catMap = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories]
  );

  const totalExpenses = useMemo(
    () => expenses.reduce((s, e) => s + Number(e.amount || 0), 0),
    [expenses]
  );

  return (
    <div>
      {/* Top bar */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm" style={{ color: "#737373" }}>
            {expenses.length} expense{expenses.length !== 1 ? "s" : ""} ·{" "}
            <span className="font-medium" style={{ color: "#0A0A0A" }}>
              {fmtINR(totalExpenses)} total
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-sm flex items-center gap-1.5"
            onClick={() => setShowCatModal(true)}
          >
            <Tag size={14} />
            Categories
          </button>
          <button
            className="btn-primary text-sm flex items-center gap-1.5"
            onClick={openAdd}
          >
            <Plus size={14} />
            Add Expense
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-[#D8D2C6] bg-[#FBF8F1] p-3 shadow-[0_1px_2px_rgba(38,52,43,0.04)]">
        <label className="text-[11px] text-[#737373]">
          From
          <input
            type="date"
            value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)}
            className="ml-1 rounded-[9px] border border-[#CFC8BB] bg-white px-2.5 py-1.5 text-xs text-[#24332B] outline-none focus:border-[#3D6B5B] focus:ring-2 focus:ring-[#DDE8E0]"
          />
        </label>
        <label className="text-[11px] text-[#737373]">
          To
          <input
            type="date"
            value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)}
            className="ml-1 rounded-[9px] border border-[#CFC8BB] bg-white px-2.5 py-1.5 text-xs text-[#24332B] outline-none focus:border-[#3D6B5B] focus:ring-2 focus:ring-[#DDE8E0]"
          />
        </label>
        <FilterMultiSelect label="Category" value={filterCat} onChange={setFilterCat} options={categories} />
        <FilterMultiSelect label="Mode" value={filterMode} onChange={setFilterMode} options={PAYMENT_MODES} />
        <button type="button" className="btn-secondary text-xs" onClick={loadExpenses}>
          Apply
        </button>
      </div>

      {/* Table */}
      <div
        className="overflow-hidden rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]"
        style={{ borderColor: "#D8D2C6" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#F1EEE7", borderBottom: "1px solid #D8D2C6" }}>
              {["Date", "Description", "Category", "Amount", "Mode", "Actions"].map(
                (h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                    style={{ color: "#737373" }}
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="p-0">
                  <div className="px-4 pt-4"><PageLoadingBadge /></div>
                  <TableSkeleton rows={7} cols={6} />
                </td>
              </tr>
            ) : expenses.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-12" style={{ color: "#737373" }}>
                  No expenses recorded yet.
                </td>
              </tr>
            ) : (
              expenses.map((exp, idx) => {
                const cat = catMap[exp.category_id];
                return (
                  <tr
                    key={exp.id}
                    style={{
                      borderBottom: idx < expenses.length - 1 ? "1px solid #D8D2C6" : "none",
                    }}
                    className="hover:bg-[#F7F5EF] transition-colors"
                  >
                    <td className="px-4 py-3 text-xs" style={{ color: "#737373" }}>
                      {fmtDateTimeParts(exp.date, exp.time)}
                    </td>
                    <td className="px-4 py-3 font-medium" style={{ color: "#0A0A0A" }}>
                      {exp.description}
                      {exp.notes && (
                        <p className="text-xs font-normal mt-0.5" style={{ color: "#737373" }}>
                          {exp.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {cat ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                          style={{
                            background: cat.color + "20",
                            color: cat.color || "#737373",
                          }}
                        >
                          {cat.icon && <span>{cat.icon}</span>}
                          {cat.name}
                        </span>
                      ) : (
                        <span style={{ color: "#737373" }}>—</span>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 font-semibold tabular-nums"
                      style={{ color: "#0A0A0A" }}
                    >
                      {fmtINR(exp.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-medium capitalize"
                        style={{ background: "#F3F4F6", color: "#374151" }}
                      >
                        {exp.payment_mode || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openEdit(exp)}
                          className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} style={{ color: "#737373" }} />
                        </button>
                        <button
                          onClick={() => handleDelete(exp.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} className="text-red-500" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Expense Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editingExpense ? "Edit Expense" : "Add Expense"}
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Date" required>
              <input
                type="date"
                className="input"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                required
              />
            </Field>
            <Field label="Time">
              <input
                type="time"
                className="input"
                value={form.time}
                onChange={(e) => setForm({ ...form, time: e.target.value })}
              />
            </Field>
            <Field label="Amount (₹)" required>
              <MoneyInput
                min="0"
                step="0.01"
                className="input"
                placeholder="0.00"
                value={form.amount}
                onValueChange={(raw) => setForm({ ...form, amount: raw })}
                required
              />
            </Field>
          </div>

          <Field label="Description" required>
            <input
              type="text"
              className="input"
              placeholder="What was this expense for?"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select
                className="input"
                value={form.category_id}
                onChange={(e) => setForm({ ...form, category_id: e.target.value })}
              >
                <option value="">— Select category —</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon ? `${c.icon} ` : ""}
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Payment Mode" required>
              <select
                className="input"
                value={form.payment_mode}
                onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}
                required
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Reference / Voucher No.">
            <input
              type="text"
              className="input"
              placeholder="Optional reference"
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </Field>

          <Field label="Notes">
            <textarea
              className="input"
              rows={2}
              placeholder="Additional notes…"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              style={{ resize: "vertical" }}
            />
          </Field>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => setShowForm(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary text-sm flex items-center gap-1.5"
              disabled={saving}
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {editingExpense ? "Update" : "Save"} Expense
            </button>
          </div>
        </form>
      </Modal>

      {/* Manage Categories Modal */}
      <Modal
        open={showCatModal}
        onClose={() => {
          setShowCatModal(false);
          setEditingCat(null);
          setCatForm(CAT_DEFAULTS);
        }}
        title="Expense Categories"
        wide
      >
        <div className="flex flex-col gap-5">
          {/* Category list */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: "#D8D2C6" }}
          >
            {categories.length === 0 ? (
              <div className="py-8 text-center text-sm" style={{ color: "#737373" }}>
                No categories yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr
                    style={{ background: "#F1EEE7", borderBottom: "1px solid #D8D2C6" }}
                  >
                    {["Icon", "Name", "Color", ""].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: "#737373" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {categories.map((cat, idx) => (
                    <tr
                      key={cat.id}
                      style={{
                        borderBottom:
                          idx < categories.length - 1 ? "1px solid #D8D2C6" : "none",
                      }}
                      className="hover:bg-[#F7F5EF] transition-colors"
                    >
                      <td className="px-4 py-2.5 text-lg">{cat.icon || "🏷️"}</td>
                      <td
                        className="px-4 py-2.5 font-medium"
                        style={{ color: "#0A0A0A" }}
                      >
                        {cat.name}
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          className="inline-block w-5 h-5 rounded-full border"
                          style={{
                            background: cat.color || "#3B82F6",
                            borderColor: "#D8D2C6",
                          }}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditCat(cat)}
                            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                          >
                            <Pencil size={13} style={{ color: "#737373" }} />
                          </button>
                          <button
                            onClick={() => handleDeleteCat(cat.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                          >
                            <Trash2 size={13} className="text-red-500" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Add / Edit category form */}
          <div
            className="rounded-xl border p-4"
            style={{ borderColor: "#D8D2C6", background: "#F1EEE7" }}
          >
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#737373" }}>
              {editingCat ? `Editing: ${editingCat.name}` : "Add New Category"}
            </p>
            <form onSubmit={handleSaveCat} className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Icon (emoji)">
                  <input
                    type="text"
                    className="input text-center text-lg"
                    maxLength={4}
                    value={catForm.icon}
                    onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })}
                    placeholder="🏷️"
                  />
                </Field>
                <div className="col-span-2">
                  <Field label="Name" required>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g. Utilities, Rent…"
                      value={catForm.name}
                      onChange={(e) => setCatForm({ ...catForm, name: e.target.value })}
                      required
                    />
                  </Field>
                </div>
              </div>

              <Field label="Color">
                <div className="flex items-center gap-2 flex-wrap">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setCatForm({ ...catForm, color: c })}
                      className="w-6 h-6 rounded-full border-2 transition-all flex-shrink-0"
                      style={{
                        background: c,
                        borderColor: catForm.color === c ? "#0A0A0A" : "transparent",
                      }}
                    />
                  ))}
                  <input
                    type="color"
                    value={catForm.color}
                    onChange={(e) => setCatForm({ ...catForm, color: e.target.value })}
                    className="w-7 h-7 rounded cursor-pointer border"
                    style={{ borderColor: "#D8D2C6" }}
                    title="Custom color"
                  />
                </div>
              </Field>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="btn-primary text-xs flex items-center gap-1"
                  disabled={catSaving}
                >
                  {catSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                  {editingCat ? "Update" : "Add"} Category
                </button>
                {editingCat && (
                  <button
                    type="button"
                    className="btn-secondary text-xs"
                    onClick={() => {
                      setEditingCat(null);
                      setCatForm(CAT_DEFAULTS);
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </Modal>
      {confirmModal}
    </div>
  );
}

// ─── Tab 3: Ledger ───────────────────────────────────────────────────────────

function LedgerTab() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(today());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!from || !to) return;
    setLoading(true);
    api
      .get("/accounts/ledger", { params: { from, to } })
      .then(({ data }) => setRows(Array.isArray(data) ? data : data.rows || []))
      .catch(() => toast.error("Failed to load ledger"))
      .finally(() => setLoading(false));
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          sales: acc.sales + Number(r.sales || 0),
          schemes: acc.schemes + Number(r.schemes || 0),
          expenses: acc.expenses + Number(r.expenses || 0),
          net: acc.net + Number(r.net ?? (Number(r.sales || 0) + Number(r.schemes || 0) - Number(r.expenses || 0))),
        }),
        { sales: 0, schemes: 0, expenses: 0, net: 0 }
      ),
    [rows]
  );

  const getNet = (r) =>
    r.net !== undefined && r.net !== null
      ? Number(r.net)
      : Number(r.sales || 0) + Number(r.schemes || 0) - Number(r.expenses || 0);

  return (
    <div>
      <p className="text-[13px] text-[#737373] mb-4">
        Day-by-day POS sales, scheme collections, and expenses. For end-of-day till close, use <strong>Daily Closing</strong>.
      </p>
      {/* Date range */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <label className="text-sm font-medium" style={{ color: "#0A0A0A" }}>
          From
        </label>
        <input
          type="date"
          className="input w-40"
          value={from}
          max={to}
          onChange={(e) => setFrom(e.target.value)}
        />
        <label className="text-sm font-medium" style={{ color: "#0A0A0A" }}>
          To
        </label>
        <input
          type="date"
          className="input w-40"
          value={to}
          min={from}
          max={today()}
          onChange={(e) => setTo(e.target.value)}
        />
        <button className="btn-secondary text-sm" onClick={load}>
          Refresh
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        {[
          { label: "Total Sales", value: totals.sales, color: "#16A34A", bg: "#F0FDF4" },
          { label: "Scheme Collections", value: totals.schemes, color: "#B49042", bg: "#FFFBEB" },
          { label: "Total Expenses", value: totals.expenses, color: "#DC2626", bg: "#FEF2F2" },
          {
            label: "Net",
            value: totals.net,
            color: totals.net >= 0 ? "#16A34A" : "#DC2626",
            bg: totals.net >= 0 ? "#F0FDF4" : "#FEF2F2",
          },
        ].map(({ label, value, color, bg }) => (
          <div
            key={label}
            className="rounded-xl p-4"
            style={{ background: bg, border: `1px solid ${color}30` }}
          >
            <p className="text-xs font-medium mb-1" style={{ color }}>
              {label}
            </p>
            <p
              className="text-xl font-bold tabular-nums"
              style={{ color }}
            >
              {fmtINR(value)}
            </p>
          </div>
        ))}
      </div>

      {/* Ledger table */}
      <div
        className="overflow-hidden rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]"
        style={{ borderColor: "#D8D2C6" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr
              style={{ background: "#F1EEE7", borderBottom: "1px solid #D8D2C6" }}
            >
              {["Date", "Sales", "Schemes", "Expenses", "Net"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "#737373" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="p-0">
                  <div className="px-4 pt-4"><PageLoadingBadge /></div>
                  <TableSkeleton rows={7} cols={5} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12" style={{ color: "#737373" }}>
                  No data for selected period.
                </td>
              </tr>
            ) : (
              rows.map((row, idx) => {
                const net = getNet(row);
                const netPositive = net >= 0;
                return (
                  <tr
                    key={row.date || idx}
                    style={{
                      borderBottom:
                        idx < rows.length - 1 ? "1px solid #D8D2C6" : "none",
                    }}
                    className="hover:bg-[#F7F5EF] transition-colors"
                  >
                    <td className="px-4 py-3 text-xs" style={{ color: "#737373" }}>
                      {fmtDate(row.date)}
                    </td>
                    <td
                      className="px-4 py-3 font-medium tabular-nums"
                      style={{ color: "#16A34A" }}
                    >
                      {fmtINR(row.sales)}
                    </td>
                    <td
                      className="px-4 py-3 font-medium tabular-nums"
                      style={{ color: "#B49042" }}
                    >
                      {fmtINR(row.schemes)}
                    </td>
                    <td
                      className="px-4 py-3 font-medium tabular-nums"
                      style={{ color: "#DC2626" }}
                    >
                      {fmtINR(row.expenses)}
                    </td>
                    <td
                      className="px-4 py-3 font-semibold tabular-nums"
                      style={{ color: netPositive ? "#16A34A" : "#DC2626" }}
                    >
                      {netPositive ? "+" : ""}
                      {fmtINR(net)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr style={{ background: "#F1EEE7", borderTop: "2px solid #D8D2C6" }}>
                <td
                  className="px-4 py-3 text-xs font-bold uppercase tracking-wide"
                  style={{ color: "#0A0A0A" }}
                >
                  Total
                </td>
                <td
                  className="px-4 py-3 font-bold tabular-nums"
                  style={{ color: "#16A34A" }}
                >
                  {fmtINR(totals.sales)}
                </td>
                <td
                  className="px-4 py-3 font-bold tabular-nums"
                  style={{ color: "#B49042" }}
                >
                  {fmtINR(totals.schemes)}
                </td>
                <td
                  className="px-4 py-3 font-bold tabular-nums"
                  style={{ color: "#DC2626" }}
                >
                  {fmtINR(totals.expenses)}
                </td>
                <td
                  className="px-4 py-3 font-bold tabular-nums"
                  style={{
                    color: totals.net >= 0 ? "#16A34A" : "#DC2626",
                  }}
                >
                  {totals.net >= 0 ? "+" : ""}
                  {fmtINR(totals.net)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "daily-closing", label: "Daily Closing", icon: CalendarCheck },
  { id: "pure-metal", label: "Pure Metal", icon: Scale },
  { id: "employee-sales", label: "Employee Sales", icon: Users },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "ledger", label: "Day Ledger", icon: BookOpen },
  { id: "statements", label: "Books & Vouchers", icon: BookOpen },
  { id: "gl", label: "General Ledger", icon: BookOpen },
];

function GlTab() {
  const [accounts, setAccounts] = useState([]);
  const [journals, setJournals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get("/masters/coa").then(({ data }) => setAccounts(data?.data || [])).catch(() => {}),
      api.get("/masters/journals", { params: { limit: 40 } }).then(({ data }) => setJournals(data?.data || [])).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  if (loading) return <PageLoadingBadge />;
  return (
    <div className="p-6 space-y-6">
      <p className="text-[13px] text-[#737373] -mt-2">
        Accounting books (Chart of Accounts + journals posted from sales and expenses). Not the cashier day-close screen — use <strong>Daily Closing</strong> for that.
      </p>
      <div>
        <h3 className="text-sm font-semibold mb-2">Chart of accounts</h3>
        <div className="bg-white border border-[#D8D2C6] rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-[#F1EEE7] text-left"><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Type</th></tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-t border-[#D8D2C6]"><td className="p-2 font-mono">{a.code}</td><td className="p-2">{a.name}</td><td className="p-2 capitalize">{a.type}</td></tr>
              ))}
              {!accounts.length && <tr><td className="p-3 text-[#737373]" colSpan={3}>No accounts yet — post a sale to seed defaults.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold mb-2">Recent journals</h3>
        <div className="space-y-2">
          {journals.map((j) => (
            <div key={j.id} className="bg-white border border-[#D8D2C6] rounded p-3 text-sm">
              <div className="flex justify-between"><span className="font-medium">{j.memo || j.source_type}</span><span className="text-[#737373]">{j.entry_date}</span></div>
              <ul className="mt-1 text-[12px] text-[#525252]">
                {(j.lines || []).map((l) => (
                  <li key={l.id}>Dr {l.debit_paise / 100} / Cr {l.credit_paise / 100} · acct {l.account_id?.slice(0, 8)}</li>
                ))}
              </ul>
            </div>
          ))}
          {!journals.length && <div className="text-[13px] text-[#737373]">No journal entries yet.</div>}
        </div>
      </div>
    </div>
  );
}

export default function Accounts() {
  const { user } = useAuth();
  const isOwner = hasFullAccessRole(user?.role);
  const titleClicksRef = useRef({ count: 0, timer: null });

  const [hiddenUnlocked, setHiddenUnlocked] = useState(false);
  const [hiddenPwOpen, setHiddenPwOpen] = useState(false);
  const [hiddenPwBusy, setHiddenPwBusy] = useState(false);
  const [hiddenPwError, setHiddenPwError] = useState("");

  const handleTitleClick = () => {
    if (!isOwner || hiddenUnlocked) return;
    const state = titleClicksRef.current;
    if (state.timer) clearTimeout(state.timer);
    state.count += 1;
    if (state.count >= 3) {
      state.count = 0;
      state.timer = null;
      setHiddenPwError("");
      setHiddenPwOpen(true);
    } else {
      state.timer = setTimeout(() => {
        state.count = 0;
        state.timer = null;
      }, 2500);
    }
  };

  return (
    <div className={`flex min-h-[calc(100vh-4rem)] flex-col ${hiddenUnlocked ? hiddenUnlockBleedClass(true) : "-m-5 bg-[#F4F1EA] px-5 py-5 xl:-m-7 xl:px-7 xl:py-7 [&_.btn-primary]:!rounded-[9px] [&_.btn-primary]:!border-[#315C4A] [&_.btn-primary]:!bg-[#315C4A] [&_.btn-primary]:hover:!bg-[#244A3A] [&_.btn-secondary]:!rounded-[9px] [&_.btn-secondary]:!border-[#D2CCBF] [&_.btn-secondary]:!bg-[#FFFDF9] [&_.btn-secondary]:hover:!border-[#9EB2A6] [&_.btn-secondary]:hover:!bg-[#F1F5F1] [&_.card]:!rounded-xl [&_.card]:!border-[#D8D2C6] [&_.card]:!bg-[#FFFDF9] [&_.input]:!rounded-[9px] [&_.input]:!border-[#CFC8BB] [&_.input]:focus:!border-[#3D6B5B] [&_.input]:focus:!shadow-[0_0_0_3px_rgba(61,107,91,0.10)]"}`}>
      <div className="border-b border-[#D8D2C6] bg-[#FFFDF9]/95 px-4 py-4 shadow-[0_1px_2px_rgba(38,52,43,0.03)] backdrop-blur-sm md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1
              className="select-none font-display text-[22px] font-semibold tracking-[-0.02em] text-[#24332B]"
              onClick={handleTitleClick}
              title={isOwner && !hiddenUnlocked ? "Triple-click to unlock hidden bill figures" : undefined}
            >
              Accounts & Finance
            </h1>
            <p className="mt-0.5 text-sm text-[#737373]">
              Ledgers, day ops, and statements from live journals — grouped for jewellery shop use.
            </p>
          </div>
          {hiddenUnlocked ? (
            <button
              type="button"
              onClick={() => setHiddenUnlocked(false)}
              className="flex items-center gap-1.5 rounded-full bg-[#B49042]/15 px-3 py-1.5 text-xs font-semibold text-[#B49042] hover:bg-[#B49042]/25"
              title="Hidden bill figures are included — click to lock again"
            >
              Hidden bills included · Lock
            </button>
          ) : null}
        </div>
      </div>
      <div className="flex-1 py-4 md:py-6 px-4 md:px-6">
        <AccountsModule expensesNode={<ExpensesTab />} includeHidden={hiddenUnlocked} />
      </div>

      <HiddenBillPasswordDialog
        open={hiddenPwOpen}
        busy={hiddenPwBusy}
        error={hiddenPwError}
        onClose={() => {
          if (hiddenPwBusy) return;
          setHiddenPwOpen(false);
          setHiddenPwError("");
        }}
        onSubmit={async (pin) => {
          setHiddenPwBusy(true);
          setHiddenPwError("");
          try {
            await api.post("/settings/verify-hidden-bill-password", { password: pin });
            setHiddenUnlocked(true);
            setHiddenPwOpen(false);
            toast.success("Hidden bill figures unlocked");
          } catch (err) {
            const msg = formatApiError(err) || "Incorrect password";
            setHiddenPwError(msg);
            toast.error(
              msg.includes("Incorrect") || msg.includes("password") ? "Wrong PIN — try again" : msg,
            );
          } finally {
            setHiddenPwBusy(false);
          }
        }}
      />
    </div>
  );
}
