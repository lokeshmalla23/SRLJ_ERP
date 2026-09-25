import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, Phone, Mail, MapPin, Sparkles, Eye, Printer, Download, X, AlertCircle, CheckCircle2, RefreshCw, TrendingUp, Lock, Pencil, Trash2, StickyNote } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiError } from "@/lib/api";
import { openWhatsAppChat } from "@/lib/whatsapp";
import { normalizeIndianMobile } from "@/lib/phone";
import { useAuth } from "@/context/AuthContext";
import useConfirm from "@/hooks/useConfirm";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR, fmtDate, fmtDateTime, fmtRatePerGram, parseMoneyInput } from "@/lib/format";
import { asArray } from "@/lib/jsonFields";
import { PageLoadingBadge } from "@/components/ui/Skeletons";
import { printHtml } from "@/lib/printHtml";
import { generateInvoicePrintHTMLAsync, downloadInvoicePdf } from "@/lib/invoicePrint";
import { hasOldGoldPayment, hasOldSilverPayment, exchangePaymentSnap, exchangeSnapShowsRate } from "@/lib/invoiceBillDisplay";
import DuplicateCustomerDialog, { dupInfo } from "@/components/customers/DuplicateCustomerDialog";
import { invoiceOccurredAt, sortByOccurredAtDesc } from "@/lib/occurredAt";
import { AccountsFilterBar, AccountsKpiCard, useAccountsDateRange } from "@/components/accounts/accountsShared";
import { useCustomersHiddenUnlocked } from "@/lib/customersHiddenUnlock";
import { useHiddenBillUnlockGate } from "@/hooks/useHiddenBillUnlockGate";
import { hiddenUnlockBleedClass } from "@/lib/hiddenUnlockSurface";

function WhatsAppGlyph({ size = 16 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function invoiceStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "cancelled") return { label: "Cancelled", cls: "bg-red-50 text-red-700" };
  if (s === "returned") return { label: "Returned", cls: "bg-slate-100 text-slate-700" };
  if (s === "partially_returned") return { label: "Partially Returned", cls: "bg-amber-50 text-amber-700" };
  return { label: "Active", cls: "bg-green-50 text-green-700" };
}

