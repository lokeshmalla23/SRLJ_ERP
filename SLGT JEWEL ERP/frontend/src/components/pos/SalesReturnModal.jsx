import { useEffect, useState } from "react";
import { Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { asArray } from "@/lib/jsonFields";
import { fmtINR } from "@/lib/format";
import RefundEntryModal from "@/components/pos/RefundEntryModal";

/**
 * Partial sales return → credit note modal.
 * props: invoice (full or id+items), onClose, onDone
 */
export default function SalesReturnModal({ invoice, onClose, onDone }) {
  const [full, setFull] = useState(invoice?.items ? invoice : null);
  const [loading, setLoading] = useState(!invoice?.items);
  const [selected, setSelected] = useState({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [refundStepOpen, setRefundStepOpen] = useState(false);

  useEffect(() => {
    if (invoice?.items) {
      setFull(invoice);
      setLoading(false);
      return;
    }
    if (!invoice?.id) return;
    setLoading(true);
    api
      .get(`/invoices/${invoice.id}`)
      .then(({ data }) => setFull(data))
      .catch((err) => toast.error(formatApiError(err) || "Failed to load invoice"))
      .finally(() => setLoading(false));
  }, [invoice]);

  const items = asArray(full?.items);

  const toggle = (idx) => {
    setSelected((s) => {
      const next = { ...s };
      if (next[idx]) delete next[idx];
      else next[idx] = true;
      return next;
    });
  };

  const returnTotal = items.reduce(
    (s, it, idx) => (selected[idx] ? s + (Number(it.subtotal || it.line_total) || 0) : s),
    0,
  );
  // A fully-paid invoice needs an actual refund handed back; if it still has
  // a balance due, the return just reduces what the customer owes (no cash
  // physically moves), so there's nothing to ask about.
  const needsRefund = Number(full?.balance_due || 0) <= 0.001 && returnTotal > 0.5;

  const submit = async (refund = []) => {
    const lines = items
      .map((it, idx) => (selected[idx] ? { product_id: it.product_id || it.id, quantity: it.qty || it.quantity || 1 } : null))
      .filter(Boolean);
    if (!lines.length) {
      toast.error("Select at least one line to return");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(`/invoices/${full.id}/return`, { lines, reason, refund });
      toast.success(`Credit note ${data.credit_note?.credit_note_no || data.credit_note_no || "created"}`);
      setRefundStepOpen(false);
      onDone?.(data);
      onClose?.();
    } catch (err) {
      toast.error(formatApiError(err) || "Return failed");
    } finally {
      setSaving(false);
    }
  };

  const startSubmit = () => {
    const anySelected = items.some((_, idx) => selected[idx]);
    if (!anySelected) {
      toast.error("Select at least one line to return");
      return;
    }
    if (needsRefund) {
      setRefundStepOpen(true);
    } else {
      submit([]);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }} onClick={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "#E5E7EB" }}>
          <div>
            <div className="font-semibold text-sm">Sales Return</div>
            <div className="text-[12px] text-[#737373] font-mono">{full?.invoice_no || "…"}</div>
          </div>
          <button type="button" className="p-1 rounded hover:bg-gray-100" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="py-8 text-center text-[#a3a3a3]"><Loader2 className="animate-spin inline" size={18} /></div>
          ) : (
            <>
              {items.map((it, idx) => (
                <label key={idx} className="flex items-start gap-3 p-3 rounded-xl border cursor-pointer hover:border-[#B49042]" style={{ borderColor: selected[idx] ? "#B49042" : "#E5E7EB" }}>
                  <input type="checkbox" className="mt-1" checked={!!selected[idx]} onChange={() => toggle(idx)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate">{it.product_name || it.name}</div>
                    <div className="text-[11px] text-[#737373] font-mono">
                      {it.barcode || it.code || ""} · Qty {it.qty || it.quantity || 1}
                    </div>
                  </div>
                  <div className="text-[13px] tabular-nums font-medium">
                    {fmtINR(it.subtotal || it.line_total || 0)}
                  </div>
                </label>
              ))}
              <textarea
                className="input w-full"
                rows={2}
                placeholder="Reason for return"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </>
          )}
        </div>
        <div className="px-5 py-4 border-t flex gap-2" style={{ borderColor: "#E5E7EB" }}>
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary flex-1 inline-flex items-center justify-center gap-1.5" disabled={saving || loading} onClick={startSubmit}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Create credit note
          </button>
        </div>
      </div>
      <RefundEntryModal
        open={refundStepOpen}
        totalDue={returnTotal}
        busy={saving}
        onCancel={() => setRefundStepOpen(false)}
        onConfirm={submit}
      />
    </div>
  );
}
