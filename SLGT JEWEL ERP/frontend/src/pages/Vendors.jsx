import { useEffect, useState, useMemo } from "react";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  Search,
  Plus,
  X,
  Phone,
  Mail,
  MapPin,
  FileText,
  Edit2,
  Users,
  UserCheck,
  TrendingDown,
  ShoppingCart,
  Building2,
  CreditCard,
  Landmark,
  ChevronRight,
  AlertTriangle,
  ClipboardList,
  Wrench,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR, fmtDate, parseMoneyInput } from "@/lib/format";
import useConfirm from "@/hooks/useConfirm";

// ─── Constants ──────────────────────────────────────────────────────────────────

const VENDOR_TYPES = [
  { value: "gold_supplier", label: "Gold Supplier" },
  { value: "stone_supplier", label: "Stone Supplier" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "karigar", label: "Karigar" },
  { value: "other", label: "Other" },
];

const TYPE_BADGE = {
  gold_supplier: "bg-[#FDFBF7] text-[#8A6D2F] border border-[#EADFBF]",
  stone_supplier: "bg-[#F1F4ED] text-[#526B59] border border-[#D5E0D2]",
  manufacturer: "bg-[#F2F0F7] text-[#6B5C82] border border-[#DDD7E8]",
  karigar: "bg-[#EDF4EE] text-[#356747] border border-[#CFE1D1]",
  other: "bg-[#F1F4ED] text-[#66736A] border border-[#DCE3D6]",
};

const TYPE_LABELS = {
  gold_supplier: "Gold Supplier",
  stone_supplier: "Stone Supplier",
  manufacturer: "Manufacturer",
  karigar: "Karigar",
  other: "Other",
};

const FILTER_PILLS = [
  { value: "", label: "All" },
  { value: "gold_supplier", label: "Gold Supplier" },
  { value: "stone_supplier", label: "Stone Supplier" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "karigar", label: "Karigar" },
  { value: "other", label: "Other" },
];

const ORDER_STATUS_META = {
  received: { label: "Received", cls: "bg-[#F1F4ED] text-[#5F6D62] border border-[#DCE3D6]" },
  karigar_assigned: { label: "Karigar Assigned", cls: "bg-blue-100 text-blue-700 border border-blue-200" },
  in_progress: { label: "In Progress", cls: "bg-amber-100 text-amber-700 border border-amber-200" },
  quality_check: { label: "Quality Check", cls: "bg-purple-100 text-purple-700 border border-purple-200" },
  ready: { label: "Ready", cls: "bg-green-100 text-green-700 border border-green-200" },
  delivered: { label: "Delivered", cls: "bg-emerald-800 text-emerald-50 border border-emerald-900" },
  cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-700 border border-red-200" },
};

const EMPTY_FORM = {
  name: "",
  type: "gold_supplier",
  contact_person: "",
  mobile: "",
  email: "",
  address: "",
  gst_number: "",
  pan_number: "",
  bank_name: "",
  account_no: "",
  ifsc_code: "",
  branch_name: "",
  credit_limit: "",
  credit_days: "",
  notes: "",
};

// Presentation-only trade-module canvas and control treatment.  Keep the
// existing component APIs and handlers intact; these utilities only align the
// page with the warm neutral shell used by the rest of the ERP.
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


