import { useEffect, useState } from "react";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import { Link, useNavigate } from "react-router-dom";
import { Search, Plus, X, Trash2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { openWhatsAppChat } from "@/lib/whatsapp";
import { normalizeIndianMobile } from "@/lib/phone";
import PageHeader from "@/components/common/PageHeader";
import EmptyState from "@/components/common/EmptyState";
import { fmtINR, fmtDate, fmtCustomerCode } from "@/lib/format";
import { T } from "@/constants/testIds";
import { useAuth } from "@/context/AuthContext";
import useConfirm from "@/hooks/useConfirm";
import DuplicateCustomerDialog, { dupInfo } from "@/components/customers/DuplicateCustomerDialog";
import { useCustomersHiddenUnlocked } from "@/lib/customersHiddenUnlock";
import { useHiddenBillUnlockGate } from "@/hooks/useHiddenBillUnlockGate";
import { hiddenUnlockBleedClass } from "@/lib/hiddenUnlockSurface";

const TAG_CLASS = {
  vip: "chip chip-gold",
  regular: "chip chip-neutral",
  wholesale: "chip chip-diamond",
};

export default function Customers() {
  const nav = useNavigate();
  const { can } = useAuth();
  const [confirm, confirmModal] = useConfirm();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 30;
  const [openNew, setOpenNew] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState(null);
  const canDelete = can("customers", "delete");
  const [hiddenUnlocked, setHiddenUnlocked] = useCustomersHiddenUnlocked();
  const { handleTitleClick, lockButton, dialog, titleHint } = useHiddenBillUnlockGate(
    hiddenUnlocked,
    setHiddenUnlocked,
  );

  const handleWhatsApp = (e, c) => {
    e.stopPropagation();
    const result = openWhatsAppChat(c.mobile);
    if (!result.ok) toast.error(result.error);
  };

  const handleDelete = async (e, c) => {
    e.stopPropagation();
    if (!(await confirm(`Delete "${c.name}"? This cannot be undone.`))) return;
    setDeletingId(c.id);
    try {
      await api.delete(`/customers/${c.id}`);
      toast.success("Customer deleted");
      setRows((list) => list.filter((r) => r.id !== c.id));
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setDeletingId(null);
    }
  };

  const load = () => {
    const params = {};
    if (q) params.q = q;
    if (tag) params.tag = tag;
    if (hiddenUnlocked) params.include_hidden = 1;
    setLoading(true);
    api.get("/customers", { params })
      .then(({ data }) => setRows(Array.isArray(data) ? data : data?.items || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line
  }, [q, tag, reloadKey, hiddenUnlocked]);

  useEffect(() => {
    setPage(1);
  }, [q, tag]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  useEffect(() => {
    const handler = (e) => {
      if (e.detail?.type === 'customer:changed') setReloadKey((k) => k + 1);
    };
    window.addEventListener('realtime', handler);
    return () => window.removeEventListener('realtime', handler);
  }, []);

  return (
    <div className={hiddenUnlockBleedClass(hiddenUnlocked)}>
    <div className="max-w-[1400px]">
      <PageHeader
        title="Customers"
        subtitle="Every relationship in your ledger — birthdays, purchases, and outstanding."
        onTitleClick={handleTitleClick}
        titleHint={titleHint}
        actions={
          <div className="flex items-center gap-2">
            {lockButton}
            {can("customers", "create") ? (
              <button data-testid={T.customerAddBtn} onClick={() => setOpenNew(true)} className="btn-primary">
                <Plus size={14} strokeWidth={1.5} /> Add customer
              </button>
            ) : null}
          </div>
        }
      />

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-md">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#a3a3a3]" strokeWidth={1.5} />
          <input className="input pl-9" placeholder="Search by name, mobile or email" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <select className="input max-w-[160px]" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          <option value="vip">VIP</option>
          <option value="regular">Regular</option>
          <option value="wholesale">Wholesale</option>
        </select>
      </div>

      {loading ? (
        <div className="space-y-4">
          <PageLoadingBadge />
          <TableSkeleton rows={8} cols={6} />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No customers yet" description="Add your first customer to start building your book." />
      ) : (
        <div className="table-shell" data-testid={T.customersTable}>
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Customer</th>
                <th className="table-th">Contact</th>
                <th className="table-th">Tag</th>
                <th className="table-th">Notes</th>
                <th className="table-th text-right">Gold Purchases</th>
                <th className="table-th text-right">Silver Purchases</th>
                <th className="table-th text-right">Since</th>
                <th className="table-th text-center w-12" aria-label="WhatsApp" />
                {canDelete && <th className="table-th text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((c) => (
                <tr key={c.id} className="table-row cursor-pointer" onClick={() => nav(`/customers/${c.id}`)}>
                  <td className="table-td">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-[#0A0A0A] text-white flex items-center justify-center text-[13px] font-medium">
                        {c.name.slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-mono text-[10px] text-[#a3a3a3]">{fmtCustomerCode(c.serial_no)}</div>
                        <div className="font-medium">{c.name}</div>
                        <div className="font-mono text-[11px] text-[#a3a3a3]">{c.address || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="table-td">
                    <div className="font-mono text-[12.5px]">{c.mobile}</div>
                    <div className="text-[11px] text-[#a3a3a3]">{c.email || "—"}</div>
                  </td>
                  <td className="table-td">
                    <span className={TAG_CLASS[c.tag] || "chip chip-neutral"}>{c.tag || "regular"}</span>
                  </td>
                  <td className="table-td">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); nav(`/customers/${c.id}#notes-card`); }}
                      className={`chip cursor-pointer hover:opacity-80 ${c.notes?.trim() ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}
                    >
                      {c.notes?.trim() ? "Available" : "Not available"}
                    </button>
                  </td>
                  <td className="table-td text-right tabular-nums">
                    <div className="font-medium text-[#92400E]">{(c.gold_gross ?? 0).toFixed(3)} g</div>
                    <div className="text-[10.5px] text-[#a3a3a3]">net {(c.gold_net ?? 0).toFixed(3)} g</div>
                  </td>
                  <td className="table-td text-right tabular-nums">
                    <div className="font-medium text-[#475569]">{(c.silver_gross ?? 0).toFixed(3)} g</div>
                    <div className="text-[10.5px] text-[#a3a3a3]">net {(c.silver_net ?? 0).toFixed(3)} g</div>
                  </td>
                  <td className="table-td text-right text-[#737373] font-mono text-[12px]">{fmtDate(c.created_at)}</td>
                  <td className="table-td text-center">
                    <button
                      type="button"
                      title={normalizeIndianMobile(c.mobile) ? `WhatsApp ${c.mobile}` : "No valid mobile for WhatsApp"}
                      aria-label={`Open WhatsApp chat with ${c.name}`}
                      disabled={!normalizeIndianMobile(c.mobile)}
                      onClick={(e) => handleWhatsApp(e, c)}
                      className="inline-flex items-center justify-center h-8 w-8 rounded-md text-[#128C7E] hover:bg-[#ECFDF5] border border-[#A7F3D0] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                    >
                      <MessageCircle size={15} strokeWidth={1.75} />
                    </button>
                  </td>
                  {canDelete && (
                    <td className="table-td text-right">
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, c)}
                        disabled={deletingId === c.id}
                        className="inline-flex items-center gap-1 text-[11.5px] text-[#991B1B] hover:bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1 disabled:opacity-60"
                      >
                        <Trash2 size={11} strokeWidth={1.5} /> {deletingId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-[12px] text-[#737373]">
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 disabled:opacity-40"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </button>
          <div>
            Page {page} of {totalPages} · {rows.length} customer{rows.length === 1 ? "" : "s"}
          </div>
          <button
            type="button"
            className="btn-secondary !py-1.5 !px-3 disabled:opacity-40"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            Next
          </button>
        </div>
      )}

      {openNew && <NewCustomerModal onClose={() => setOpenNew(false)} onCreated={load} />}
      {confirmModal}
      {dialog}
    </div>
    </div>
  );
}

function NewCustomerModal({ onClose, onCreated }) {
  const nav = useNavigate();
  const [form, setForm] = useState({ name: "", mobile: "", email: "", address: "", pan_number: "", aadhaar_number: "", tag: "regular", dob: "", anniversary: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [dup, setDup] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e, { force = false } = {}) => {
    if (e) e.preventDefault();
    setBusy(true);
    try {
      await api.post("/customers", {
        ...form,
        pan_number: form.pan_number.trim() || undefined,
        aadhaar_number: form.aadhaar_number.trim() || undefined,
        allow_duplicate_mobile: force || undefined,
      });
      toast.success("Customer added");
      onCreated();
      onClose();
    } catch (err) {
      const info = dupInfo(err);
      if (info) setDup(info);
      else toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto">
      <form onSubmit={save} className="bg-white rounded-lg border border-[#E5E7EB] shadow-2xl w-full max-w-lg mt-16 mb-8">
        <div className="p-5 border-b border-[#E5E7EB] flex items-center justify-between">
          <div className="section-title">Add customer</div>
          <button type="button" onClick={onClose} className="text-[#a3a3a3] hover:text-[#0A0A0A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Name"><input required className="input" value={form.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile"><input required className="input font-mono" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} /></Field>
            <Field label="Email"><input type="email" className="input" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          </div>
          <Field label="Address"><input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="PAN Number">
              <input className="input font-mono uppercase" maxLength={10} value={form.pan_number} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
            </Field>
            <Field label="Aadhaar Number">
              <input
                type="text"
                inputMode="numeric"
                className="input font-mono"
                maxLength={12}
                value={form.aadhaar_number}
                onChange={(e) => set("aadhaar_number", e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="123456789012"
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Tag">
              <select className="input" value={form.tag} onChange={(e) => set("tag", e.target.value)}>
                <option value="regular">Regular</option>
                <option value="vip">VIP</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </Field>
            <Field label="DOB"><input type="date" className="input" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></Field>
            <Field label="Anniversary"><input type="date" className="input" value={form.anniversary} onChange={(e) => set("anniversary", e.target.value)} /></Field>
          </div>
          <Field label="Notes">
            <textarea className="input" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any remarks or notes about this customer" />
          </Field>
        </div>
        <div className="p-4 border-t border-[#E5E7EB] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" data-testid={T.customerSave} disabled={busy} className="btn-primary">
            {busy ? "Saving…" : "Create customer"}
          </button>
        </div>
      </form>
      <DuplicateCustomerDialog
        info={dup}
        onClose={() => setDup(null)}
        onViewCustomer={(existing) => { onClose(); nav(`/customers/${existing.id}`); }}
        onCreateAnyway={() => { setDup(null); save(null, { force: true }); }}
        creating={busy}
      />
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#737373] mb-1.5">{label}</span>
      {children}
    </label>
  );
}
