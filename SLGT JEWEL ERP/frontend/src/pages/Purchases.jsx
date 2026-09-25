import { useEffect, useState, useMemo, useCallback } from "react";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  Plus,
  X,
  Loader2,
  Check,
  CreditCard,
  PackageOpen,
  ChevronDown,
  Search,
  Trash2,
  FileText,
  IndianRupee,
  ShoppingCart,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import MoneyInput from "@/components/ui/MoneyInput";
import WeightInput from "@/components/ui/WeightInput";
import { fmtINR, parseMoneyInput } from "@/lib/format";
import { invoiceOccurredAt } from "@/lib/occurredAt";
import { useBusinessDate } from "@/context/BusinessDateContext";

import { asArray } from "@/lib/jsonFields";

// ─── Helpers ────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";

const PURCHASE_TYPES = [
  { value: "gold_bullion", label: "Gold Bullion" },
  { value: "finished_goods", label: "Finished Goods" },
  { value: "stones", label: "Stones" },
  { value: "karigar_work", label: "Karigar Work" },
  { value: "other", label: "Other" },
];

const PAYMENT_MODES = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "cheque", label: "Cheque" },
  { value: "credit", label: "Credit" },
];

const STATUS_CONFIG = {
  draft: { bg: "#F1F4ED", color: "#6B7280", label: "Draft" },
  received: { bg: "#DBEAFE", color: "#1D4ED8", label: "Received" },
  partially_paid: { bg: "#FEF3C7", color: "#B45309", label: "Partially Paid" },
  paid: { bg: "#D1FAE5", color: "#065F46", label: "Paid" },
};

const GOLD = "#B49042";

// Presentation-only trade-module canvas and control treatment.
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


