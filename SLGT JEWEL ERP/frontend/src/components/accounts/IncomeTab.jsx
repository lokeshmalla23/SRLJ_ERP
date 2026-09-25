import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, X, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import { FilterMultiSelect } from "@/pages/reports/FilterBar";
import MoneyInput from "@/components/ui/MoneyInput";
import { useBusinessDate } from "@/context/BusinessDateContext";
import useConfirm from "@/hooks/useConfirm";
import { fmtINR, parseMoneyInput } from "@/lib/format";
import { today, fmtDateTimeParts, currentTimeHHMM, PAYMENT_MODES } from "./accountsShared";

const INCOME_DEFAULTS = {
  date: today(),
  time: currentTimeHHMM(),
  description: "",
  amount: "",
  payment_mode: "cash",
  reference: "",
  notes: "",
};

function Field({ label, children, required }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: "#737373" }}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function Modal({ open, onClose, title, children }) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex w-full max-w-lg flex-col rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_22px_60px_rgba(20,31,25,0.22)]" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between border-b border-[#DDD7CA] bg-[#FBF8F1] px-6 py-4" style={{ borderColor: "#DDD7CA" }}>
          <h2 className="font-semibold text-base" style={{ color: "#0A0A0A" }}>{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X size={18} style={{ color: "#737373" }} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** Accounts & Finance → Income: miscellaneous cash/bank receipts not tied to a
 * sales invoice (e.g. rent received, interest, scrap sale, refund received). */
export default function IncomeTab() {
  const { date: activeBillingDate } = useBusinessDate();
  const [incomes, setIncomes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingIncome, setEditingIncome] = useState(null);
  const [form, setForm] = useState(INCOME_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [filterTo, setFilterTo] = useState(today());
  const [filterMode, setFilterMode] = useState([]);

  const [confirm, confirmModal] = useConfirm();

  const loadIncomes = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filterFrom) params.from = filterFrom;
    if (filterTo) params.to = filterTo;
    if (filterMode.length) params.payment_mode = filterMode.join(",");
    api
      .get("/accounts/incomes", { params })
      .then(({ data }) => setIncomes(Array.isArray(data) ? data : data.items || []))
      .catch(() => toast.error("Failed to load income entries"))
      .finally(() => setLoading(false));
  }, [filterFrom, filterTo, filterMode]);

  useEffect(() => {
    loadIncomes();
  }, [loadIncomes]);

  const openAdd = () => {
    setEditingIncome(null);
    // Default to the active (unclosed) business day, not necessarily real
    // "today" — still freely editable for a genuinely back-dated entry.
    setForm({ ...INCOME_DEFAULTS, date: activeBillingDate || today() });
    setShowForm(true);
  };

  const openEdit = (inc) => {
    setEditingIncome(inc);
    setForm({
      date: inc.date || today(),
      time: inc.time || currentTimeHHMM(),
      description: inc.description || "",
      amount: inc.amount || "",
      payment_mode: inc.payment_mode || "cash",
      reference: inc.reference || "",
      notes: inc.notes || "",
    });
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    if (!(await confirm("Delete this income entry?"))) return;
    try {
      await api.delete(`/accounts/incomes/${id}`);
      toast.success("Income entry deleted");
      loadIncomes();
    } catch {
      toast.error("Failed to delete income entry");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.description.trim()) return toast.error("Description is required");
    const amount = parseMoneyInput(form.amount, Number.NaN);
    if (!form.amount || !Number.isFinite(amount)) return toast.error("Valid amount is required");
    setSaving(true);
    try {
      const payload = { ...form, amount };
      if (editingIncome) {
        await api.put(`/accounts/incomes/${editingIncome.id}`, payload);
        toast.success("Income entry updated");
      } else {
        await api.post("/accounts/incomes", payload);
        toast.success("Income entry added");
      }
      setShowForm(false);
      loadIncomes();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save income entry");
    } finally {
      setSaving(false);
    }
  };

  const totalIncome = useMemo(
    () => incomes.reduce((s, i) => s + Number(i.amount || 0), 0),
    [incomes],
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <p className="text-sm" style={{ color: "#737373" }}>
          {incomes.length} entr{incomes.length !== 1 ? "ies" : "y"} ·{" "}
          <span className="font-medium" style={{ color: "#0A0A0A" }}>
            {fmtINR(totalIncome)} total
          </span>
        </p>
        <button className="btn-primary text-sm flex items-center gap-1.5" onClick={openAdd}>
          <Plus size={14} />
          Add Income
        </button>
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
        <FilterMultiSelect label="Mode" value={filterMode} onChange={setFilterMode} options={PAYMENT_MODES} />
        <button type="button" className="btn-secondary text-xs" onClick={loadIncomes}>
          Apply
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-[#D8D2C6] bg-[#FFFDF9] shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_22px_rgba(38,52,43,0.035)]" style={{ borderColor: "#D8D2C6" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#F1EEE7", borderBottom: "1px solid #D8D2C6" }}>
              {["Date", "Description", "Amount", "Mode", "Actions"].map((h) => (
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
            ) : incomes.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-12" style={{ color: "#737373" }}>
                  No income entries recorded yet.
                </td>
              </tr>
            ) : (
              incomes.map((inc, idx) => (
                <tr
                  key={inc.id}
                  style={{ borderBottom: idx < incomes.length - 1 ? "1px solid #D8D2C6" : "none" }}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 text-xs" style={{ color: "#737373" }}>
                    {fmtDateTimeParts(inc.date, inc.time)}
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: "#0A0A0A" }}>
                    {inc.description}
                    {inc.notes && (
                      <p className="text-xs font-normal mt-0.5" style={{ color: "#737373" }}>
                        {inc.notes}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold tabular-nums" style={{ color: "#15803D" }}>
                    +{fmtINR(inc.amount)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="px-2 py-0.5 rounded text-xs font-medium capitalize"
                      style={{ background: "#F3F4F6", color: "#374151" }}
                    >
                      {inc.payment_mode || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(inc)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} style={{ color: "#737373" }} />
                      </button>
                      <button
                        onClick={() => handleDelete(inc.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showForm} onClose={() => setShowForm(false)} title={editingIncome ? "Edit Income" : "Add Income"}>
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
              placeholder="What was this income for? e.g. Old showcase sold, rent received"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
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
            <button type="button" className="btn-secondary text-sm" onClick={() => setShowForm(false)}>
              Cancel
            </button>
            <button type="submit" className="btn-primary text-sm flex items-center gap-1.5" disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {editingIncome ? "Update" : "Save"} Income
            </button>
          </div>
        </form>
      </Modal>

      {confirmModal}
    </div>
  );
}