function getInitials(name = "") {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const AVATAR_COLORS = [
  "bg-[#FDFBF7] text-[#8A6D2F]",
  "bg-[#F1F4ED] text-[#526B59]",
  "bg-[#F2F0F7] text-[#6B5C82]",
  "bg-[#EDF4EE] text-[#356747]",
  "bg-[#F8EEEE] text-[#8A4A4A]",
  "bg-[#EEF0F7] text-[#4F5D82]",
  "bg-[#EAF4F1] text-[#356B60]",
  "bg-[#EEF3F7] text-[#4B667A]",
];

function avatarColor(name = "") {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ─── Stat Card ──────────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color = "text-[#2F3A32]", sub }) {
  return (
    <div className="bg-[#FFFDF8] border border-[#DCE3D6] rounded-[10px] p-4 flex items-center gap-4 shadow-[0_1px_2px_rgba(35,58,43,0.04)]">
      <div className="w-10 h-10 rounded-[9px] bg-[#F1F4ED] border border-[#DCE3D6] flex items-center justify-center shrink-0">
        <Icon size={18} strokeWidth={1.5} className="text-[#6E786F]" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-[#6E786F] font-medium uppercase tracking-wide truncate">{label}</p>
        <p className={`text-xl font-semibold leading-tight ${color}`}>{value ?? "—"}</p>
        {sub && <p className="text-[11px] text-[#8D998F] mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Type Badge ─────────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  return (
    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${TYPE_BADGE[type] || TYPE_BADGE.other}`}>
      {TYPE_LABELS[type] || type}
    </span>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full ${
        isActive
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-red-50 text-red-600 border border-red-200"
      }`}
    >
      {isActive ? "Active" : "Inactive"}
    </span>
  );
}

// ─── Label helper ───────────────────────────────────────────────────────────────

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.08em] font-semibold text-[#6E786F] mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

const IC = "w-full border border-[#C8D4C7] rounded-[9px] px-3 py-2 text-[13px] text-[#2F3A32] bg-white placeholder-[#9AA69C] focus:outline-none focus:border-[#66806B] focus:shadow-[0_0_0_3px_rgba(102,128,107,0.14)] transition-colors";

// ─── Vendor Detail Panel ─────────────────────────────────────────────────────────

function DetailPanel({ vendor, onClose, onEdit, onMarkInactive }) {
  const [assignedOrders, setAssignedOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const isKarigar = vendor?.type === "karigar";

  useEffect(() => {
    if (!vendor?.id || !isKarigar) {
      setAssignedOrders([]);
      return;
    }
    let cancelled = false;
    setOrdersLoading(true);
    api
      .get("/orders", { params: { karigar_vendor_id: vendor.id, limit: 100 } })
      .then(({ data }) => {
        if (cancelled) return;
        const rows = Array.isArray(data) ? data : data?.orders || data?.items || [];
        setAssignedOrders(rows);
      })
      .catch(() => {
        if (!cancelled) setAssignedOrders([]);
      })
      .finally(() => {
        if (!cancelled) setOrdersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [vendor?.id, isKarigar]);

  if (!vendor) return null;
  const initials = getInitials(vendor.name);
  const colorClass = avatarColor(vendor.name);
  const isActive = vendor.status === "active";

  const openCount = assignedOrders.filter(
    (o) => o.status !== "delivered" && o.status !== "cancelled"
  ).length;

  const row = (Icon, label, value) => {
    if (!value && value !== 0) return null;
    return (
      <div className="flex gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#F1F4ED] flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={14} strokeWidth={1.5} className="text-[#6E786F]" />
        </div>
        <div>
          <p className="text-[11px] text-[#6E786F] font-medium uppercase tracking-wide">{label}</p>
          <p className="text-[13px] text-[#2F3A32] break-words">{value}</p>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#20352A]/30 backdrop-blur-[2px]" onClick={onClose}>
      <div
        className="relative w-full max-w-md bg-[#FFFDF8] h-full shadow-[0_18px_50px_rgba(35,58,43,0.18)] overflow-y-auto flex flex-col border-l border-[#DCE3D6]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DCE3D6]">
          <h2 className="text-[15px] font-semibold text-[#2F3A32]">
            {isKarigar ? "Karigar Details" : "Vendor Details"}
          </h2>
          <button onClick={onClose} className="text-[#6E786F] hover:text-[#2F3A32] transition-colors">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Profile */}
        <div className="px-6 py-5 flex items-center gap-4 border-b border-[#DCE3D6] bg-[#F1F4ED]">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-[20px] font-bold shrink-0 ${colorClass}`}>
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold text-[#2F3A32] truncate">{vendor.name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <TypeBadge type={vendor.type} />
              <StatusBadge status={vendor.status} />
            </div>
            {vendor.contact_person && (
              <p className="text-[12px] text-[#6E786F] mt-1">Contact: {vendor.contact_person}</p>
            )}
          </div>
        </div>

        {/* Financial Summary */}
        <div className="px-6 py-4 border-b border-[#DCE3D6] grid grid-cols-2 gap-3">
          <div className="bg-[#F1F4ED] border border-[#DCE3D6] rounded-xl p-3">
            <p className="text-[10px] text-[#6E786F] font-medium uppercase tracking-wide">Outstanding Balance</p>
            <p className="text-[16px] font-semibold text-red-600 mt-0.5">
              {fmtINR(vendor.outstanding_balance || 0)}
            </p>
          </div>
          <div className="bg-[#F1F4ED] border border-[#DCE3D6] rounded-xl p-3">
            <p className="text-[10px] text-[#6E786F] font-medium uppercase tracking-wide">
              {isKarigar ? "Open Jobs" : "Total Purchases"}
            </p>
            <p className="text-[16px] font-semibold text-[#2F3A32] mt-0.5">
              {isKarigar
                ? (ordersLoading ? "…" : openCount)
                : fmtINR(vendor.total_purchases || 0)}
            </p>
          </div>
        </div>

        {/* Assigned orders for karigar */}
        {isKarigar && (
          <div className="px-6 py-4 border-b border-[#DCE3D6]">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#6E786F]">
                Assigned Orders
              </p>
              <span className="text-[11px] text-[#8D998F]">
                {ordersLoading ? "Loading…" : `${assignedOrders.length} total`}
              </span>
            </div>
            {ordersLoading ? (
              <div className="flex items-center gap-2 text-[12px] text-[#6E786F] py-4 justify-center">
                <Loader2 size={14} className="animate-spin" /> Loading orders…
              </div>
            ) : assignedOrders.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#DCE3D6] bg-[#F1F4ED] px-4 py-6 text-center">
                <ClipboardList size={20} className="mx-auto text-[#d4d4d4] mb-2" />
                <p className="text-[13px] text-[#6E786F]">No orders assigned yet</p>
                <p className="text-[11px] text-[#8D998F] mt-1">
                  Assign this karigar from Orders → order details
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
                {assignedOrders.map((o) => {
                  const meta = ORDER_STATUS_META[o.status] || ORDER_STATUS_META.received;
                  const TypeIcon = o.type === "repair" ? Wrench : ClipboardList;
                  return (
                    <div
                      key={o.id}
                      className="rounded-xl border border-[#DCE3D6] bg-white px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <TypeIcon size={12} className="text-[#8D998F] shrink-0" />
                            <span className="text-[12px] font-semibold text-[#2F3A32] truncate">
                              {o.order_no}
                            </span>
                            <span className="text-[10px] text-[#8D998F] shrink-0">
                              {o.type === "repair" ? "Repair" : "Custom"}
                            </span>
                          </div>
                          <p className="text-[12px] text-[#5F6D62] mt-0.5 truncate">
                            {o.customer_name}
                          </p>
                          <p className="text-[11px] text-[#8D998F] mt-0.5 line-clamp-2">
                            {o.description}
                          </p>
                        </div>
                        <span className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${meta.cls}`}>
                          {meta.label}
                        </span>
                      </div>
                      {o.delivery_date && (
                        <p className="text-[10px] text-[#8D998F] mt-1.5">
                          Delivery: {fmtDate(o.delivery_date)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Details */}
        <div className="px-6 py-5 space-y-4 flex-1">
          {row(Phone, "Mobile", vendor.mobile)}
          {row(Mail, "Email", vendor.email)}
          {row(MapPin, "Address", vendor.address)}
          {row(FileText, "GST Number", vendor.gst_number)}
          {row(FileText, "PAN Number", vendor.pan_number)}

          {/* Bank Details */}
          {(vendor.bank_name || vendor.account_no || vendor.ifsc_code) && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#6E786F] mb-2">Bank Details</p>
              <div className="bg-[#F1F4ED] border border-[#DCE3D6] rounded-xl p-3 space-y-1.5">
                {vendor.bank_name && (
                  <div className="flex items-center gap-2">
                    <Landmark size={12} strokeWidth={1.5} className="text-[#8D998F] shrink-0" />
                    <span className="text-[12px] text-[#2F3A32]">{vendor.bank_name}</span>
                  </div>
                )}
                {vendor.account_no && (
                  <div className="flex items-center gap-2">
                    <CreditCard size={12} strokeWidth={1.5} className="text-[#8D998F] shrink-0" />
                    <span className="text-[12px] font-mono text-[#2F3A32]">{vendor.account_no}</span>
                  </div>
                )}
                {vendor.ifsc_code && (
                  <p className="text-[11px] text-[#6E786F] font-mono">
                    IFSC: {vendor.ifsc_code}
                    {vendor.branch_name ? ` · ${vendor.branch_name}` : ""}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Credit Terms */}
          {(vendor.credit_limit || vendor.credit_days) && (
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] font-semibold text-[#6E786F] mb-2">Credit Terms</p>
              <div className="bg-[#F1F4ED] border border-[#DCE3D6] rounded-xl p-3 grid grid-cols-2 gap-3">
                {vendor.credit_limit != null && vendor.credit_limit !== "" && (
                  <div>
                    <p className="text-[10px] text-[#6E786F] uppercase tracking-wide">Limit</p>
                    <p className="text-[13px] font-medium text-[#2F3A32]">
                      {fmtINR(vendor.credit_limit)}
                    </p>
                  </div>
                )}
                {vendor.credit_days != null && vendor.credit_days !== "" && (
                  <div>
                    <p className="text-[10px] text-[#6E786F] uppercase tracking-wide">Days</p>
                    <p className="text-[13px] font-medium text-[#2F3A32]">{vendor.credit_days} days</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {vendor.notes && row(FileText, "Notes", vendor.notes)}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 border-t border-[#DCE3D6] flex items-center gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium bg-[#244B39] text-white rounded-[9px] hover:bg-[#1D3B2E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors"
          >
            <Edit2 size={13} strokeWidth={1.5} />
            Edit
          </button>
          {isActive && (
            <button
              onClick={onMarkInactive}
              className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium border border-[#DCE3D6] text-[#6E786F] rounded-[9px] hover:border-red-200 hover:text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8B5B2] transition-colors ml-auto"
            >
              <AlertTriangle size={13} strokeWidth={1.5} />
              Mark Inactive
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Add/Edit Vendor Modal ───────────────────────────────────────────────────────

const TABS = ["Basic Info", "Bank Details", "Credit"];

function VendorModal({ vendor, onClose, onSaved }) {
  const isEdit = Boolean(vendor?.id);
  const [activeTab, setActiveTab] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(
    isEdit
      ? {
          name: vendor.name ?? "",
          type: vendor.type ?? "gold_supplier",
          contact_person: vendor.contact_person ?? "",
          mobile: vendor.mobile ?? "",
          email: vendor.email ?? "",
          address: vendor.address ?? "",
          gst_number: vendor.gst_number ?? "",
          pan_number: vendor.pan_number ?? "",
          bank_name: vendor.bank_name ?? "",
          account_no: vendor.account_no ?? "",
          ifsc_code: vendor.ifsc_code ?? "",
          branch_name: vendor.branch_name ?? "",
          credit_limit: vendor.credit_limit ?? "",
          credit_days: vendor.credit_days ?? "",
          notes: vendor.notes ?? "",
        }
      : { ...EMPTY_FORM }
  );

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setActiveTab(0);
      return toast.error("Vendor name is required");
    }
    if (!form.mobile.trim()) {
      setActiveTab(0);
      return toast.error("Mobile number is required");
    }
    setBusy(true);
    try {
      const payload = {
        ...form,
        credit_limit: form.credit_limit === "" ? null : parseMoneyInput(form.credit_limit),
        credit_days: form.credit_days === "" ? null : Number(form.credit_days),
      };
      if (isEdit) {
        await api.put(`/vendors/${vendor.id}`, payload);
        toast.success("Vendor updated");
      } else {
        await api.post("/vendors", payload);
        toast.success("Vendor added");
      }
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#20352A]/35 backdrop-blur-[2px] px-4" onClick={onClose}>
      <div
        className="bg-[#FFFDF8] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DCE3D6] shrink-0">
          <h2 className="text-[16px] font-semibold text-[#2F3A32]">
            {isEdit ? "Edit Vendor" : "Add Vendor"}
          </h2>
          <button onClick={onClose} className="text-[#6E786F] hover:text-[#2F3A32] transition-colors">
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[#DCE3D6] px-6 shrink-0">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(i)}
              className={`px-4 py-3 text-[13px] font-medium border-b-2 transition-colors -mb-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] ${
                activeTab === i
                  ? "border-[#244B39] text-[#2F3A32]"
                  : "border-transparent text-[#6E786F] hover:text-[#2F3A32]"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {/* Tab 0: Basic Info */}
            {activeTab === 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Vendor Name" required>
                    <input
                      className={IC}
                      placeholder="e.g. Mehta Gold Traders"
                      value={form.name}
                      onChange={(e) => set("name", e.target.value)}
                    />
                  </Field>
                  <Field label="Type">
                    <select className={IC} value={form.type} onChange={(e) => set("type", e.target.value)}>
                      {VENDOR_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Contact Person">
                    <input
                      className={IC}
                      placeholder="Point of contact"
                      value={form.contact_person}
                      onChange={(e) => set("contact_person", e.target.value)}
                    />
                  </Field>
                  <Field label="Mobile" required>
                    <input
                      className={IC + " font-mono"}
                      placeholder="10-digit number"
                      value={form.mobile}
                      onChange={(e) => set("mobile", e.target.value)}
                    />
                  </Field>
                </div>

                <Field label="Email">
                  <input
                    className={IC}
                    type="email"
                    placeholder="vendor@example.com"
                    value={form.email}
                    onChange={(e) => set("email", e.target.value)}
                  />
                </Field>

                <Field label="Address">
                  <textarea
                    className={IC + " resize-none"}
                    rows={2}
                    placeholder="Full address"
                    value={form.address}
                    onChange={(e) => set("address", e.target.value)}
                  />
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="GST Number">
                    <input
                      className={IC + " font-mono"}
                      placeholder="22AAAAA0000A1Z5"
                      value={form.gst_number}
                      onChange={(e) => set("gst_number", e.target.value.toUpperCase())}
                    />
                  </Field>
                  <Field label="PAN Number">
                    <input
                      className={IC + " font-mono"}
                      placeholder="ABCDE1234F"
                      value={form.pan_number}
                      onChange={(e) => set("pan_number", e.target.value.toUpperCase())}
                    />
                  </Field>
                </div>
              </div>
            )}

            {/* Tab 1: Bank Details */}
            {activeTab === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Bank Name">
                    <input
                      className={IC}
                      placeholder="e.g. State Bank of India"
                      value={form.bank_name}
                      onChange={(e) => set("bank_name", e.target.value)}
                    />
                  </Field>
                  <Field label="Branch Name">
                    <input
                      className={IC}
                      placeholder="e.g. Jubilee Hills"
                      value={form.branch_name}
                      onChange={(e) => set("branch_name", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Account Number">
                  <input
                    className={IC + " font-mono"}
                    placeholder="Account number"
                    value={form.account_no}
                    onChange={(e) => set("account_no", e.target.value)}
                  />
                </Field>
                <Field label="IFSC Code">
                  <input
                    className={IC + " font-mono"}
                    placeholder="SBIN0012345"
                    value={form.ifsc_code}
                    onChange={(e) => set("ifsc_code", e.target.value.toUpperCase())}
                  />
                </Field>
              </div>
            )}

            {/* Tab 2: Credit */}
            {activeTab === 2 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Credit Limit (₹)">
                    <MoneyInput
                      className={IC}
                      min="0"
                      placeholder="0"
                      value={form.credit_limit}
                      onValueChange={(raw) => set("credit_limit", raw)}
                    />
                  </Field>
                  <Field label="Credit Days">
                    <input
                      className={IC}
                      type="text" inputMode="decimal"
                      min="0"
                      placeholder="e.g. 30"
                      value={form.credit_days}
                      onChange={(e) => set("credit_days", e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Notes">
                  <textarea
                    className={IC + " resize-none"}
                    rows={4}
                    placeholder="Payment terms, special conditions, remarks…"
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </Field>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-[#DCE3D6] flex items-center justify-between shrink-0">
            {/* Tab navigation */}
            <div className="flex gap-2">
              {activeTab > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab((t) => t - 1)}
                  className="px-4 py-2 text-[13px] font-medium border border-[#DCE3D6] text-[#5F6D62] rounded-lg hover:bg-[#F1F4ED] transition-colors"
                >
                  Back
                </button>
              )}
              {activeTab < TABS.length - 1 && (
                <button
                  type="button"
                  onClick={() => setActiveTab((t) => t + 1)}
                  className="flex items-center gap-1 px-4 py-2 text-[13px] font-medium border border-[#DCE3D6] text-[#5F6D62] rounded-lg hover:bg-[#F1F4ED] transition-colors"
                >
                  Next
                  <ChevronRight size={13} strokeWidth={1.5} />
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-[13px] font-medium border border-[#DCE3D6] text-[#5F6D62] rounded-lg hover:bg-[#F1F4ED] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2 text-[13px] font-medium bg-[#244B39] text-white rounded-lg hover:bg-[#1D3B2E] disabled:opacity-50 transition-colors"
              >
                {busy ? "Saving…" : isEdit ? "Save Changes" : "Add Vendor"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────────

export default function Vendors() {
  const [vendors, setVendors] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("active");
  const [detailVendor, setDetailVendor] = useState(null);
  const [modalVendor, setModalVendor] = useState(null); // null=closed, {}=new, obj=edit
  const [modalOpen, setModalOpen] = useState(false);
  const [confirm, confirmModal] = useConfirm();

  const loadVendors = async () => {
    try {
      const { data } = await api.get("/vendors");
      setVendors(Array.isArray(data) ? data : data.items ?? []);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    try {
      const { data } = await api.get("/vendors/summary");
      setSummary(data);
    } catch {
      // non-critical
    }
  };

  useEffect(() => {
    loadVendors();
    loadSummary();
  }, []);

  const filtered = useMemo(() => {
    return vendors.filter((v) => {
      const matchQ =
        !q ||
        v.name?.toLowerCase().includes(q.toLowerCase()) ||
        v.mobile?.includes(q) ||
        v.contact_person?.toLowerCase().includes(q.toLowerCase()) ||
        v.gst_number?.toLowerCase().includes(q.toLowerCase());
      const matchType = !typeFilter || v.type === typeFilter;
      const matchStatus = !statusFilter || v.status === statusFilter;
      return matchQ && matchType && matchStatus;
    });
  }, [vendors, q, typeFilter, statusFilter]);

  const openAdd = () => {
    setModalVendor({});
    setModalOpen(true);
  };

  const openEdit = (vendor) => {
    setModalVendor(vendor);
    setModalOpen(true);
    setDetailVendor(null);
  };

  const closeModal = () => {
    setModalOpen(false);
    setModalVendor(null);
  };

  const handleSaved = () => {
    closeModal();
    loadVendors();
    loadSummary();
  };

  const handleMarkInactive = async (vendor) => {
    if (!(await confirm(`Mark "${vendor.name}" as inactive?`))) return;
    try {
      await api.delete(`/vendors/${vendor.id}`);
      toast.success("Vendor marked inactive");
      setDetailVendor(null);
      loadVendors();
      loadSummary();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  // Derived summary values
  const totalVendors = summary?.total ?? vendors.length;
  const activeVendors = summary?.active ?? vendors.filter((v) => v.status === "active").length;
  const totalOutstanding =
    summary?.total_outstanding ??
    vendors.reduce((sum, v) => sum + Number(v.outstanding_balance || 0), 0);
  const monthPurchases =
    summary?.this_month_purchases ??
    vendors.reduce((sum, v) => sum + Number(v.this_month_purchases || 0), 0);

  return (
    <div className={`${TRADE_PAGE_CLASS} max-w-[1400px]`}>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-semibold text-[#2F3A32]">Vendors & Suppliers</h1>
          <p className="text-[13px] text-[#6E786F] mt-0.5">
            Gold suppliers, stone merchants, karigars and manufacturers — all in one place.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2 text-[13px] font-medium bg-[#244B39] text-white rounded-[9px] hover:bg-[#1D3B2E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors"
        >
          <Plus size={14} strokeWidth={1.5} />
          Add Vendor
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={Users} label="Total Vendors" value={totalVendors} />
        <StatCard icon={UserCheck} label="Active" value={activeVendors} color="text-emerald-700" />
        <StatCard
          icon={TrendingDown}
          label="Total Outstanding"
          value={fmtINR(totalOutstanding)}
          color="text-red-600"
        />
        <StatCard
          icon={ShoppingCart}
          label="This Month Purchases"
          value={fmtINR(monthPurchases)}
          color="text-blue-700"
        />
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D998F]" strokeWidth={1.5} />
          <input
            className="w-full border border-[#C8D4C7] rounded-[9px] pl-9 pr-3 py-2 text-[13px] text-[#2F3A32] bg-white placeholder-[#9AA69C] focus:outline-none focus:border-[#66806B] focus:shadow-[0_0_0_3px_rgba(102,128,107,0.14)] transition-colors"
            placeholder="Search by name, mobile, GST…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        {/* Type filter pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {FILTER_PILLS.map((p) => (
            <button
              key={p.value}
              onClick={() => setTypeFilter(p.value)}
              className={`px-3 py-1.5 rounded-[9px] text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] ${
                typeFilter === p.value
                  ? "bg-[#244B39] text-white"
                  : "bg-[#F1F4ED] border border-[#DCE3D6] text-[#5F6D62] hover:border-[#AFC2AE] hover:text-[#244B39]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Status toggle */}
        <div className="flex items-center gap-1 bg-[#F1F4ED] border border-[#DCE3D6] rounded-lg p-0.5">
          {[
            { value: "", label: "All" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
          ].map((s) => (
            <button
              key={s.value}
              onClick={() => setStatusFilter(s.value)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                statusFilter === s.value
                  ? "bg-white text-[#2F3A32] shadow-sm border border-[#DCE3D6]"
                  : "text-[#6E786F] hover:text-[#2F3A32]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Vendor Table */}
      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <TableSkeleton rows={7} cols={6} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-14 h-14 rounded-full bg-[#F1F4ED] border border-[#DCE3D6] flex items-center justify-center mb-4">
            <Building2 size={22} strokeWidth={1.5} className="text-[#8D998F]" />
          </div>
          <p className="text-[15px] font-medium text-[#2F3A32]">
            {q || typeFilter || statusFilter !== "active" ? "No vendors match your filter" : "No vendors yet"}
          </p>
          <p className="text-[13px] text-[#6E786F] mt-1">
            {q || typeFilter || statusFilter !== "active"
              ? "Try adjusting your search or filters."
              : "Add your first vendor to get started."}
          </p>
          {!q && !typeFilter && statusFilter === "active" && (
            <button
              onClick={openAdd}
              className="mt-4 flex items-center gap-2 px-4 py-2 text-[13px] font-medium bg-[#244B39] text-white rounded-lg hover:bg-[#1D3B2E] transition-colors"
            >
              <Plus size={14} strokeWidth={1.5} />
              Add Vendor
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#FFFDF8] border border-[#DCE3D6] rounded-[10px] overflow-hidden shadow-[0_1px_2px_rgba(35,58,43,0.04)]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#DCE3D6] bg-[#F1F4ED]">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide">
                  Vendor Name
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide">
                  Type
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide hidden md:table-cell">
                  Contact
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide hidden lg:table-cell">
                  Mobile
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide hidden xl:table-cell">
                  GST No
                </th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide">
                  Outstanding
                </th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide hidden lg:table-cell">
                  Total Purchases
                </th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide hidden sm:table-cell">
                  Status
                </th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((v, idx) => {
                const initials = getInitials(v.name);
                const colorClass = avatarColor(v.name);
                return (
                  <tr
                    key={v.id}
                    className={`border-b border-[#DCE3D6] last:border-0 hover:bg-[#F7F9F4] transition-colors cursor-pointer ${
                      idx % 2 === 0 ? "" : ""
                    }`}
                    onClick={() => setDetailVendor(v)}
                  >
                    {/* Vendor Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-semibold shrink-0 ${colorClass}`}
                        >
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-[#2F3A32] truncate max-w-[160px]">{v.name}</p>
                          {v.contact_person && (
                            <p className="text-[11px] text-[#8D998F] truncate">{v.contact_person}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Type */}
                    <td className="px-4 py-3">
                      <TypeBadge type={v.type} />
                    </td>

                    {/* Contact Person */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="text-[12px] text-[#5F6D62] truncate max-w-[120px]">
                        {v.contact_person || "—"}
                      </div>
                    </td>

                    {/* Mobile */}
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        <Phone size={11} strokeWidth={1.5} className="text-[#8D998F] shrink-0" />
                        <span className="font-mono text-[12px] text-[#5F6D62]">{v.mobile || "—"}</span>
                      </div>
                    </td>

                    {/* GST */}
                    <td className="px-4 py-3 hidden xl:table-cell">
                      <span className="font-mono text-[11.5px] text-[#6E786F]">{v.gst_number || "—"}</span>
                    </td>

                    {/* Outstanding Balance */}
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-mono text-[12.5px] font-medium tabular-nums ${
                          Number(v.outstanding_balance || 0) > 0 ? "text-red-600" : "text-[#2F3A32]"
                        }`}
                      >
                        {fmtINR(v.outstanding_balance || 0)}
                      </span>
                    </td>

                    {/* Total Purchases */}
                    <td className="px-4 py-3 text-right hidden lg:table-cell">
                      <span className="font-mono text-[12.5px] text-[#2F3A32] tabular-nums">
                        {fmtINR(v.total_purchases || 0)}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <StatusBadge status={v.status} />
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => openEdit(v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium border border-[#DCE3D6] text-[#5F6D62] rounded-[8px] hover:border-[#66806B] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors"
                      >
                        <Edit2 size={11} strokeWidth={1.5} />
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Table Footer */}
          <div className="px-4 py-2.5 border-t border-[#DCE3D6] bg-[#F1F4ED]">
            <p className="text-[11px] text-[#8D998F]">
              Showing {filtered.length} of {vendors.length} vendors
            </p>
          </div>
        </div>
      )}

      {/* Vendor Detail Side Panel */}
      {detailVendor && (
        <DetailPanel
          vendor={detailVendor}
          onClose={() => setDetailVendor(null)}
          onEdit={() => openEdit(detailVendor)}
          onMarkInactive={() => handleMarkInactive(detailVendor)}
        />
      )}

      {/* Add / Edit Modal */}
      {modalOpen && (
        <VendorModal
          vendor={modalVendor?.id ? modalVendor : null}
          onClose={closeModal}
          onSaved={handleSaved}
        />
      )}
      {confirmModal}
    </div>
  );
}