function newItemRow(type) {
  return {
    _id: Math.random().toString(36).slice(2),
    description: "",
    qty: type === "gold_bullion" ? 1 : "",
    weight_g: "",
    purity: "",
    rate_per_g: "",
    unit_price: "",
    amount: 0,
  };
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children, wide = false, extraWide = false }) {
  useEffect(() => {
    if (!open) return;
    const fn = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  if (!open) return null;

  const widthClass = extraWide
    ? "w-full max-w-5xl"
    : wide
    ? "w-full max-w-2xl"
    : "w-full max-w-lg";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#20352A]/35 backdrop-blur-[2px]"
      style={{ background: "rgba(32,53,42,0.35)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className={`bg-[#FFFDF8] rounded-[14px] shadow-[0_18px_50px_rgba(35,58,43,0.18)] flex flex-col border border-[#DCE3D6] ${widthClass}`}
        style={{ maxHeight: "92vh" }}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0"
          style={{ borderColor: "#DCE3D6" }}
        >
          <h2 className="font-semibold text-base" style={{ color: "#2F3A32" }}>
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-[8px] hover:bg-[#F1F4ED] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors"
          >
            <X size={18} style={{ color: "#6E786F" }} />
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
      <label className="text-xs font-medium" style={{ color: "#6E786F" }}>
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.draft;
  return (
    <span
      className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  );
}

function TypeBadge({ type }) {
  const t = PURCHASE_TYPES.find((p) => p.value === type);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: "#F1F4ED", color: "#5F6D62" }}
    >
      {t ? t.label : type || "—"}
    </span>
  );
}

function SummaryCard({ label, value, icon: Icon, color }) {
  return (
    <div
      className="bg-[#FFFDF8] rounded-[10px] border p-4 flex items-start gap-3 shadow-[0_1px_2px_rgba(35,58,43,0.04)]"
      style={{ borderColor: "#DCE3D6" }}
    >
      <div
        className="w-9 h-9 rounded-[9px] border border-[#DCE3D6] flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}18` }}
      >
        <Icon size={18} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium mb-0.5" style={{ color: "#6E786F" }}>
          {label}
        </p>
        <p className="text-lg font-bold tabular-nums leading-tight" style={{ color: "#2F3A32" }}>
          {value}
        </p>
      </div>
    </div>
  );
}

// ─── Purchase Detail Modal ───────────────────────────────────────────────────

function PurchaseDetailModal({ purchase, onClose, onAddPayment }) {
  if (!purchase) return null;

  const items = asArray(purchase.items);
  const payments = asArray(purchase.payments);

  return (
    <Modal open={!!purchase} onClose={onClose} title={`Purchase — ${purchase.po_number || purchase.id}`} extraWide>
      <div className="flex flex-col gap-5">
        {/* Header info */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Vendor", value: purchase.vendor_name || "—" },
            { label: "Date", value: fmtDate(purchase.purchase_date) },
            { label: "Type", value: <TypeBadge type={purchase.purchase_type} /> },
            { label: "Status", value: <StatusBadge status={purchase.status} /> },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-xs font-medium mb-1" style={{ color: "#6E786F" }}>
                {label}
              </p>
              <div className="text-sm font-medium" style={{ color: "#2F3A32" }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* Items table */}
        <div>
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: "#6E786F" }}
          >
            Items
          </p>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#DCE3D6" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#F1F4ED", borderBottom: "1px solid #DCE3D6" }}>
                  {["Description", "Qty", "Weight(g)", "Purity", "Rate/g", "Unit Price", "Amount"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: "#6E786F" }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-6 text-center text-sm" style={{ color: "#6E786F" }}>
                      No items recorded.
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => (
                    <tr
                      key={item.id || idx}
                      style={{
                        borderBottom: idx < items.length - 1 ? "1px solid #DCE3D6" : "none",
                      }}
                    >
                      <td className="px-3 py-2.5 font-medium" style={{ color: "#2F3A32" }}>
                        {item.description || "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: "#5F6D62" }}>
                        {item.qty ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: "#5F6D62" }}>
                        {item.weight_g ?? "—"}
                      </td>
                      <td className="px-3 py-2.5" style={{ color: "#5F6D62" }}>
                        {item.purity || "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: "#5F6D62" }}>
                        {item.rate_per_g ? fmtINR(item.rate_per_g) : "—"}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums" style={{ color: "#5F6D62" }}>
                        {item.unit_price ? fmtINR(item.unit_price) : "—"}
                      </td>
                      <td
                        className="px-3 py-2.5 font-semibold tabular-nums"
                        style={{ color: "#2F3A32" }}
                      >
                        {fmtINR(item.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="w-64 flex flex-col gap-1">
            {[
              { label: "Subtotal", value: purchase.subtotal },
              {
                label: `GST (${purchase.gst_percent ?? 3}%)`,
                value: purchase.gst_amount,
              },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm" style={{ color: "#6E786F" }}>
                <span>{label}</span>
                <span className="tabular-nums">{fmtINR(value)}</span>
              </div>
            ))}
            <div
              className="flex justify-between text-sm font-bold pt-1 border-t mt-1"
              style={{ borderColor: "#DCE3D6", color: "#2F3A32" }}
            >
              <span>Grand Total</span>
              <span className="tabular-nums">{fmtINR(purchase.grand_total)}</span>
            </div>
            <div className="flex justify-between text-sm" style={{ color: "#16A34A" }}>
              <span>Paid</span>
              <span className="tabular-nums">{fmtINR(purchase.paid_amount)}</span>
            </div>
            <div
              className="flex justify-between text-sm font-semibold"
              style={{ color: Number(purchase.balance || 0) > 0 ? "#DC2626" : "#16A34A" }}
            >
              <span>Balance</span>
              <span className="tabular-nums">{fmtINR(purchase.balance)}</span>
            </div>
          </div>
        </div>

        {/* Payment history */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p
              className="text-xs font-semibold uppercase tracking-wide"
              style={{ color: "#6E786F" }}
            >
              Payment History
            </p>
            {["draft", "received", "partially_paid"].includes(purchase.status) && (
              <button
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: "#244B39", color: "#fff" }}
                onClick={() => onAddPayment(purchase)}
              >
                + Add Payment
              </button>
            )}
          </div>
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: "#DCE3D6" }}>
            {payments.length === 0 ? (
              <div className="py-6 text-center text-sm" style={{ color: "#6E786F" }}>
                No payments recorded yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#F1F4ED", borderBottom: "1px solid #DCE3D6" }}>
                    {["Date", "Mode", "Amount", "Reference", "Notes"].map((h) => (
                      <th
                        key={h}
                        className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide"
                        style={{ color: "#6E786F" }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p, idx) => (
                    <tr
                      key={p.id || idx}
                      style={{
                        borderBottom: idx < payments.length - 1 ? "1px solid #DCE3D6" : "none",
                      }}
                    >
                      <td className="px-3 py-2.5 text-xs" style={{ color: "#6E786F" }}>
                        {fmtDate(invoiceOccurredAt(p))}
                      </td>
                      <td className="px-3 py-2.5 capitalize" style={{ color: "#5F6D62" }}>
                        {p.payment_mode || p.mode || "—"}
                      </td>
                      <td
                        className="px-3 py-2.5 font-semibold tabular-nums"
                        style={{ color: "#16A34A" }}
                      >
                        {fmtINR(p.amount)}
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: "#6E786F" }}>
                        {p.reference || "—"}
                      </td>
                      <td className="px-3 py-2.5 text-xs" style={{ color: "#6E786F" }}>
                        {p.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {purchase.notes && (
          <div
            className="rounded-xl p-4 text-sm"
            style={{ background: "#F1F4ED", color: "#5F6D62", borderColor: "#DCE3D6", border: "1px solid #DCE3D6" }}
          >
            <span className="font-medium" style={{ color: "#6E786F" }}>Notes: </span>
            {purchase.notes}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Add Payment Modal ───────────────────────────────────────────────────────

const PAYMENT_DEFAULTS = {
  payment_mode: "cash",
  amount: "",
  reference: "",
  payment_date: todayStr(),
  notes: "",
};

function AddPaymentModal({ purchase, onClose, onSaved }) {
  const { date: activeBillingDate } = useBusinessDate();
  const [form, setForm] = useState(PAYMENT_DEFAULTS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (purchase) {
      setForm({
        ...PAYMENT_DEFAULTS,
        payment_date: activeBillingDate || todayStr(),
        amount: purchase.balance > 0 ? String(Number(purchase.balance).toFixed(2)) : "",
      });
    }
  }, [purchase, activeBillingDate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.amount || parseMoneyInput(form.amount) <= 0) {
      return toast.error("Enter a valid payment amount");
    }
    setSaving(true);
    try {
      await api.post(`/purchases/${purchase.id}/payment`, {
        ...form,
        amount: parseMoneyInput(form.amount),
      });
      toast.success("Payment recorded");
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to record payment");
    } finally {
      setSaving(false);
    }
  };

  if (!purchase) return null;

  return (
    <Modal
      open={!!purchase}
      onClose={onClose}
      title={`Add Payment — ${purchase.po_number || purchase.id}`}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div
          className="rounded-xl p-3 text-sm flex items-center gap-2"
          style={{ background: "#FEF3C7", color: "#92400E" }}
        >
          <AlertCircle size={15} />
          <span>
            Outstanding balance:{" "}
            <span className="font-bold">{fmtINR(purchase.balance)}</span>
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
          <Field label="Amount (₹)" required>
            <MoneyInput
              min="0.01"
              step="0.01"
              className="input"
              placeholder="0.00"
              value={form.amount}
              onValueChange={(raw) => setForm({ ...form, amount: raw })}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Payment Date" required>
            <input
              type="date"
              className="input"
              value={form.payment_date}
              onChange={(e) => setForm({ ...form, payment_date: e.target.value })}
              required
            />
          </Field>
          <Field label="Reference No.">
            <input
              type="text"
              className="input"
              placeholder="Cheque / UTR / Ref no."
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            className="input"
            rows={2}
            placeholder="Optional notes…"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            style={{ resize: "vertical" }}
          />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary text-sm flex items-center gap-1.5"
            disabled={saving}
            style={{ background: GOLD, borderColor: GOLD }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Record Payment
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Tab 1: Purchase List ────────────────────────────────────────────────────

function PurchaseListTab({ vendors, onNewPurchase }) {
  const [purchases, setPurchases] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    from: "",
    to: "",
    vendor_id: "",
    type: "",
    status: "",
  });
  const [detailPurchase, setDetailPurchase] = useState(null);
  const [paymentPurchase, setPaymentPurchase] = useState(null);

  const loadPurchases = useCallback(() => {
    setLoading(true);
    const params = {};
    if (filters.from) params.from_date = filters.from;
    if (filters.to) params.to_date = filters.to;
    if (filters.vendor_id) params.vendor_id = filters.vendor_id;
    if (filters.type) params.purchase_type = filters.type;
    if (filters.status) params.status = filters.status;
    params.limit = 200;

    api
      .get("/purchases", { params })
      .then(({ data }) => setPurchases(Array.isArray(data) ? data : data.data || []))
      .catch(() => toast.error("Failed to load purchases"))
      .finally(() => setLoading(false));
  }, [filters]);

  const loadSummary = useCallback(() => {
    api
      .get("/purchases/summary")
      .then(({ data }) => setSummary(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPurchases();
    loadSummary();
  }, [loadPurchases, loadSummary]);

  const handleRowClick = async (p) => {
    try {
      const { data } = await api.get(`/purchases/${p.id}`);
      setDetailPurchase(data);
    } catch {
      setDetailPurchase(p);
    }
  };

  const handleAddPaymentClick = (e, p) => {
    e.stopPropagation();
    setPaymentPurchase(p);
  };

  const handlePaymentSaved = () => {
    loadPurchases();
    loadSummary();
    setDetailPurchase(null);
  };

  const setFilter = (key, val) => setFilters((f) => ({ ...f, [key]: val }));

  return (
    <div className="flex flex-col gap-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard
          label="Total Purchases"
          value={summary ? String(summary.total_count ?? purchases.length) : String(purchases.length)}
          icon={ShoppingCart}
          color="#3B82F6"
        />
        <SummaryCard
          label="Total Value"
          value={fmtINR(summary?.total_value ?? purchases.reduce((s, p) => s + Number(p.grand_total || 0), 0))}
          icon={IndianRupee}
          color={GOLD}
        />
        <SummaryCard
          label="Total Paid"
          value={fmtINR(summary?.total_paid ?? purchases.reduce((s, p) => s + Number(p.paid_amount || 0), 0))}
          icon={Check}
          color="#16A34A"
        />
        <SummaryCard
          label="Outstanding"
          value={fmtINR(summary?.total_outstanding ?? purchases.reduce((s, p) => s + Number(p.balance || 0), 0))}
          icon={AlertCircle}
          color="#DC2626"
        />
      </div>

      {/* Filters */}
      <div
        className="bg-[#FFFDF8] rounded-[10px] border p-4 flex flex-wrap items-end gap-3 shadow-[0_1px_2px_rgba(35,58,43,0.04)]"
        style={{ borderColor: "#DCE3D6" }}
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: "#6E786F" }}>
            From
          </label>
          <input
            type="date"
            className="input w-36"
            value={filters.from}
            onChange={(e) => setFilter("from", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: "#6E786F" }}>
            To
          </label>
          <input
            type="date"
            className="input w-36"
            value={filters.to}
            onChange={(e) => setFilter("to", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: "#6E786F" }}>
            Vendor
          </label>
          <select
            className="input w-44"
            value={filters.vendor_id}
            onChange={(e) => setFilter("vendor_id", e.target.value)}
          >
            <option value="">All Vendors</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: "#6E786F" }}>
            Type
          </label>
          <select
            className="input w-40"
            value={filters.type}
            onChange={(e) => setFilter("type", e.target.value)}
          >
            <option value="">All Types</option>
            {PURCHASE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium" style={{ color: "#6E786F" }}>
            Status
          </label>
          <select
            className="input w-40"
            value={filters.status}
            onChange={(e) => setFilter("status", e.target.value)}
          >
            <option value="">All Statuses</option>
            {Object.entries(STATUS_CONFIG).map(([val, cfg]) => (
              <option key={val} value={val}>
                {cfg.label}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn-secondary text-sm"
          onClick={() => setFilters({ from: "", to: "", vendor_id: "", type: "", status: "" })}
        >
          Clear
        </button>
      </div>

      {/* Table */}
      <div
        className="bg-[#FFFDF8] rounded-[10px] border overflow-hidden shadow-[0_1px_2px_rgba(35,58,43,0.04)]"
        style={{ borderColor: "#DCE3D6" }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#F1F4ED", borderBottom: "1px solid #DCE3D6" }}>
              {[
                "PO No.",
                "Date",
                "Vendor",
                "Type",
                "Items",
                "Grand Total",
                "Paid",
                "Balance",
                "Status",
                "Actions",
              ].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide"
                  style={{ color: "#6E786F" }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={10} className="p-0">
                  <div className="px-4 pt-4"><PageLoadingBadge /></div>
                  <TableSkeleton rows={8} cols={10} />
                </td>
              </tr>
            ) : purchases.length === 0 ? (
              <tr>
                <td colSpan={10} className="text-center py-14" style={{ color: "#6E786F" }}>
                  No purchases found.
                </td>
              </tr>
            ) : (
              purchases.map((p, idx) => (
                <tr
                  key={p.id}
                  onClick={() => handleRowClick(p)}
                  className="hover:bg-[#F7F9F4] transition-colors cursor-pointer"
                  style={{
                    borderBottom: idx < purchases.length - 1 ? "1px solid #DCE3D6" : "none",
                  }}
                >
                  <td className="px-4 py-3 font-mono text-xs font-medium" style={{ color: GOLD }}>
                    {p.po_number || `PO-${p.id?.slice(0, 6) || idx + 1}`}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "#6E786F" }}>
                    {fmtDate(p.purchase_date)}
                  </td>
                  <td className="px-4 py-3 font-medium" style={{ color: "#2F3A32" }}>
                    {p.vendor_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <TypeBadge type={p.purchase_type} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-center" style={{ color: "#5F6D62" }}>
                    {p.item_count ?? (p.items?.length ?? "—")}
                  </td>
                  <td
                    className="px-4 py-3 font-semibold tabular-nums"
                    style={{ color: "#2F3A32" }}
                  >
                    {fmtINR(p.grand_total)}
                  </td>
                  <td
                    className="px-4 py-3 tabular-nums"
                    style={{ color: "#16A34A" }}
                  >
                    {fmtINR(p.paid_amount)}
                  </td>
                  <td
                    className="px-4 py-3 tabular-nums font-medium"
                    style={{ color: Number(p.balance || 0) > 0 ? "#DC2626" : "#6B7280" }}
                  >
                    {fmtINR(p.balance)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {(p.status === "partially_paid" || p.status === "received" || p.status === "draft") && (
                        <button
                          onClick={(e) => handleAddPaymentClick(e, p)}
                          className="text-xs px-2 py-1 rounded-lg font-medium transition-colors"
                          style={{ background: `${GOLD}18`, color: GOLD }}
                          title="Add Payment"
                        >
                          Pay
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail modal */}
      {detailPurchase && (
        <PurchaseDetailModal
          purchase={detailPurchase}
          onClose={() => setDetailPurchase(null)}
          onAddPayment={(p) => {
            setDetailPurchase(null);
            setPaymentPurchase(p);
          }}
        />
      )}

      {/* Add payment modal */}
      {paymentPurchase && (
        <AddPaymentModal
          purchase={paymentPurchase}
          onClose={() => setPaymentPurchase(null)}
          onSaved={handlePaymentSaved}
        />
      )}
    </div>
  );
}

// ─── Tab 2: New Purchase Form ────────────────────────────────────────────────

const FORM_DEFAULTS = {
  vendor_id: "",
  purchase_date: todayStr(),
  purchase_type: "finished_goods",
  gst_percent: 3,
  payment_mode: "cash",
  initial_payment: "",
  notes: "",
};

function calcItemAmount(item, type) {
  if (type === "gold_bullion") {
    const w = parseFloat(item.weight_g) || 0;
    const r = parseMoneyInput(item.rate_per_g);
    return w * r;
  }
  // finished_goods / stones / karigar_work / other
  const qty = parseFloat(item.qty) || 0;
  const up = parseMoneyInput(item.unit_price);
  return qty * up;
}

function ItemRow({ item, type, onChange, onRemove, showRemove }) {
  const update = (field, val) => {
    const updated = { ...item, [field]: val };
    // Amount defaults to qty/weight x rate, but the shop can override it
    // directly (rounding, a negotiated lump sum, etc.) — only recompute it
    // when one of the driving fields changes, not when the user edits it.
    if (field !== "amount") {
      updated.amount = calcItemAmount(updated, type);
    }
    onChange(updated);
  };

  const inputCls =
    "w-full border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-shadow";
  const inputStyle = { borderColor: "#DCE3D6" };

  return (
    <tr>
      {/* Description */}
      <td className="px-2 py-2">
        <input
          type="text"
          className={inputCls}
          style={inputStyle}
          placeholder="e.g. 22K Bangle"
          value={item.description}
          onChange={(e) => update("description", e.target.value)}
        />
      </td>
      {/* Qty — always editable, regardless of purchase type */}
      <td className="px-2 py-2">
        <input
          type="text" inputMode="decimal"
          min="0"
          step="1"
          className={inputCls}
          style={inputStyle}
          placeholder="1"
          value={item.qty}
          onChange={(e) => update("qty", e.target.value)}
        />
      </td>
      {/* Weight — always editable, regardless of purchase type */}
      <td className="px-2 py-2">
        <WeightInput
          className={inputCls}
          style={inputStyle}
          placeholder="0.000"
          value={item.weight_g}
          onValueChange={(raw) => update("weight_g", raw)}
        />
      </td>
      {/* Purity */}
      <td className="px-2 py-2">
        <input
          type="text"
          className={inputCls}
          style={inputStyle}
          placeholder="22K / 916"
          value={item.purity}
          onChange={(e) => update("purity", e.target.value)}
        />
      </td>
      {/* Rate/g — always editable, regardless of purchase type */}
      <td className="px-2 py-2">
        <MoneyInput
          min="0"
          step="0.01"
          className={inputCls}
          style={inputStyle}
          placeholder="0.00"
          value={item.rate_per_g}
          onValueChange={(raw) => update("rate_per_g", raw)}
        />
      </td>
      {/* Unit Price — always editable, regardless of purchase type */}
      <td className="px-2 py-2">
        <MoneyInput
          min="0"
          step="0.01"
          className={inputCls}
          style={inputStyle}
          placeholder="0.00"
          value={item.unit_price}
          onValueChange={(raw) => update("unit_price", raw)}
        />
      </td>
      {/* Amount — defaults to the calculated value, but editable */}
      <td className="px-2 py-2" style={{ minWidth: 100 }}>
        <MoneyInput
          min="0"
          step="0.01"
          className={inputCls + " text-right font-medium tabular-nums"}
          style={inputStyle}
          placeholder="0.00"
          value={item.amount}
          onValueChange={(raw) => update("amount", raw)}
        />
      </td>
      {/* Remove */}
      <td className="px-2 py-2 text-center">
        {showRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1 rounded-[8px] hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8B5B2] transition-colors"
          >
            <Trash2 size={14} className="text-red-400" />
          </button>
        )}
      </td>
    </tr>
  );
}

function NewPurchaseTab({ vendors, onSaved }) {
  const { date: activeBillingDate } = useBusinessDate();
  const [form, setForm] = useState(FORM_DEFAULTS);
  const [items, setItems] = useState([newItemRow(FORM_DEFAULTS.purchase_type)]);
  const [saving, setSaving] = useState(false);

  // FORM_DEFAULTS.purchase_date is a static module-level value (evaluated once at
  // import time) — always re-point it at the shop's active transaction date, not
  // the real calendar date, once that's known.
  useEffect(() => {
    if (activeBillingDate) setForm((f) => ({ ...f, purchase_date: activeBillingDate }));
  }, [activeBillingDate]);

  // Reset items when purchase type changes (gold vs others)
  const handleTypeChange = (type) => {
    setForm((f) => ({ ...f, purchase_type: type }));
    setItems([newItemRow(type)]);
  };

  const addItem = () => setItems((prev) => [...prev, newItemRow(form.purchase_type)]);

  const updateItem = (idx, updated) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? updated : it)));
  };

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const subtotal = useMemo(() => items.reduce((s, it) => s + Number(it.amount || 0), 0), [items]);
  const gstAmt = useMemo(() => (subtotal * Number(form.gst_percent || 0)) / 100, [subtotal, form.gst_percent]);
  const grandTotal = subtotal + gstAmt;

  const buildPayload = (status) => ({
    vendor_id: form.vendor_id || null,
    purchase_date: form.purchase_date,
    purchase_type: form.purchase_type,
    gst_pct: Number(form.gst_percent),
    gst_percent: Number(form.gst_percent),
    subtotal,
    gst_amount: gstAmt,
    grand_total: grandTotal,
    paid_amount: parseMoneyInput(form.initial_payment),
    payment_mode: form.payment_mode || "cash",
    notes: form.notes,
    status,
    items: items.map((it) => ({
      description: it.description,
      quantity: it.qty !== "" ? Number(it.qty) : 1,
      qty: it.qty !== "" ? Number(it.qty) : 1,
      weight_g: it.weight_g !== "" ? Number(it.weight_g) : null,
      purity: it.purity || null,
      rate_per_g: it.rate_per_g !== "" ? parseMoneyInput(it.rate_per_g) : null,
      unit_price: it.unit_price !== "" ? parseMoneyInput(it.unit_price) : null,
      amount: Number(it.amount || 0),
      inventory_mode: form.purchase_type === "finished_goods" ? "unique_tag" : "quantity",
      create_tag: form.purchase_type === "finished_goods",
    })),
  });

  const handleSave = async (status) => {
    if (!form.purchase_date) return toast.error("Purchase date is required");
    if (items.length === 0) return toast.error("Add at least one item");
    if (items.some((it) => !it.description.trim())) return toast.error("All items need a description");

    setSaving(true);
    try {
      await api.post("/purchases", buildPayload(status));
      toast.success(
        status === "draft" ? "Purchase saved as draft" : "Purchase recorded as received"
      );
      // Reset form
      setForm({ ...FORM_DEFAULTS, purchase_date: activeBillingDate || FORM_DEFAULTS.purchase_date });
      setItems([newItemRow(FORM_DEFAULTS.purchase_type)]);
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to save purchase");
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    "w-full border rounded-[9px] px-3 py-2 text-sm text-[#2F3A32] bg-white placeholder-[#9AA69C] focus:outline-none focus:border-[#66806B] focus:shadow-[0_0_0_3px_rgba(102,128,107,0.14)] transition-shadow";
  const inputStyle = { borderColor: "#C8D4C7" };

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-5">
      {/* Header section */}
      <div className="bg-[#FFFDF8] rounded-[10px] border shadow-[0_1px_2px_rgba(35,58,43,0.04)] p-5" style={{ borderColor: "#DCE3D6" }}>
        <h3
          className="text-xs font-semibold uppercase tracking-wide mb-4"
          style={{ color: "#6E786F" }}
        >
          Purchase Details
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Vendor">
            <select
              className={inputCls}
              style={inputStyle}
              value={form.vendor_id}
              onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
            >
              <option value="">— Select vendor —</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Purchase Date" required>
            <input
              type="date"
              className={inputCls}
              style={inputStyle}
              value={form.purchase_date}
              onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
              required
            />
          </Field>
          <Field label="Purchase Type" required>
            <div className="flex flex-wrap gap-1.5">
              {PURCHASE_TYPES.map((t) => {
                const active = form.purchase_type === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => handleTypeChange(t.value)}
                    className="px-2.5 py-1.5 rounded-[9px] text-xs font-medium transition-all border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
                    style={{
                      background: active ? "#244B39" : "#F1F4ED",
                      color: active ? "#fff" : "#5F6D62",
                      borderColor: active ? "#244B39" : "#DCE3D6",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </div>

      {/* Items section */}
      <div className="bg-[#FFFDF8] rounded-[10px] border shadow-[0_1px_2px_rgba(35,58,43,0.04)] p-5" style={{ borderColor: "#DCE3D6" }}>
        <div className="flex items-center justify-between mb-4">
          <h3
            className="text-xs font-semibold uppercase tracking-wide"
            style={{ color: "#6E786F" }}
          >
            Items
          </h3>
          <button
            type="button"
            onClick={addItem}
            className="text-xs font-medium px-3 py-1.5 rounded-[9px] flex items-center gap-1 transition-colors border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] hover:bg-[#E8EFE5]"
            style={{ background: "#F1F4ED", color: "#5F6D62", borderColor: "#DCE3D6" }}
          >
            <Plus size={12} />
            Add Item
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #DCE3D6" }}>
                {[
                  { label: "Description", w: "min-w-[160px]" },
                  { label: "Qty", w: "w-20" },
                  { label: "Weight (g)", w: "w-24" },
                  { label: "Purity", w: "w-20" },
                  { label: "Rate/g", w: "w-24" },
                  { label: "Unit Price", w: "w-24" },
                  { label: "Amount", w: "w-24 text-right" },
                  { label: "", w: "w-8" },
                ].map(({ label, w }) => (
                  <th
                    key={label}
                    className={`px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide ${w}`}
                    style={{ color: "#6E786F" }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <ItemRow
                  key={item._id}
                  item={item}
                  type={form.purchase_type}
                  onChange={(updated) => updateItem(idx, updated)}
                  onRemove={() => removeItem(idx)}
                  showRemove={items.length > 1}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Totals + Payment section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Totals */}
        <div className="bg-[#FFFDF8] rounded-[10px] border shadow-[0_1px_2px_rgba(35,58,43,0.04)] p-5" style={{ borderColor: "#DCE3D6" }}>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-4"
            style={{ color: "#6E786F" }}
          >
            Totals
          </h3>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between text-sm" style={{ color: "#6E786F" }}>
              <span>Subtotal</span>
              <span className="tabular-nums font-medium" style={{ color: "#2F3A32" }}>
                {fmtINR(subtotal)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: "#6E786F" }}>
                  GST
                </span>
                <input
                  type="text" inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.5"
                  className="border rounded px-2 py-1 text-sm w-16 tabular-nums text-center"
                  style={{ borderColor: "#DCE3D6" }}
                  value={form.gst_percent}
                  onChange={(e) => setForm({ ...form, gst_percent: e.target.value })}
                />
                <span className="text-sm" style={{ color: "#6E786F" }}>
                  %
                </span>
              </div>
              <span className="tabular-nums text-sm font-medium" style={{ color: "#2F3A32" }}>
                {fmtINR(gstAmt)}
              </span>
            </div>
            <div
              className="flex justify-between font-bold text-base pt-2 border-t"
              style={{ borderColor: "#DCE3D6", color: "#2F3A32" }}
            >
              <span>Grand Total</span>
              <span className="tabular-nums" style={{ color: GOLD }}>
                {fmtINR(grandTotal)}
              </span>
            </div>
          </div>
        </div>

        {/* Payment */}
        <div className="bg-[#FFFDF8] rounded-[10px] border shadow-[0_1px_2px_rgba(35,58,43,0.04)] p-5" style={{ borderColor: "#DCE3D6" }}>
          <h3
            className="text-xs font-semibold uppercase tracking-wide mb-4"
            style={{ color: "#6E786F" }}
          >
            Initial Payment (Optional)
          </h3>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Payment Mode">
                <select
                  className={inputCls}
                  style={inputStyle}
                  value={form.payment_mode}
                  onChange={(e) => setForm({ ...form, payment_mode: e.target.value })}
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Amount (₹)">
                <MoneyInput
                  min="0"
                  step="0.01"
                  className={inputCls}
                  style={inputStyle}
                  placeholder="0.00"
                  value={form.initial_payment}
                  onValueChange={(raw) => setForm({ ...form, initial_payment: raw })}
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea
                className={inputCls}
                style={{ ...inputStyle, resize: "vertical" }}
                rows={3}
                placeholder="Additional notes for this purchase…"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </div>

      {/* Save buttons */}
      <div
        className="bg-[#FFFDF8] rounded-[10px] border shadow-[0_1px_2px_rgba(35,58,43,0.04)] p-4 flex items-center justify-between"
        style={{ borderColor: "#DCE3D6" }}
      >
        <p className="text-sm" style={{ color: "#6E786F" }}>
          Grand Total:{" "}
          <span className="font-bold text-base" style={{ color: GOLD }}>
            {fmtINR(grandTotal)}
          </span>
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="btn-secondary text-sm flex items-center gap-1.5"
            onClick={() => handleSave("draft")}
            disabled={saving}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileText size={14} />
            )}
            Save as Draft
          </button>
          <button
            type="button"
            className="text-sm flex items-center gap-1.5 px-4 py-2 rounded-[9px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
            style={{ background: "#244B39", color: "#fff" }}
            onClick={() => handleSave("received")}
            disabled={saving}
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <PackageOpen size={14} />
            )}
            Mark as Received
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const TABS = [
  { id: "list", label: "Purchase List", icon: ShoppingCart },
  { id: "new", label: "New Purchase", icon: Plus },
];

export default function Purchases() {
  const [activeTab, setActiveTab] = useState("list");
  const [vendors, setVendors] = useState([]);

  useEffect(() => {
    api
      .get("/vendors")
      .then(({ data }) => setVendors(Array.isArray(data) ? data : data.items || []))
      .catch(() => {});
  }, []);

  const handleSaved = () => {
    setActiveTab("list");
  };

  return (
    <div className={`${TRADE_PAGE_CLASS} flex flex-col h-full`} style={{ minHeight: "100vh" }}>
      {/* Page header */}
      <div
        className="bg-[#FFFDF8] border-b px-6 pt-6 pb-0"
        style={{ borderColor: "#DCE3D6" }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "#2F3A32" }}>
              Purchases
            </h1>
            <p className="text-sm mt-0.5" style={{ color: "#6E786F" }}>
              Manage vendor purchases — gold bullion, finished goods, karigar work &amp; more
            </p>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = activeTab === id;
            return (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors"
                style={{
                  color: active ? "#244B39" : "#6E786F",
                  background: active ? "#F1F4ED" : "transparent",
                  borderBottom: active ? "2px solid #244B39" : "2px solid transparent",
                }}
              >
                <Icon size={15} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 p-6">
        {activeTab === "list" && (
          <PurchaseListTab
            vendors={vendors}
            onNewPurchase={() => setActiveTab("new")}
          />
        )}
        {activeTab === "new" && (
          <NewPurchaseTab vendors={vendors} onSaved={handleSaved} />
        )}
      </div>
    </div>
  );
}
