import { useEffect, useState, useCallback, useRef } from "react";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  Plus,
  X,
  Search,
  ChevronRight,
  Phone,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Package,
  Truck,
  Loader2,
  ClipboardList,
  Wrench,
  User,
  Calendar,
  Tag,
  IndianRupee,
  ShieldCheck,
  RefreshCw,
  Pencil,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";
import MoneyInput from "@/components/ui/MoneyInput";
import WeightInput from "@/components/ui/WeightInput";
import { fmtINR, parseMoneyInput } from "@/lib/format";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().slice(0, 10);

const fmtDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const isOverdue = (dateStr) => {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date(new Date().toDateString());
};

const isToday = (dateStr) => {
  if (!dateStr) return false;
  return dateStr.slice(0, 10) === todayStr();
};

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_PIPELINE = [
  { key: "received", label: "Received", icon: Package },
  { key: "karigar_assigned", label: "Karigar Assigned", icon: User },
  { key: "in_progress", label: "In Progress", icon: RefreshCw },
  { key: "quality_check", label: "Quality Check", icon: ShieldCheck },
  { key: "ready", label: "Ready", icon: CheckCircle2 },
  { key: "delivered", label: "Delivered", icon: Truck },
];

const STATUS_META = {
  received: { label: "Received", cls: "bg-[#F1F4ED] text-[#5F6D62] border border-[#DCE3D6]" },
  karigar_assigned: { label: "Karigar Assigned", cls: "bg-blue-100 text-blue-700 border border-blue-200" },
  in_progress: { label: "In Progress", cls: "bg-amber-100 text-amber-700 border border-amber-200" },
  quality_check: { label: "Quality Check", cls: "bg-purple-100 text-purple-700 border border-purple-200" },
  ready: { label: "Ready", cls: "bg-green-100 text-green-700 border border-green-200" },
  delivered: { label: "Delivered", cls: "bg-emerald-800 text-emerald-50 border border-emerald-900" },
  cancelled: { label: "Cancelled", cls: "bg-red-100 text-red-700 border border-red-200" },
};

const ALL_STATUSES = ["received", "karigar_assigned", "in_progress", "quality_check", "ready", "delivered", "cancelled"];

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


// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status, deliveryDate }) {
  const meta = STATUS_META[status] || { label: status, cls: "bg-[#F1F4ED] text-[#6E786F] border border-[#DCE3D6]" };
  const pulse = status === "ready" && (isToday(deliveryDate) || isOverdue(deliveryDate));
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${meta.cls}`}>
      {pulse && <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />}
      {meta.label}
    </span>
  );
}

// ─── PriorityBadge ────────────────────────────────────────────────────────────

function PriorityBadge({ priority }) {
  if (priority !== "urgent") return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
      <AlertTriangle size={10} />
      Urgent
    </span>
  );
}

// ─── Modal wrapper ─────────────────────────────────────────────────────────────

function Modal({ open, onClose, title, children, wide = false }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#20352A]/35 backdrop-blur-[2px]">
      <div
        className={`bg-[#FFFDF8] rounded-[14px] shadow-[0_18px_50px_rgba(35,58,43,0.18)] flex flex-col max-h-[90vh] border border-[#DCE3D6] ${wide ? "w-full max-w-2xl" : "w-full max-w-lg"}`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#DCE3D6]">
          <h2 className="text-base font-semibold text-[#2F3A32]">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-[8px] hover:bg-[#F1F4ED] text-[#8D998F] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Customer Search ──────────────────────────────────────────────────────────

function CustomerSearch({ value, onChange, walkin, onWalkinChange }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const timerRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    const h = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const search = useCallback((term) => {
    if (!term.trim()) { setResults([]); return; }
    setSearching(true);
    api.get("/customers", { params: { search: term } })
      .then(({ data }) => { setResults(Array.isArray(data) ? data : data.items || []); setOpen(true); })
      .catch(() => {})
      .finally(() => setSearching(false));
  }, []);

  const handleChange = (e) => {
    const v = e.target.value;
    setQ(v);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(v), 350);
  };

  const select = (c) => {
    onChange({ id: c.id, name: c.name, mobile: c.mobile });
    setQ(`${c.name} — ${c.mobile}`);
    setOpen(false);
  };

  if (walkin) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onWalkinChange(false)} className="text-xs text-blue-600 underline">
            ← Search existing customer
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Customer Name *</label>
            <input className="input" placeholder="Name" value={value?.name || ""} onChange={(e) => onChange({ ...value, name: e.target.value, id: null })} required />
          </div>
          <div>
            <label className="form-label">Mobile *</label>
            <input className="input" placeholder="Mobile" value={value?.mobile || ""} onChange={(e) => onChange({ ...value, mobile: e.target.value, id: null })} required />
          </div>
          <div>
            <label className="form-label">Date of Birth <span className="text-[#8D998F] font-normal">(optional)</span></label>
            <input className="input" type="date" value={value?.dob || ""} onChange={(e) => onChange({ ...value, dob: e.target.value, id: null })} />
          </div>
          <div>
            <label className="form-label">Anniversary Date <span className="text-[#8D998F] font-normal">(optional)</span></label>
            <input className="input" type="date" value={value?.anniversary || ""} onChange={(e) => onChange({ ...value, anniversary: e.target.value, id: null })} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="space-y-2">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D998F]" />
        <input
          className="input pl-9"
          placeholder="Search by name or mobile..."
          value={q}
          onChange={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8D998F] animate-spin" />}
        {open && results.length > 0 && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#FFFDF8] border border-[#DCE3D6] rounded-[10px] shadow-[0_12px_28px_rgba(35,58,43,0.12)] max-h-48 overflow-y-auto">
            {results.map((c) => (
              <button key={c.id} type="button" onClick={() => select(c)}
                className="w-full text-left px-4 py-2.5 hover:bg-[#F1F4ED] text-sm flex items-center justify-between">
                <span className="font-medium text-[#34483B]">{c.name}</span>
                <span className="text-[#6E786F] text-xs">{c.mobile}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={() => onWalkinChange(true)} className="text-xs text-blue-600 underline">
        + Walk-in / new customer
      </button>
    </div>
  );
}

// ─── New Custom Order Modal ────────────────────────────────────────────────────

const CUSTOM_DEFAULTS = {
  customer: null,
  description: "",
  metal_type: "Gold",
  purity: "22K",
  est_weight: "",
  stone_details: "",
  est_price: "",
  advance_paid: "",
  delivery_date: "",
  priority: "normal",
  notes: "",
};

function NewCustomOrderModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(CUSTOM_DEFAULTS);
  const [walkin, setWalkin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!open) { setForm(CUSTOM_DEFAULTS); setWalkin(false); } }, [open]);

  const balance = parseMoneyInput(form.est_price) - parseMoneyInput(form.advance_paid);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer?.name) { toast.error("Please select or enter a customer"); return; }
    if (!form.description.trim()) { toast.error("Description is required"); return; }
    setSaving(true);
    try {
      await api.post("/orders", {
        type: "custom",
        customer_id: form.customer?.id || null,
        customer_name: form.customer.name,
        customer_mobile: form.customer.mobile || null,
        customer_dob: form.customer?.dob || null,
        customer_anniversary: form.customer?.anniversary || null,
        description: form.description.trim(),
        metal_type: form.metal_type || null,
        purity: form.purity || null,
        estimated_weight: form.est_weight === "" ? null : form.est_weight,
        stone_details: form.stone_details || null,
        estimated_price: parseMoneyInput(form.est_price),
        advance_paid: parseMoneyInput(form.advance_paid),
        delivery_date: form.delivery_date || null,
        priority: form.priority,
        notes: form.notes || null,
      });
      toast.success("Custom order noted — assign karigar from order details when ready");
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to create order");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Custom Order" wide>
      <form onSubmit={submit} className="space-y-5">
        {/* Customer */}
        <div>
          <label className="form-label mb-1.5 block">Customer *</label>
          <CustomerSearch value={form.customer} onChange={(c) => set("customer", c)} walkin={walkin} onWalkinChange={setWalkin} />
        </div>

        {/* Description */}
        <div>
          <label className="form-label">Design Description *</label>
          <textarea className="input min-h-[80px] resize-y" placeholder="e.g. Bridal gold necklace set with peacock motif..." value={form.description} onChange={(e) => set("description", e.target.value)} required />
        </div>

        {/* Metal */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="form-label">Metal Type</label>
            <select className="input" value={form.metal_type} onChange={(e) => set("metal_type", e.target.value)}>
              <option>Gold</option>
              <option>Silver</option>
              <option>Platinum</option>
            </select>
          </div>
          <div>
            <label className="form-label">Purity</label>
            <select className="input" value={form.purity} onChange={(e) => set("purity", e.target.value)}>
              <option>24K</option>
              <option>22K</option>
              <option>18K</option>
              <option>14K</option>
              <option>Silver</option>
            </select>
          </div>
          <div>
            <label className="form-label">Est. Weight (g)</label>
            <WeightInput className="input" placeholder="0.000" value={form.est_weight} onValueChange={(raw) => set("est_weight", raw)} />
          </div>
        </div>

        {/* Stone Details */}
        <div>
          <label className="form-label">Stone Details</label>
          <textarea className="input min-h-[60px] resize-y" placeholder="e.g. 2 diamonds 0.15ct each, 4 rubies..." value={form.stone_details} onChange={(e) => set("stone_details", e.target.value)} />
        </div>

        {/* Financials */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="form-label">Estimated Price (₹)</label>
            <MoneyInput className="input" min="0" placeholder="0" value={form.est_price} onValueChange={(raw) => set("est_price", raw)} />
          </div>
          <div>
            <label className="form-label">Advance Paid (₹)</label>
            <MoneyInput className="input" min="0" placeholder="0" value={form.advance_paid} onValueChange={(raw) => set("advance_paid", raw)} />
          </div>
          <div>
            <label className="form-label">Balance Due (₹)</label>
            <div className={`input flex items-center font-semibold ${balance < 0 ? "text-red-600" : "text-[#5F6D62]"} bg-[#F1F4ED] cursor-default`}>
              {fmtINR(balance)}
            </div>
          </div>
        </div>

        {/* Delivery — karigar is assigned later from order details */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Delivery Date</label>
            <input className="input" type="date" value={form.delivery_date} min={todayStr()} onChange={(e) => set("delivery_date", e.target.value)} />
          </div>
          <div>
            <label className="form-label">Priority</label>
            <select className="input" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        <div>
          <label className="form-label">Notes</label>
          <input className="input" placeholder="Any special instructions..." value={form.notes} onChange={(e) => set("notes", e.target.value)} />
        </div>

        <p className="text-xs text-[#6E786F] bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          Order is noted as <span className="font-medium text-amber-800">Received</span>. Assign a karigar (from Vendors) after saving.
        </p>

        <div className="flex justify-end gap-3 pt-2 border-t border-[#DCE3D6]">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Note Order
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── New Repair Job Modal ─────────────────────────────────────────────────────

const REPAIR_DEFAULTS = {
  customer: null,
  item_description: "",
  repair_work: "",
  est_price: "",
  advance_paid: "",
  delivery_date: "",
  priority: "normal",
};

function NewRepairJobModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState(REPAIR_DEFAULTS);
  const [walkin, setWalkin] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!open) { setForm(REPAIR_DEFAULTS); setWalkin(false); } }, [open]);

  const balance = parseMoneyInput(form.est_price) - parseMoneyInput(form.advance_paid);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer?.name) { toast.error("Please select or enter a customer"); return; }
    if (!form.item_description.trim()) { toast.error("Item description is required"); return; }
    setSaving(true);
    try {
      const description = [form.item_description.trim(), form.repair_work.trim()].filter(Boolean).join(" — ");
      await api.post("/orders", {
        type: "repair",
        customer_id: form.customer?.id || null,
        customer_name: form.customer.name,
        customer_mobile: form.customer.mobile || null,
        customer_dob: form.customer?.dob || null,
        customer_anniversary: form.customer?.anniversary || null,
        description,
        estimated_price: parseMoneyInput(form.est_price),
        advance_paid: parseMoneyInput(form.advance_paid),
        delivery_date: form.delivery_date || null,
        priority: form.priority,
      });
      toast.success("Repair job noted — assign karigar from order details when ready");
      onCreated();
      onClose();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to create repair job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New Repair Job" wide>
      <form onSubmit={submit} className="space-y-5">
        {/* Customer */}
        <div>
          <label className="form-label mb-1.5 block">Customer *</label>
          <CustomerSearch value={form.customer} onChange={(c) => set("customer", c)} walkin={walkin} onWalkinChange={setWalkin} />
        </div>

        {/* Item */}
        <div>
          <label className="form-label">Item Description *</label>
          <input className="input" placeholder="e.g. Gold ring — chain link broken" value={form.item_description} onChange={(e) => set("item_description", e.target.value)} required />
        </div>

        {/* Repair Work */}
        <div>
          <label className="form-label">Repair Work Needed</label>
          <textarea className="input min-h-[80px] resize-y" placeholder="Describe the repair or alteration needed..." value={form.repair_work} onChange={(e) => set("repair_work", e.target.value)} />
        </div>

        {/* Financials */}
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="form-label">Estimated Price (₹)</label>
            <MoneyInput className="input" min="0" placeholder="0" value={form.est_price} onValueChange={(raw) => set("est_price", raw)} />
          </div>
          <div>
            <label className="form-label">Advance Paid (₹)</label>
            <MoneyInput className="input" min="0" placeholder="0" value={form.advance_paid} onValueChange={(raw) => set("advance_paid", raw)} />
          </div>
          <div>
            <label className="form-label">Balance Due (₹)</label>
            <div className={`input flex items-center font-semibold ${balance < 0 ? "text-red-600" : "text-[#5F6D62]"} bg-[#F1F4ED] cursor-default`}>
              {fmtINR(balance)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="form-label">Delivery Date</label>
            <input className="input" type="date" value={form.delivery_date} min={todayStr()} onChange={(e) => set("delivery_date", e.target.value)} />
          </div>
          <div>
            <label className="form-label">Priority</label>
            <select className="input" value={form.priority} onChange={(e) => set("priority", e.target.value)}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        <p className="text-xs text-[#6E786F] bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
          Job is noted as <span className="font-medium text-blue-800">Received</span>. Assign a karigar (from Vendors) after saving.
        </p>

        <div className="flex justify-end gap-3 pt-2 border-t border-[#DCE3D6]">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Note Repair Job
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Order Detail Side Panel ───────────────────────────────────────────────────

function OrderDetailPanel({ order, onClose, onStatusUpdated }) {
  const [newStatus, setNewStatus] = useState(order?.status || "received");
  const [updating, setUpdating] = useState(false);
  const [editingKarigar, setEditingKarigar] = useState(false);
  const [karigars, setKarigars] = useState([]);
  const [karigarVendorId, setKarigarVendorId] = useState(order?.karigar_vendor_id || "");
  const [savingKarigar, setSavingKarigar] = useState(false);
  const [loadingKarigars, setLoadingKarigars] = useState(false);

  useEffect(() => {
    if (order) {
      setNewStatus(order.status);
      setKarigarVendorId(order.karigar_vendor_id || "");
      setEditingKarigar(false);
    }
  }, [order]);

  useEffect(() => {
    if (!editingKarigar) return;
    setLoadingKarigars(true);
    api.get("/vendors", { params: { type: "karigar", status: "active" } })
      .then(({ data }) => setKarigars(Array.isArray(data) ? data : data?.items || []))
      .catch(() => toast.error("Failed to load karigars"))
      .finally(() => setLoadingKarigars(false));
  }, [editingKarigar]);

  const saveKarigar = async () => {
    if (!karigarVendorId) {
      toast.error("Select a karigar from Vendors");
      return;
    }
    setSavingKarigar(true);
    try {
      const { data } = await api.patch(`/orders/${order.id}/karigar`, {
        karigar_vendor_id: karigarVendorId,
      });
      onStatusUpdated(data);
      toast.success(order.status === "received" ? "Karigar assigned" : "Karigar updated");
      setEditingKarigar(false);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update karigar");
    } finally {
      setSavingKarigar(false);
    }
  };

  const cancelKarigar = () => {
    setKarigarVendorId(order?.karigar_vendor_id || "");
    setEditingKarigar(false);
  };

  if (!order) return null;

  const estPrice = order.estimated_price ?? order.est_price ?? 0;
  const estWeight = order.estimated_weight ?? order.est_weight;
  const balance = order.balance_due != null
    ? order.balance_due
    : estPrice - (order.advance_paid || 0);
  const overdue = isOverdue(order.delivery_date) && order.status !== "delivered" && order.status !== "cancelled";

  const updateStatus = async () => {
    if (newStatus === order.status) { toast("Status unchanged"); return; }
    setUpdating(true);
    try {
      const { data } = await api.put(`/orders/${order.id}/status`, { status: newStatus });
      toast.success("Status updated");
      onStatusUpdated(data);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to update status");
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#20352A]/30 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md bg-[#FFFDF8] h-full shadow-[0_18px_50px_rgba(35,58,43,0.18)] flex flex-col animate-slide-in-right overflow-y-auto border-l border-[#DCE3D6]">
        {/* Header */}
        <div className="sticky top-0 bg-[#FFFDF8] z-10 flex items-start justify-between px-6 py-5 border-b border-[#DCE3D6]">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-[#2F3A32] tracking-tight">{order.order_no}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${order.type === "custom" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                {order.type === "custom" ? "Custom Order" : "Repair Job"}
              </span>
              <PriorityBadge priority={order.priority} />
            </div>
            <StatusBadge status={order.status} deliveryDate={order.delivery_date} />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#F1F4ED] text-[#8D998F] hover:text-[#6E786F] transition-colors mt-0.5">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 px-6 py-5 space-y-6">
          {/* Customer */}
          <section>
            <h3 className="text-xs font-semibold text-[#8D998F] uppercase tracking-wider mb-3">Customer</h3>
            <div className="flex items-center justify-between bg-[#F1F4ED] rounded-[10px] border border-[#DCE3D6] px-4 py-3">
              <div>
                <p className="font-semibold text-[#2F3A32]">{order.customer_name}</p>
                {order.customer_mobile && (
                  <p className="text-sm text-[#6E786F] mt-0.5">{order.customer_mobile}</p>
                )}
              </div>
              {order.customer_mobile && (
                <a href={`tel:${order.customer_mobile}`}
                  className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-100 transition-colors font-medium">
                  <Phone size={13} />
                  Call
                </a>
              )}
            </div>
          </section>

          {/* Description */}
          <section>
            <h3 className="text-xs font-semibold text-[#8D998F] uppercase tracking-wider mb-3">
              {order.type === "custom" ? "Design Description" : "Item / Repair Details"}
            </h3>
            <div className="bg-[#F1F4ED] rounded-xl px-4 py-3 space-y-2">
              <p className="text-sm text-[#34483B] leading-relaxed">
                {order.description || order.item_description || "—"}
              </p>
              {order.type === "custom" && (
                <div className="pt-2 border-t border-[#DCE3D6] grid grid-cols-2 gap-2 text-sm">
                  {order.metal_type && <div><span className="text-[#6E786F]">Metal:</span> <span className="font-medium text-[#34483B]">{order.metal_type} {order.purity}</span></div>}
                  {estWeight != null && estWeight !== "" && <div><span className="text-[#6E786F]">Weight:</span> <span className="font-medium text-[#34483B]">{estWeight} g</span></div>}
                  {order.stone_details && <div className="col-span-2"><span className="text-[#6E786F]">Stones:</span> <span className="font-medium text-[#34483B]">{order.stone_details}</span></div>}
                </div>
              )}
            </div>
          </section>

          {/* Financials */}
          <section>
            <h3 className="text-xs font-semibold text-[#8D998F] uppercase tracking-wider mb-3">Financials</h3>
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#F1F4ED] rounded-xl px-4 py-3 text-center">
                <p className="text-xs text-[#6E786F] mb-1">Est. Price</p>
                <p className="font-bold text-[#2F3A32] text-sm">{fmtINR(estPrice)}</p>
              </div>
              <div className="bg-[#EDF4EE] rounded-[10px] border border-[#CFE1D1] px-4 py-3 text-center">
                <p className="text-xs text-green-600 mb-1">Advance Paid</p>
                <p className="font-bold text-green-800 text-sm">{fmtINR(order.advance_paid)}</p>
              </div>
              <div className={`rounded-[10px] border px-4 py-3 text-center ${balance > 0 ? "bg-[#FEF3F2] border-[#F1C7C4]" : "bg-[#F1F4ED] border-[#DCE3D6]"}`}>
                <p className={`text-xs mb-1 ${balance > 0 ? "text-red-600" : "text-[#6E786F]"}`}>Balance Due</p>
                <p className={`font-bold text-sm ${balance > 0 ? "text-red-700" : "text-[#5F6D62]"}`}>{fmtINR(balance)}</p>
              </div>
            </div>
          </section>

          {/* Karigar & Delivery */}
          <section>
            <h3 className="text-xs font-semibold text-[#8D998F] uppercase tracking-wider mb-3">Assignment & Delivery</h3>
            <div className="space-y-3">
              <div className="bg-[#F1F4ED] rounded-[10px] border border-[#DCE3D6] px-4 py-3">
                <p className="text-xs text-[#6E786F] mb-1">Karigar</p>
                {editingKarigar ? (
                  <div className="space-y-2 mt-1">
                    {loadingKarigars ? (
                      <div className="flex items-center gap-2 text-xs text-[#6E786F] py-1">
                        <Loader2 size={13} className="animate-spin" /> Loading karigars…
                      </div>
                    ) : karigars.length === 0 ? (
                      <p className="text-xs text-amber-700">
                        No karigar vendors found. Add them under Vendors → type Karigar.
                      </p>
                    ) : (
                      <select
                        className="input text-sm"
                        value={karigarVendorId}
                        onChange={(e) => setKarigarVendorId(e.target.value)}
                        autoFocus
                      >
                        <option value="">Select karigar…</option>
                        {karigars.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.name}{k.mobile ? ` — ${k.mobile}` : ""}
                          </option>
                        ))}
                      </select>
                    )}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={saveKarigar}
                        disabled={savingKarigar || !karigarVendorId}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        {savingKarigar ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        Assign
                      </button>
                      <button
                        onClick={cancelKarigar}
                        className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#F1F4ED] text-[#6E786F] hover:bg-[#E3E8E0] transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium text-[#34483B] text-sm">
                      {order.karigar_name || <span className="text-[#8D998F] italic">Not assigned yet</span>}
                    </p>
                    <button
                      onClick={() => setEditingKarigar(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-white border border-[#DCE3D6] text-[#6E786F] hover:border-amber-300 hover:text-amber-700 transition-colors"
                      title={order.karigar_name ? "Change karigar" : "Assign karigar"}
                    >
                      <Pencil size={12} />
                      {order.karigar_name ? "Change" : "Assign"}
                    </button>
                  </div>
                )}
              </div>
              <div className={`rounded-xl px-4 py-3 ${overdue ? "bg-red-50" : "bg-[#F1F4ED]"}`}>
                <p className={`text-xs mb-1 ${overdue ? "text-red-600" : "text-[#6E786F]"}`}>
                  Delivery Date {overdue && "⚠ Overdue"}
                </p>
                <p className={`font-medium text-sm ${overdue ? "text-red-700" : "text-[#34483B]"}`}>
                  {fmtDate(order.delivery_date)}
                </p>
              </div>
            </div>
          </section>

          {/* Notes */}
          {order.notes && (
            <section>
              <h3 className="text-xs font-semibold text-[#8D998F] uppercase tracking-wider mb-2">Notes</h3>
              <p className="text-sm text-[#5F6D62] bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 leading-relaxed">{order.notes}</p>
            </section>
          )}

          {/* Status update */}
          {order.status !== "delivered" && order.status !== "cancelled" && (
            <section className="sticky bottom-0 bg-[#FFFDF8] pt-4 border-t border-[#DCE3D6]">
              <h3 className="text-xs font-semibold text-[#8D998F] uppercase tracking-wider mb-3">Update Status</h3>
              <div className="flex gap-2">
                <select className="input flex-1 text-sm" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
                  {ALL_STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>
                  ))}
                </select>
                <button onClick={updateStatus} disabled={updating || newStatus === order.status}
                  className="btn-primary whitespace-nowrap disabled:opacity-50">
                  {updating && <Loader2 size={13} className="animate-spin" />}
                  Update
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Status Pipeline ───────────────────────────────────────────────────────────

function StatusPipeline({ orders }) {
  const counts = STATUS_PIPELINE.reduce((acc, s) => {
    acc[s.key] = orders.filter((o) => o.status === s.key).length;
    return acc;
  }, {});

  return (
    <div className="flex items-stretch gap-0 bg-[#FFFDF8] rounded-[12px] border border-[#DCE3D6] shadow-[0_1px_2px_rgba(35,58,43,0.04)] overflow-hidden mb-6">
      {STATUS_PIPELINE.map((step, idx) => {
        const Icon = step.icon;
        const count = counts[step.key];
        const isLast = idx === STATUS_PIPELINE.length - 1;
        const activeColor = count > 0;
        return (
          <div key={step.key} className="flex items-stretch flex-1 min-w-0">
            <div className={`flex flex-col items-center justify-center px-3 py-4 flex-1 gap-1.5 transition-colors
              ${activeColor ? "bg-[#EDF4EE]" : "bg-[#FFFDF8]"}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center
                ${activeColor ? "bg-[#244B39] text-white shadow-sm" : "bg-[#F1F4ED] text-[#8D998F]"}`}>
                <Icon size={15} strokeWidth={2} />
              </div>
              <div className={`text-xl font-bold leading-none ${activeColor ? "text-[#244B39]" : "text-[#B6C0B7]"}`}>
                {count}
              </div>
              <div className={`text-[10px] font-medium text-center leading-tight ${activeColor ? "text-[#356747]" : "text-[#8D998F]"}`}>
                {step.label}
              </div>
            </div>
            {!isLast && (
              <div className="flex items-center self-stretch">
                <div className="w-px h-full bg-[#F1F4ED]" />
                <ChevronRight size={14} className="text-[#B6C0B7] -mx-2 z-10" />
                <div className="w-px h-full bg-[#F1F4ED]" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Summary Cards ────────────────────────────────────────────────────────────

function SummaryCard({ label, value, icon: Icon, color = "gray", highlight = false }) {
  const colors = {
    gray: "bg-white text-[#34483B] border-[#DCE3D6]",
    amber: "bg-amber-50 text-amber-800 border-amber-200",
    green: "bg-green-50 text-green-800 border-green-200",
    red: "bg-red-50 text-red-800 border-red-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
  };
  const iconColors = {
    gray: "text-[#8D998F]",
    amber: "text-amber-500",
    green: "text-green-500",
    red: "text-red-500",
    blue: "text-blue-500",
  };
  return (
    <div className={`rounded-[10px] border px-5 py-4 flex items-center gap-4 shadow-[0_1px_2px_rgba(35,58,43,0.04)] ${colors[color]} ${highlight ? "ring-2 ring-[#B8CBB9] ring-offset-1" : ""}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-white shadow-sm ${iconColors[color]}`}>
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="text-xs mt-1 opacity-70 font-medium">{label}</p>
      </div>
    </div>
  );
}

// ─── Orders Table ─────────────────────────────────────────────────────────────

function OrdersTable({ orders, loading, onRowClick }) {
  if (loading) {
    return (
      <div className="space-y-4">
        <PageLoadingBadge />
        <TableSkeleton rows={7} cols={7} />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-16 h-16 rounded-2xl bg-[#F1F4ED] flex items-center justify-center mb-4">
          <ClipboardList size={28} className="text-[#B6C0B7]" />
        </div>
        <p className="text-[#6E786F] font-medium">No orders found</p>
        <p className="text-[#8D998F] text-sm mt-1">Create a new order using the buttons above</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[10px] border border-[#DCE3D6] shadow-[0_1px_2px_rgba(35,58,43,0.04)] bg-[#FFFDF8]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#F1F4ED] border-b border-[#DCE3D6]">
            <th className="text-left px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider whitespace-nowrap">Order No</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider">Customer</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider">Description</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider whitespace-nowrap">Metal / Purity</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider whitespace-nowrap">Est. Price</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider">Advance</th>
            <th className="text-right px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider">Balance</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider">Karigar</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider whitespace-nowrap">Delivery</th>
            <th className="text-left px-4 py-3 text-xs font-semibold text-[#6E786F] uppercase tracking-wider">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#E3E8E0]">
          {orders.map((o) => {
            const estPrice = o.estimated_price ?? o.est_price ?? 0;
            const balance = o.balance_due != null ? o.balance_due : estPrice - (o.advance_paid || 0);
            const overdue = isOverdue(o.delivery_date) && o.status !== "delivered" && o.status !== "cancelled";
            const todayDelivery = isToday(o.delivery_date) && o.status !== "delivered" && o.status !== "cancelled";
            return (
              <tr key={o.id}
                className="hover:bg-[#F7F9F4] cursor-pointer transition-colors group"
                onClick={() => onRowClick(o)}>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-[#244B39] group-hover:text-[#1D3B2E] text-xs">{o.order_no}</span>
                    <PriorityBadge priority={o.priority} />
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div>
                    <p className="font-medium text-[#2F3A32]">{o.customer_name}</p>
                    {o.customer_mobile && <p className="text-xs text-[#8D998F]">{o.customer_mobile}</p>}
                  </div>
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  <p className="text-[#5F6D62] truncate text-xs" title={o.description || o.item_description}>
                    {o.description || o.item_description || "—"}
                  </p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {o.metal_type ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-100">
                      {o.metal_type} {o.purity}
                    </span>
                  ) : <span className="text-[#8D998F] text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-medium text-[#34483B] whitespace-nowrap">{fmtINR(estPrice)}</td>
                <td className="px-4 py-3 text-right text-green-700 whitespace-nowrap">{fmtINR(o.advance_paid)}</td>
                <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${balance > 0 ? "text-red-600" : "text-[#6E786F]"}`}>{fmtINR(balance)}</td>
                <td className="px-4 py-3 text-xs text-[#6E786F]">{o.karigar_name || <span className="text-[#8D998F] italic">Unassigned</span>}</td>
                <td className={`px-4 py-3 whitespace-nowrap text-xs font-medium ${overdue ? "text-red-600" : todayDelivery ? "text-amber-600" : "text-[#6E786F]"}`}>
                  {overdue && <span className="mr-1">⚠</span>}
                  {fmtDate(o.delivery_date)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <StatusBadge status={o.status} deliveryDate={o.delivery_date} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Orders() {
  const [tab, setTab] = useState("custom");
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [showRepairModal, setShowRepairModal] = useState(false);

  const loadOrders = useCallback(() => {
    setLoading(true);
    api.get("/orders", { params: { type: tab, limit: 200 } })
      .then(({ data }) => setOrders(
        Array.isArray(data) ? data : (data?.orders || data?.items || [])
      ))
      .catch(() => toast.error("Failed to load orders"))
      .finally(() => setLoading(false));
  }, [tab]);

  const loadSummary = useCallback(() => {
    api.get("/orders/summary")
      .then(({ data }) => setSummary(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadOrders();
    loadSummary();
  }, [loadOrders, loadSummary]);

  const handleCreated = () => {
    loadOrders();
    loadSummary();
  };

  const handleStatusUpdated = (updatedOrder) => {
    loadOrders();
    loadSummary();
    if (updatedOrder) {
      setSelectedOrder(updatedOrder);
    } else {
      setSelectedOrder(null);
    }
  };

  const todayDeliveries = orders.filter(
    (o) => isToday(o.delivery_date) && o.status !== "delivered" && o.status !== "cancelled"
  ).length;

  const overdueCount = orders.filter(
    (o) => isOverdue(o.delivery_date) && o.status !== "delivered" && o.status !== "cancelled"
  ).length;

  return (
    <div className={`${TRADE_PAGE_CLASS} max-w-[1400px] pb-10`}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-[#2F3A32] tracking-tight">Orders</h1>
          <p className="text-[#6E786F] text-sm mt-1">Manage custom jewellery orders and repair jobs from start to delivery.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setShowRepairModal(true)} className="btn-secondary flex items-center gap-1.5">
            <Wrench size={14} strokeWidth={1.75} />
            + New Repair Job
          </button>
          <button onClick={() => setShowCustomModal(true)} className="btn-primary flex items-center gap-1.5">
            <Plus size={14} strokeWidth={2} />
            + New Custom Order
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <SummaryCard label="Total Orders" value={summary?.total ?? orders.length} icon={ClipboardList} color="gray" />
        <SummaryCard label="In Progress" value={summary?.by_status?.in_progress ?? orders.filter((o) => o.status === "in_progress").length} icon={RefreshCw} color="blue" />
        <SummaryCard label="Ready for Delivery" value={summary?.by_status?.ready ?? orders.filter((o) => o.status === "ready").length} icon={CheckCircle2} color="green" />
        <SummaryCard
          label="Today's Deliveries"
          value={summary?.today_deliveries ?? todayDeliveries}
          icon={Calendar}
          color={(summary?.today_deliveries ?? todayDeliveries) > 0 ? "amber" : "gray"}
          highlight={(summary?.today_deliveries ?? todayDeliveries) > 0}
        />
        <SummaryCard
          label="Overdue"
          value={summary?.overdue ?? overdueCount}
          icon={AlertTriangle}
          color={(summary?.overdue ?? overdueCount) > 0 ? "red" : "gray"}
        />
      </div>

      {/* Status Pipeline */}
      <StatusPipeline orders={orders} />

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-[#F1F4ED] rounded-[10px] border border-[#DCE3D6] w-fit mb-5">
        <button
          onClick={() => setTab("custom")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "custom" ? "bg-[#244B39] text-white shadow-sm" : "text-[#6E786F] hover:text-[#244B39]"}`}>
          <ClipboardList size={15} strokeWidth={1.75} />
          Custom Orders
        </button>
        <button
          onClick={() => setTab("repair")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${tab === "repair" ? "bg-[#244B39] text-white shadow-sm" : "text-[#6E786F] hover:text-[#244B39]"}`}>
          <Wrench size={15} strokeWidth={1.75} />
          Repair Jobs
        </button>
      </div>

      {/* Orders Table */}
      <OrdersTable orders={orders} loading={loading} onRowClick={setSelectedOrder} />

      {/* Detail Panel */}
      {selectedOrder && (
        <OrderDetailPanel
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onStatusUpdated={handleStatusUpdated}
        />
      )}

      {/* Modals */}
      <NewCustomOrderModal
        open={showCustomModal}
        onClose={() => setShowCustomModal(false)}
        onCreated={handleCreated}
      />
      <NewRepairJobModal
        open={showRepairModal}
        onClose={() => setShowRepairModal(false)}
        onCreated={handleCreated}
      />

      {/* Slide-in animation */}
      <style>{`
        @keyframes slide-in-right {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-slide-in-right {
          animation: slide-in-right 0.22s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .form-label {
          display: block;
          font-size: 0.75rem;
          font-weight: 500;
          color: #6E786F;
          margin-bottom: 0.375rem;
        }
      `}</style>
    </div>
  );
}