// ─── Invoice Side Panel ───────────────────────────────────────────────────────
function InvoiceSidePanel({ invoice, company, onClose }) {
  const items = asArray(invoice.items);
  const payments = asArray(invoice.payments).filter((p) => Number(p.amount) > 0);
  const gstCgst = Number(invoice.cgst_amount ?? (invoice.gst_amount || 0) / 2);
  const gstSgst = Number(invoice.sgst_amount ?? (invoice.gst_amount || 0) - gstCgst);

  const totals = items.reduce((acc, it) => {
    const qty = it.quantity || 1;
    acc.gross += (Number(it.gross_weight) || 0) * qty;
    acc.net   += (Number(it.net_weight)   || 0) * qty;
    return acc;
  }, { gross: 0, net: 0 });

  const handlePrint = async () => {
    try {
      const html = await generateInvoicePrintHTMLAsync(invoice, company, "print");
      await printHtml(html);
    } catch {
      /* printHtml already showed toast */
    }
  };

  const handleDownload = async () => {
    try {
      await downloadInvoicePdf(invoice, company);
    } catch {
      /* downloadInvoicePdf already showed a toast */
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-[#17201C]/30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-[600px] bg-[#FFFDF9] border-l border-[#E2E7E2] shadow-[0_0_45px_rgba(23,56,42,0.16)] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E7E2] bg-[#FAF7EF] flex-shrink-0">
          <div>
            <div className="text-[14px] font-semibold text-[#17201C]">{invoice.invoice_no}</div>
            <div className="text-[11px] text-[#6F7772] mt-0.5">{fmtDateTime(invoiceOccurredAt(invoice))}</div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-[#F1F4F0] flex items-center justify-center text-[#6F7772] hover:text-[#214F3A]">
            <X size={15} strokeWidth={1.5} />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Customer & rate info */}
          <div className="rounded-xl bg-[#FAF7EF] border border-[#E2E7E2] px-4 py-3 flex items-start justify-between">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#6F7772] font-semibold mb-1">Bill To</div>
              <div className="text-[13px] font-semibold text-[#17201C]">{invoice.customer_name || "Walk-in"}</div>
              {invoice.customer_mobile && <div className="text-[11.5px] text-[#4E5A53] font-mono mt-0.5">{invoice.customer_mobile}</div>}
            </div>
            {invoice.gold_rate && (
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-widest text-[#6F7772]">Gold Rate</div>
                <div className="text-[13px] font-semibold text-[#92400E]">{fmtRatePerGram(invoice.gold_rate)}</div>
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#6F7772] font-semibold mb-2">Items</div>
            <div className="rounded-xl border border-[#E2E7E2] overflow-hidden">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-[#F1F4F0] border-b border-[#E2E7E2]">
                    <th className="text-left px-3 py-2 font-semibold text-[#4E5A53]">Description</th>
                    <th className="text-right px-3 py-2 font-semibold text-[#4E5A53]">Qty</th>
                    <th className="text-right px-3 py-2 font-semibold text-[#4E5A53]">G.Wt</th>
                    <th className="text-right px-3 py-2 font-semibold text-[#4E5A53]">N.Wt</th>
                    <th className="text-right px-3 py-2 font-semibold text-[#4E5A53]">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E7E2]">
                  {items.map((it, i) => {
                    const qty = it.quantity || 1;
                    return (
                      <tr key={i}>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-[#17201C]">{it.name || it.product_name || "Item"}{qty > 1 ? ` × ${qty}` : ""}</div>
                          {it.purity && <div className="text-[10.5px] text-[#6F7772]">{it.purity}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-[#4E5A53]">{qty}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[#4E5A53]">{Number(it.gross_weight || 0).toFixed(3)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-[#4E5A53]">{Number(it.net_weight || 0).toFixed(3)}</td>
                        <td className="px-3 py-2.5 text-right font-mono font-medium text-[#17201C]">{fmtINR(Number(it.unit_price || 0) * qty)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[#F1F4F0] border-t-2 border-[#E2E7E2]">
                    <td className="px-3 py-2 font-semibold text-[#17201C]" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[#17201C]">{totals.gross.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[#17201C]">{totals.net.toFixed(3)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-[#17201C]">{fmtINR(invoice.subtotal)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Totals breakdown */}
          <div className="rounded-xl border border-[#E2E7E2] overflow-hidden">
            <div className="divide-y divide-[#E2E7E2]">
              {Number(invoice.discount) > 0 && (
                <div className="flex justify-between px-4 py-2.5 text-[12.5px]">
                  <span className="text-[#4E5A53]">Discount</span>
                  <span className="font-mono text-green-600">− {fmtINR(invoice.discount)}</span>
                </div>
              )}
              {/* Legacy invoices deducted Old Gold from grand total directly — keep showing
                  that so this breakdown still reconciles with the stored grand_total. New
                  invoices carry Old Gold as a payment instead (rendered below). */}
              {!hasOldGoldPayment(invoice) && Number(invoice.old_gold_value) > 0 && (
                <div className="flex justify-between px-4 py-2.5 text-[12.5px]">
                  <span className="text-[#4E5A53]">Old Gold Exchange</span>
                  <span className="font-mono text-green-600">− {fmtINR(invoice.old_gold_value)}</span>
                </div>
              )}
              {!hasOldSilverPayment(invoice) && Number(invoice.old_silver_value) > 0 && (
                <div className="flex justify-between px-4 py-2.5 text-[12.5px]">
                  <span className="text-[#4E5A53]">Old Silver Exchange</span>
                  <span className="font-mono text-green-600">− {fmtINR(invoice.old_silver_value)}</span>
                </div>
              )}
              <div className="flex justify-between px-4 py-2.5 text-[12.5px]">
                <span className="text-[#4E5A53]">CGST {((invoice.gst_pct || 3) / 2).toFixed(1)}%</span>
                <span className="font-mono text-[#17201C]">{fmtINR(gstCgst)}</span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-[12.5px]">
                <span className="text-[#4E5A53]">SGST {((invoice.gst_pct || 3) / 2).toFixed(1)}%</span>
                <span className="font-mono text-[#17201C]">{fmtINR(gstSgst)}</span>
              </div>
              <div className="flex justify-between px-4 py-3 bg-[#FAF7EF]">
                <span className="font-semibold text-[14px] text-[#17201C]">Net Total</span>
                <span className="font-bold text-[15px] text-[#17201C] font-mono">{fmtINR(invoice.grand_total)}</span>
              </div>
            </div>
          </div>

          {/* Payment summary */}
          {payments.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#6F7772] font-semibold mb-2">Payment</div>
              <div className="rounded-xl border border-[#E2E7E2] divide-y divide-[#E2E7E2]">
                {payments.map((p, i) => (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex justify-between items-center text-[12.5px]">
                      <span className="capitalize text-[#4E5A53]">{(p.mode || "cash").replace(/_/g, " ")}</span>
                      <span className="font-mono font-medium text-[#17201C]">{fmtINR(p.amount)}</span>
                    </div>
                    {exchangePaymentSnap(p) && (
                      <div className="text-[10.5px] text-[#89928C] font-mono mt-0.5">
                        {Number(exchangePaymentSnap(p).weight).toFixed(3)} g | {exchangePaymentSnap(p).purity}{exchangeSnapShowsRate(p) && <> | {fmtINR(exchangePaymentSnap(p).rate, { decimals: 0 })}/g</>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Bottom action bar */}
        <div className="flex-shrink-0 border-t border-[#E2E7E2] px-5 py-4 flex items-center gap-3 bg-[#FAF7EF]">
          <button onClick={handlePrint} className="btn-primary flex-1 inline-flex items-center justify-center gap-2">
            <Printer size={14} strokeWidth={1.5} /> Print Invoice
          </button>
          <button onClick={handleDownload} className="btn-secondary flex-1 inline-flex items-center justify-center gap-2">
            <Download size={14} strokeWidth={1.5} /> Download
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Collect Payment Modal ────────────────────────────────────────────────────
function CollectPaymentModal({ invoice, onClose, onSuccess }) {
  const [form, setForm] = useState({ amount: Number(invoice.balance_due).toFixed(2), mode: "cash", reference: "" });
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/invoices/${invoice.id}/payment`, {
        amount: parseMoneyInput(form.amount),
        mode: form.mode,
        reference: form.reference || null,
      });
      toast.success("Payment collected successfully");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-[#17201C]/30" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-[#FFFDF9] rounded-xl border border-[#E2E7E2] shadow-[0_18px_48px_rgba(23,56,42,0.12)] w-[420px] pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E7E2]">
            <div>
              <div className="text-[14px] font-semibold text-[#17201C]">Collect Payment</div>
              <div className="text-[11px] text-[#6F7772] mt-0.5">{invoice.invoice_no} · Balance due {fmtINR(invoice.balance_due)}</div>
            </div>
            <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-[#F1F4F0] flex items-center justify-center text-[#6F7772] hover:text-[#214F3A]">
              <X size={15} strokeWidth={1.5} />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            <label className="block text-[12px] text-[#4E5A53]">
              Amount (₹)
              <MoneyInput
                className="input mt-1 w-full"
                step="0.01"
                min="0.01"
                max={Number(invoice.balance_due)}
                value={form.amount}
                onValueChange={(raw) => setForm({ ...form, amount: raw })}
                required
              />
            </label>
            <label className="block text-[12px] text-[#4E5A53]">
              Payment Mode
              <select className="input mt-1 w-full" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </label>
            <label className="block text-[12px] text-[#4E5A53]">
              Reference / Note
              <input className="input mt-1 w-full" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Optional" />
            </label>
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
              <button type="submit" disabled={busy || !(parseMoneyInput(form.amount) > 0)} className="btn-primary flex-1">
                {busy ? "Saving…" : "Collect Payment"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CustomerDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const { can } = useAuth();
  const [confirm, confirmModal] = useConfirm();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [company, setCompany] = useState({});
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [outstanding, setOutstanding] = useState({ data: [], total_outstanding: 0 });
  const [collectModal, setCollectModal] = useState(null);
  const [metalSummary, setMetalSummary] = useState({ metals: [] });
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const statementRange = useAccountsDateRange("this_month");
  const [statement, setStatement] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);
  const [hiddenUnlocked, setHiddenUnlocked] = useCustomersHiddenUnlocked();
  const { handleTitleClick, lockButton, dialog, titleHint } = useHiddenBillUnlockGate(
    hiddenUnlocked,
    setHiddenUnlocked,
  );
  const hiddenParams = hiddenUnlocked ? { include_hidden: 1 } : {};

  const loadOutstanding = useCallback(() => {
    api.get(`/invoices/customer/${id}/outstanding`, { params: hiddenParams })
      .then(({ data: d }) => setOutstanding(d || { data: [], total_outstanding: 0 }))
      .catch(() => {});
  }, [id, hiddenUnlocked]);

  const loadMetalSummary = useCallback(() => {
    api.get(`/reports/customers/${id}/metal-summary`, { params: hiddenParams })
      .then(({ data: d }) => setMetalSummary(d || { metals: [] }))
      .catch(() => {});
  }, [id, hiddenUnlocked]);

  const loadStatement = useCallback(() => {
    setStatementLoading(true);
    api.get(`/reports/customers/${id}/ledger`, {
      params: { from: statementRange.from, to: statementRange.to, ...hiddenParams },
    })
      .then(({ data: d }) => setStatement(d || null))
      .catch(() => setStatement(null))
      .finally(() => setStatementLoading(false));
  }, [id, statementRange.from, statementRange.to, hiddenUnlocked]);

  useEffect(() => {
    loadStatement();
  }, [loadStatement]);

  useEffect(() => {
    const loadCompany = () => {
      api.get("/settings/company").then(({ data: d }) => setCompany(d || {})).catch(() => {});
    };
    loadCompany();
    window.addEventListener("company:updated", loadCompany);
    return () => window.removeEventListener("company:updated", loadCompany);
  }, []);

  useEffect(() => {
    setData(null);
    setError(null);
    setOutstanding({ data: [], total_outstanding: 0 });
    api.get(`/customers/${id}/360`, { params: hiddenParams })
      .then(({ data: d }) => {
        if (!d?.customer) { setError("Customer not found"); return; }
        setData(d);
        loadOutstanding();
        loadMetalSummary();
      })
      .catch(() => {
        api.get(`/customers/${id}`, { params: hiddenParams })
          .then(({ data: d }) => {
            if (!d?.customer) { setError("Customer not found"); return; }
            setData(d);
            loadOutstanding();
            loadMetalSummary();
          })
          .catch((err) => setError(err?.response?.data?.detail || err?.message || "Failed to load customer"));
      });
  }, [id, loadOutstanding, loadMetalSummary, hiddenUnlocked]);

  useEffect(() => {
    if (!data || location.hash !== "#notes-card") return;
    const el = document.getElementById("notes-card");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [data, location.hash]);

  if (error) {
    return (
      <div className={hiddenUnlockBleedClass(hiddenUnlocked)}>
      <div className="max-w-[720px]">
        <button onClick={() => nav("/customers")} className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6F7772] hover:text-[#214F3A] mb-4">
          <ArrowLeft size={13} strokeWidth={1.5} /> All customers
        </button>
        <div className="card p-8 text-[13px] text-[#6F7772]">{error}</div>
      </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={hiddenUnlockBleedClass(hiddenUnlocked)}>
      <div className="space-y-4">
        <PageLoadingBadge />
        <div className="h-96 shimmer rounded-xl border border-[#E2E7E2]" />
      </div>
      </div>
    );
  }

  const customer = data.customer || {};
  const invoices = sortByOccurredAtDesc(asArray(data.invoices));
  const schemes = asArray(data.schemes);
  const bookings = asArray(data.bookings);
  const activeBookings = bookings.filter((b) => b.status === "booked");
  const displayName = customer.name || "Customer";

  const handleWhatsApp = () => {
    const result = openWhatsAppChat(customer.mobile);
    if (!result.ok) toast.error(result.error);
  };

  const handleDelete = async () => {
    if (!(await confirm(`Delete "${displayName}"? This cannot be undone.`))) return;
    setDeleting(true);
    try {
      await api.delete(`/customers/${customer.id}`);
      toast.success("Customer deleted");
      nav("/customers");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={hiddenUnlockBleedClass(hiddenUnlocked)}>
    <div className="max-w-[1200px]">
      <button onClick={() => nav("/customers")} className="inline-flex items-center gap-1.5 text-[12.5px] text-[#6F7772] hover:text-[#214F3A] mb-4">
        <ArrowLeft size={13} strokeWidth={1.5} /> All customers
      </button>

      {/* Profile header */}
      <div className="flex items-start gap-6 mb-6">
        <div className="h-16 w-16 rounded-xl bg-[#214F3A] text-white flex items-center justify-center font-display text-[24px] shadow-[0_2px_8px_rgba(23,56,42,0.18)]">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h2
              className="font-display text-[26px] font-semibold text-[#17201C] tracking-tight select-none"
              onClick={handleTitleClick}
              title={titleHint}
            >
              {displayName}
            </h2>
            {customer.tag && (
              <span className={`chip ${customer.tag === "vip" ? "chip-gold" : "chip-neutral"}`}>{customer.tag}</span>
            )}
            {lockButton}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-1 text-[11.5px] text-[#6F7772] hover:text-[#214F3A] border border-[#E2E7E2] rounded-lg px-2 py-1"
            >
              <Pencil size={11} strokeWidth={1.5} /> Edit
            </button>
            {can("customers", "delete") && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-1 text-[11.5px] text-[#991B1B] hover:bg-[#FEF2F2] border border-[#FECACA] rounded-md px-2 py-1 disabled:opacity-60"
              >
                <Trash2 size={11} strokeWidth={1.5} /> {deleting ? "Deleting…" : "Delete"}
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center gap-5 text-[12.5px] text-[#4E5A53]">
            {customer.mobile && <span className="inline-flex items-center gap-1.5"><Phone size={12} strokeWidth={1.5} className="text-[#89928C]" />{customer.mobile}</span>}
            {customer.email && <span className="inline-flex items-center gap-1.5"><Mail size={12} strokeWidth={1.5} className="text-[#89928C]" />{customer.email}</span>}
            {customer.address && <span className="inline-flex items-center gap-1.5"><MapPin size={12} strokeWidth={1.5} className="text-[#89928C]" />{customer.address}</span>}
          </div>
          {(customer.pan_number || customer.aadhaar_number) && (
            <div className="mt-1.5 flex items-center gap-5 text-[11.5px] text-[#89928C] font-mono">
              {customer.pan_number && <span>PAN: {customer.pan_number}</span>}
              {customer.aadhaar_number && <span>Aadhaar: {customer.aadhaar_number}</span>}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={handleWhatsApp}
          disabled={!normalizeIndianMobile(customer.mobile)}
          title={normalizeIndianMobile(customer.mobile) ? `WhatsApp ${customer.mobile}` : "No valid mobile for WhatsApp"}
          className="ml-auto shrink-0 inline-flex items-center gap-2 rounded-[10px] border border-[#1EAD59] bg-[#25D366] hover:bg-[#1EBE5A] text-white font-semibold text-[13.5px] px-4 py-2.5 shadow-sm disabled:opacity-40 disabled:hover:bg-[#25D366] disabled:cursor-not-allowed"
        >
          <WhatsAppGlyph size={18} />
          WhatsApp
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Total Purchases" value={fmtINR(customer.total_purchases || 0)} icon={TrendingUp} />
        <Stat
          label="Outstanding Due"
          value={fmtINR(outstanding.total_outstanding)}
          icon={outstanding.total_outstanding > 0 ? AlertCircle : CheckCircle2}
          highlight={outstanding.total_outstanding > 0}
        />
        <Stat label="Advance Balance" value={fmtINR(data.advance_balance || 0)} icon={Lock} />
        <Stat
          label="Active Bookings"
          value={String(activeBookings.length)}
          icon={Lock}
          highlight={activeBookings.length > 0}
        />
      </div>

      {/* Notes */}
      <div id="notes-card" className="card mb-6 scroll-mt-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <StickyNote size={14} strokeWidth={1.5} className="text-[#D9A441]" />
            <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#6F7772]">Notes</div>
          </div>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="inline-flex items-center gap-1 text-[11.5px] text-[#6F7772] hover:text-[#214F3A] border border-[#E2E7E2] rounded-lg px-2 py-1"
          >
            <Pencil size={11} strokeWidth={1.5} /> {customer.notes ? "Edit notes" : "Add notes"}
          </button>
        </div>
        {customer.notes ? (
          <p className="text-[13px] text-[#17201C] whitespace-pre-wrap">{customer.notes}</p>
        ) : (
          <p className="text-[13px] text-[#89928C]">No notes added yet for this customer.</p>
        )}
      </div>

      {/* Bookings / Advance ledger */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="p-5 border-b border-[#E2E7E2] flex items-center justify-between gap-3">
          <div>
            <div className="section-title">Bookings &amp; advance ledger</div>
            <div className="text-[12px] text-[#6F7772] mt-0.5">
              Locked ornaments, installment payments, and balance due for this customer
            </div>
          </div>
          {activeBookings.length > 0 && (
            <span className="text-[11px] px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-800">
              {activeBookings.length} active
            </span>
          )}
        </div>
        {bookings.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[#6F7772]">No advance bookings yet.</div>
        ) : (
          <ul className="divide-y divide-[#E2E7E2]">
            {bookings.map((b) => {
              const statusCls = b.status === "booked"
                ? "bg-amber-100 text-amber-800"
                : b.status === "converted"
                  ? "bg-emerald-100 text-emerald-800"
                  : b.status === "expired"
                    ? "bg-stone-100 text-stone-600"
                    : "bg-red-50 text-red-700";
              const products = asArray(b.products);
              const payments = asArray(b.payments);
              return (
                <li key={b.quotation_id || b.quote_no} className="p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[13px] font-semibold text-[#17201C]">{b.quote_no}</span>
                        <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium capitalize ${statusCls}`}>
                          {b.status}
                        </span>
                        {b.price_locked && b.status === "booked" && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                            <Lock size={11} strokeWidth={1.5} /> Rate locked
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-[#6F7772] mt-1">
                        {b.booked_at ? `Booked ${fmtDateTime(invoiceOccurredAt(b))}` : "—"}
                        {b.valid_until ? ` · Hold till ${fmtDate(b.valid_until)}` : ""}
                        {b.gold_rate != null ? ` · ${fmtRatePerGram(b.gold_rate)}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] uppercase tracking-wider text-[#6F7772]">Bill / Paid / Due</div>
                      <div className="text-[13px] font-semibold tabular-nums text-[#17201C]">
                        {fmtINR(b.grand_total)} · {fmtINR(b.advance_paid)} · {fmtINR(b.remaining_amount)}
                      </div>
                      {Number(b.installment_count) > 1 && (
                        <div className="text-[11px] text-[#6F7772]">{b.installment_count} installments</div>
                      )}
                    </div>
                  </div>

                  {products.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-[#6F7772] mb-1.5">
                        {b.status === "booked" ? "Locked ornaments" : "Ornaments"}
                      </div>
                      <div className="rounded-lg border border-[#E2E7E2] overflow-hidden">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="bg-[#FAF7EF] border-b border-[#E2E7E2]">
                              <th className="text-left px-3 py-2 font-semibold text-[#4E5A53]">Item</th>
                              <th className="text-left px-3 py-2 font-semibold text-[#4E5A53]">Tag</th>
                              <th className="text-right px-3 py-2 font-semibold text-[#4E5A53]">Weight</th>
                              <th className="text-right px-3 py-2 font-semibold text-[#4E5A53]">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2E7E2]">
                            {products.map((p, idx) => (
                              <tr key={p.product_id || idx}>
                                <td className="px-3 py-2">
                                  <div className="font-medium text-[#17201C]">{p.name}</div>
                                  {p.purity && <div className="text-[10.5px] text-[#6F7772]">{p.purity}</div>}
                                </td>
                                <td className="px-3 py-2 font-mono text-[#4E5A53]">{p.barcode || "—"}</td>
                                <td className="px-3 py-2 text-right font-mono text-[#4E5A53]">
                                  {Number(p.net_weight || 0) > 0 ? `${Number(p.net_weight).toFixed(3)} g` : "—"}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {p.locked ? (
                                    <span className="text-amber-700 font-semibold">Reserved</span>
                                  ) : (
                                    <span className="text-[#6F7772] capitalize">{p.status || "—"}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {payments.length > 0 && (
                    <div>
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-[#6F7772] mb-1.5">
                        Advance payments
                      </div>
                      <div className="rounded-lg border border-[#E2E7E2] overflow-hidden">
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="bg-[#FAF7EF] border-b border-[#E2E7E2]">
                              <th className="text-left px-3 py-2 font-semibold text-[#4E5A53]">#</th>
                              <th className="text-left px-3 py-2 font-semibold text-[#4E5A53]">When</th>
                              <th className="text-left px-3 py-2 font-semibold text-[#4E5A53]">Mode</th>
                              <th className="text-right px-3 py-2 font-semibold text-[#4E5A53]">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#E2E7E2]">
                            {payments.map((p, idx) => (
                              <tr key={p.advance_id || idx}>
                                <td className="px-3 py-2 font-mono text-[#4E5A53]">{p.installment_no || idx + 1}</td>
                                <td className="px-3 py-2 font-mono text-[#4E5A53]">
                                  {p.paid_at ? fmtDateTime(invoiceOccurredAt(p)) : "—"}
                                </td>
                                <td className="px-3 py-2 capitalize text-[#4E5A53]">
                                  {String(p.mode || "cash").replace(/_/g, " ")}
                                </td>
                                <td className="px-3 py-2 text-right font-mono font-semibold text-[#17201C]">
                                  {fmtINR(p.amount)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Purchase history */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="p-5 border-b border-[#E2E7E2]">
          <div className="section-title">Purchase history</div>
        </div>
        {invoices.length === 0 ? (
          <div className="p-8 text-[13px] text-[#6F7772]">No purchases yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Invoice</th>
                <th className="table-th">Items</th>
                <th className="table-th text-right">Amount</th>
                <th className="table-th text-right">When</th>
                <th className="table-th text-center">Status</th>
                <th className="table-th text-center">Bill</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const items = asArray(inv.items);
                const labels = items.slice(0, 2).map((i) => i.name || i.product_name || i.code || "Item").join(", ");
                const badge = invoiceStatusBadge(inv.status);
                return (
                  <tr key={inv.id} className="table-row">
                    <td className="table-td font-mono text-[12.5px]">
                      <span className="inline-flex items-center gap-1.5">
                        {inv.invoice_no}
                        {inv.is_hidden ? (
                          <span className="rounded-full bg-[#D9A441]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#D9A441]">
                            Hidden
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="table-td text-[#4E5A53]">
                      {labels || "—"}
                      {items.length > 2 && ` +${items.length - 2}`}
                    </td>
                    <td className="table-td text-right font-medium tabular-nums">{fmtINR(inv.grand_total)}</td>
                    <td className="table-td text-right text-[#6F7772] font-mono text-[12px]">{fmtDateTime(invoiceOccurredAt(inv))}</td>
                    <td className="table-td text-center">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      {(inv.cancelled_at || inv.returned_at) && (
                        <div className="mt-1 text-[10px] text-[#89928C] font-mono">
                          {fmtDate(inv.cancelled_at || inv.returned_at)}
                        </div>
                      )}
                    </td>
                    <td className="table-td text-center">
                      <button
                        onClick={() => setSelectedInvoice(inv)}
                        className="inline-flex items-center gap-1 text-[11.5px] text-[#4E5A53] hover:text-[#214F3A] border border-[#E2E7E2] rounded-lg px-2.5 py-1 hover:border-[#17201C] transition-colors"
                      >
                        <Eye size={12} strokeWidth={1.5} /> View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Outstanding Balances */}
      {outstanding.data.length > 0 && (
        <div className="card p-0 overflow-hidden mb-6">
          <div className="p-5 border-b border-[#E2E7E2] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={14} strokeWidth={1.5} className="text-amber-500" />
              <div className="section-title">Outstanding Balances</div>
            </div>
            <div className="text-[12.5px] font-semibold text-amber-600 tabular-nums">Total due: {fmtINR(outstanding.total_outstanding)}</div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Invoice</th>
                <th className="table-th text-right">Grand Total</th>
                <th className="table-th text-right">Balance Due</th>
                <th className="table-th text-right">Date</th>
                <th className="table-th text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {outstanding.data.map((inv) => (
                <tr key={inv.id} className="table-row">
                  <td className="table-td font-mono text-[12.5px]">
                    <span className="inline-flex items-center gap-1.5">
                      {inv.invoice_no}
                      {inv.is_hidden ? (
                        <span className="rounded-full bg-[#D9A441]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#D9A441]">
                          Hidden
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="table-td text-right tabular-nums">{fmtINR(inv.grand_total)}</td>
                  <td className="table-td text-right tabular-nums font-semibold text-amber-600">{fmtINR(inv.balance_due)}</td>
                  <td className="table-td text-right text-[#6F7772] font-mono text-[12px]">{fmtDate(invoiceOccurredAt(inv))}</td>
                  <td className="table-td text-center">
                    <button
                      onClick={() => setCollectModal(inv)}
                      className="inline-flex items-center gap-1 text-[11.5px] text-white bg-[#214F3A] hover:bg-[#17382A] border border-[#214F3A] rounded-lg px-2.5 py-1 transition-colors shadow-[0_1px_2px_rgba(23,56,42,0.14)]"
                    >
                      <RefreshCw size={11} strokeWidth={2} /> Collect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Metals purchased */}
      {metalSummary.metals.length > 0 && (
        <div className="mb-6">
          <div className="section-title mb-3">Metals purchased</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {metalSummary.metals.map((m, i) => (
              <MetalCard key={m.metal} metal={m} index={i} />
            ))}
          </div>
        </div>
      )}

      {/* Gold Saving Schemes */}
      {schemes.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="p-5 border-b border-[#E2E7E2]">
            <div className="section-title">Gold Saving Schemes</div>
          </div>
          <ul className="divide-y divide-[#E2E7E2]">
            {schemes.map((s) => (
              <li key={s.id} className="p-5 flex items-center gap-4">
                <div className="h-9 w-9 rounded-md bg-[#FDFBF7] border border-[#EADFBF] flex items-center justify-center">
                  <Sparkles size={14} strokeWidth={1.5} className="text-[#D9A441]" />
                </div>
                <div className="flex-1">
                  <div className="text-[13.5px] font-medium">{s.plan_name || "Scheme"}</div>
                  <div className="text-[11.5px] text-[#6F7772] font-mono">
                    {asArray(s.payments).length || 0} / {s.duration_months || "—"} paid · Started {fmtDate(s.start_date)}
                    {s.status === "breaked" ? " · Breaked" : s.status === "matured" ? " · Matured" : s.status === "completed" ? " · Collected" : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[13px] font-semibold tabular-nums">{fmtINR(s.monthly_amount)}</div>
                  <div className="text-[11px] text-[#89928C] uppercase tracking-widest">Monthly</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ERP Statement */}
      <div className="card p-0 overflow-hidden mb-6">
        <div className="p-5 border-b border-[#E2E7E2]">
          <div className="section-title">ERP Statement</div>
          <div className="text-[12px] text-[#6F7772] mt-0.5">
            Every advance, refund, invoice, and payment for this customer — filter by date
          </div>
        </div>
        <div className="p-5 pb-0">
          <AccountsFilterBar
            from={statementRange.from}
            to={statementRange.to}
            preset={statementRange.preset}
            onFrom={(v) => { statementRange.setFrom(v); statementRange.applyPreset("custom"); }}
            onTo={(v) => { statementRange.setTo(v); statementRange.applyPreset("custom"); }}
            onPreset={statementRange.applyPreset}
            onRefresh={loadStatement}
            loading={statementLoading}
          />
        </div>
        {statement && (
          <div className="px-5 grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <AccountsKpiCard label="Opening" value={fmtINR(statement.opening_balance)} />
            <AccountsKpiCard label="Total Credit" value={fmtINR(statement.total_credit)} tone="good" />
            <AccountsKpiCard label="Total Debit" value={fmtINR(statement.total_debit)} tone="warn" />
            <AccountsKpiCard label="Closing" value={fmtINR(statement.closing_balance)} tone="good" />
          </div>
        )}
        {!statement?.data?.length ? (
          <div className="p-8 text-center text-[13px] text-[#6F7772]">
            {statementLoading ? "Loading statement…" : "No transactions in this period."}
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="table-head-row">
                <th className="table-th">Date</th>
                <th className="table-th">Type</th>
                <th className="table-th">Description</th>
                <th className="table-th text-right">Debit</th>
                <th className="table-th text-right">Credit</th>
                <th className="table-th text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.data.map((e, i) => (
                <tr key={`${e.type}-${e.id || i}`} className="table-row">
                  <td className="table-td font-mono text-[12px]">{fmtDate(e.date)}</td>
                  <td className="table-td text-[12px] capitalize">{e.type?.replace("_", " ")}</td>
                  <td className="table-td text-[12px]">{e.particulars}{e.reference ? ` · ${e.reference}` : ""}</td>
                  <td className="table-td text-right tabular-nums">{e.debit ? fmtINR(e.debit) : "—"}</td>
                  <td className="table-td text-right tabular-nums">{e.credit ? fmtINR(e.credit) : "—"}</td>
                  <td className="table-td text-right tabular-nums font-medium">{fmtINR(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Invoice side panel */}
      {selectedInvoice && (
        <InvoiceSidePanel
          invoice={selectedInvoice}
          company={company}
          onClose={() => setSelectedInvoice(null)}
        />
      )}

      {/* Collect payment modal */}
      {collectModal && (
        <CollectPaymentModal
          invoice={collectModal}
          onClose={() => setCollectModal(null)}
          onSuccess={() => loadOutstanding()}
        />
      )}

      {/* Edit customer modal */}
      {editOpen && (
        <EditCustomerModal
          customer={customer}
          onClose={() => setEditOpen(false)}
          onSaved={(updated) => setData((d) => ({ ...d, customer: { ...d.customer, ...updated } }))}
          nav={nav}
        />
      )}
      {confirmModal}
      {dialog}
    </div>
    </div>
  );
}

function EditCustomerModal({ customer, onClose, onSaved, nav }) {
  const [form, setForm] = useState({
    name: customer.name || "",
    mobile: customer.mobile || "",
    email: customer.email || "",
    address: customer.address || "",
    tag: customer.tag || "regular",
    dob: customer.dob || "",
    anniversary: customer.anniversary || "",
    pan_number: customer.pan_number || "",
    aadhaar_number: customer.aadhaar_number || "",
    notes: customer.notes || "",
  });
  const [busy, setBusy] = useState(false);
  const [dupCustomer, setDupCustomer] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e, { force = false } = {}) => {
    if (e) e.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.patch(`/customers/${customer.id}`, {
        ...form,
        pan_number: form.pan_number.trim() || null,
        aadhaar_number: form.aadhaar_number.trim() || null,
        dob: form.dob || null,
        anniversary: form.anniversary || null,
        allow_duplicate_mobile: force || undefined,
      });
      toast.success("Customer updated");
      onSaved(data);
      onClose();
    } catch (err) {
      const info = dupInfo(err);
      if (info) setDupCustomer(info);
      else toast.error(formatApiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#17201C]/40 flex items-start justify-center p-4 overflow-y-auto">
      <DuplicateCustomerDialog
        info={dupCustomer}
        onClose={() => setDupCustomer(null)}
        onViewCustomer={(existing) => nav(`/customers/${existing.id}`)}
        onCreateAnyway={() => { setDupCustomer(null); save(null, { force: true }); }}
        creating={busy}
      />
      <form onSubmit={save} className="bg-[#FFFDF9] rounded-xl border border-[#E2E7E2] shadow-[0_18px_48px_rgba(23,56,42,0.12)] w-full max-w-lg mt-16 mb-8">
        <div className="p-5 border-b border-[#E2E7E2] flex items-center justify-between">
          <div className="section-title">Edit customer</div>
          <button type="button" onClick={onClose} className="text-[#89928C] hover:text-[#214F3A]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <EditField label="Name"><input required className="input" value={form.name} onChange={(e) => set("name", e.target.value)} /></EditField>
          <div className="grid grid-cols-2 gap-3">
            <EditField label="Mobile"><input required className="input font-mono" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} /></EditField>
            <EditField label="Email"><input type="email" className="input" value={form.email} onChange={(e) => set("email", e.target.value)} /></EditField>
          </div>
          <EditField label="Address"><input className="input" value={form.address} onChange={(e) => set("address", e.target.value)} /></EditField>
          <div className="grid grid-cols-2 gap-3">
            <EditField label="PAN Number">
              <input className="input font-mono uppercase" maxLength={10} value={form.pan_number} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
            </EditField>
            <EditField label="Aadhaar Number">
              <input
                type="text"
                inputMode="numeric"
                className="input font-mono"
                maxLength={12}
                value={form.aadhaar_number}
                onChange={(e) => set("aadhaar_number", e.target.value.replace(/\D/g, "").slice(0, 12))}
                placeholder="123456789012"
              />
            </EditField>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <EditField label="Tag">
              <select className="input" value={form.tag} onChange={(e) => set("tag", e.target.value)}>
                <option value="regular">Regular</option>
                <option value="vip">VIP</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </EditField>
            <EditField label="DOB"><input type="date" className="input" value={form.dob ? String(form.dob).slice(0, 10) : ""} onChange={(e) => set("dob", e.target.value)} /></EditField>
            <EditField label="Anniversary"><input type="date" className="input" value={form.anniversary ? String(form.anniversary).slice(0, 10) : ""} onChange={(e) => set("anniversary", e.target.value)} /></EditField>
          </div>
          <EditField label="Notes">
            <textarea className="input" rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Any remarks or notes about this customer" />
          </EditField>
        </div>
        <div className="p-4 border-t border-[#E2E7E2] flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save changes"}</button>
        </div>
      </form>
    </div>
  );
}

function EditField({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.09em] font-semibold text-[#6F7772] mb-1.5">{label}</span>
      {children}
    </label>
  );
}

const METAL_ACCENTS = {
  gold: "#D9A441",
  silver: "#94A3B8",
  platinum: "#64748B",
};
const FALLBACK_ACCENTS = ["#D9A441", "#2F6B4F", "#A88A53", "#64748B"];

function metalAccent(name, index) {
  const key = String(name || "").trim().toLowerCase();
  return METAL_ACCENTS[key] || FALLBACK_ACCENTS[index % FALLBACK_ACCENTS.length];
}

function MetalCard({ metal, index = 0 }) {
  const accent = metalAccent(metal.metal, index);
  return (
    <div className="card !py-4 border-t-2 overflow-hidden" style={{ borderTopColor: accent }}>
      <div className="flex items-center justify-between">
        <div className="text-[13.5px] font-semibold text-[#17201C]">{metal.metal}</div>
        <div className="h-7 w-7 rounded-full flex-shrink-0" style={{ backgroundColor: `${accent}22`, border: `1px solid ${accent}55` }} />
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="font-display text-[22px] font-semibold tabular-nums text-[#17201C]">
          {Number(metal.total_net_weight || 0).toFixed(3)}
        </span>
        <span className="text-[11px] text-[#89928C]">g net</span>
      </div>
      <div className="mt-3 rounded-lg border border-[#E2E7E2] overflow-hidden">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="bg-[#FAF7EF] border-b border-[#E2E7E2]">
              <th className="text-left px-2.5 py-1.5 font-semibold text-[#6F7772]">Purity</th>
              <th className="text-right px-2.5 py-1.5 font-semibold text-[#6F7772]">Gross Wt</th>
              <th className="text-right px-2.5 py-1.5 font-semibold text-[#6F7772]">Net Wt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E7E2]">
            {metal.rows.map((r) => (
              <tr key={r.purity}>
                <td className="px-2.5 py-1.5 font-medium text-[#17201C]">{r.purity}</td>
                <td className="px-2.5 py-1.5 text-right font-mono text-[#4E5A53]">{Number(r.gross_weight || 0).toFixed(3)}</td>
                <td className="px-2.5 py-1.5 text-right font-mono text-[#4E5A53]">{Number(r.net_weight || 0).toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, icon: Icon, highlight }) {
  return (
    <div className={`card ${highlight ? "border-amber-300 bg-amber-50" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#6F7772]">{label}</div>
        {Icon && <Icon size={14} strokeWidth={1.5} className={highlight ? "text-amber-500" : "text-[#214F3A]"} />}
      </div>
      <div className={`font-display text-[22px] font-semibold mt-2 tabular-nums ${highlight ? "text-amber-600" : "text-[#17201C]"}`}>{value}</div>
    </div>
  );
}
