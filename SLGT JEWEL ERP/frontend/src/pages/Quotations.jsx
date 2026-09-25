import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { TableSkeleton, PageLoadingBadge } from "@/components/ui/Skeletons";
import {
  ScanBarcode, Search, Plus, Trash2, Printer, Save,
  User, Phone, X, ChevronDown, RefreshCw,
  ArrowRight, Sparkles, Pencil, UserPlus, MessageCircle,
  Coins,
  Camera, Image as ImageIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import api, { formatApiError } from "@/lib/api";
import PageHeader from "@/components/common/PageHeader";
import MoneyInput from "@/components/ui/MoneyInput";
import WeightInput from "@/components/ui/WeightInput";
import { sanitizeWeightDraft, formatWeight, roundWeight } from "@/lib/weightInput";
import { fmtINR, fmtRatePerGram, parseMoneyInput } from "@/lib/format";
import { asArray } from "@/lib/jsonFields";
import { calcLineAmounts, calcInvoiceTotals, calcOldGoldValue, purityFactor, resolvePurityKey, resolveLineRate, OLD_GOLD_PURITY_SUGGESTIONS, OLD_SILVER_PURITY_SUGGESTIONS } from "@/lib/billingCalc";
import BreakRow from "@/components/pos/BreakRow";
import StoneDetailsModal from "@/components/pos/StoneDetailsModal";
import PrintPreviewModal from "@/components/PrintPreviewModal";
import { normalizeIndianMobile, toLocalIndianMobile } from "@/lib/phone";
import { buildWhatsAppQuotationMessage, openWhatsAppChat } from "@/lib/whatsapp";
import { printHtml } from "@/lib/printHtml";
import { generateActiveEstimationPrintHTML } from "@/lib/estimationPrint";
import { getCachedEstimationLayout, getCachedEstimationPrinterType, loadEstimationPrintSettings } from "@/lib/estimationLayout";
import useConfirm from "@/hooks/useConfirm";
import StockAlertDialog from "@/components/StockAlertDialog";
import { playStockAlertSound } from "@/lib/stockAlert";
import DuplicateCustomerDialog, { dupInfo } from "@/components/customers/DuplicateCustomerDialog";
import TestModeBanner, { TestBadge } from "@/components/TestModeBanner";
import { isPreAccountsQuotation } from "@/lib/accountsSetup";
import { useAccountsTestMode } from "@/hooks/useAccountsTestMode";
import { sortByOccurredAtDesc } from "@/lib/occurredAt";

// ── Constants ─────────────────────────────────────────────────────────────────
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


const LIVE_RATE_FIELDS = [
  { label: "24K Gold", field: "gold_24k" },
  { label: "22K Gold", field: "gold_22k" },
  { label: "18K Gold", field: "gold_18k" },
  { label: "Pure Silver", field: "pure_silver" },
  { label: "Silver", field: "silver" },
];

function LiveRatesBanner({ rates }) {
  const gr = rates || {};
  return (
    <div
      className="w-full rounded-[12px] border border-[#EADFBF] px-6 py-4 flex items-center gap-6 overflow-x-auto bg-[#FDFBF7] shadow-[0_1px_2px_rgba(117,87,30,0.05)]"
      style={{ background: "#FDFBF7" }}
    >
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="h-9 w-9 rounded-[9px] bg-[#B49042] flex items-center justify-center shadow-sm">
          <Coins size={16} strokeWidth={1.5} className="text-white" />
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#8A6D2F] font-bold">Live Gold Rates</div>
          <div className="flex items-center gap-1 mt-0.5">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
            </span>
            <span className="text-[9.5px] text-[#8A6D2F]/70">Today</span>
          </div>
        </div>
      </div>
      <div className="flex items-center flex-1">
        {LIVE_RATE_FIELDS.map(({ label, field }) => (
          <div key={field} className="flex flex-col items-center gap-0 px-6 border-l border-[#EADFBF] first:border-l-0">
            <div className="text-[10px] uppercase tracking-widest text-[#8A6D2F] font-bold mb-1">{label}</div>
            <span className="font-bold text-[18px] text-[#6F5720] leading-none">{fmtINR(gr[field])}</span>
            <div className="text-[9px] text-[#A1844A] uppercase tracking-wider mt-0.5">per gram</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Show locked/shop rate for item purity (22K jewellery — not 24K basis). */
function displayGoldRateLabel(items, goldRate24k, rateMap = {}) {
  const first = Array.isArray(items) && items.length ? items[0] : null;
  if (first) {
    const rate = resolveLineRate(first, goldRate24k, rateMap);
    const kind = String(first.metal || first.metal_name || "").toLowerCase().includes("silver")
      ? "Silver"
      : (first.purity || first.purity_name || "Gold");
    if (rate != null) return { label: kind, rate };
  }
  const purity = first?.purity || first?.purity_name || "22K";
  const key = resolvePurityKey(purity, first?.metal || first?.metal_name) || "22K";
  if (key === "Silver" || key === "PureSilver") {
    const r = rateMap[key] ?? rateMap.Silver ?? 90;
    return { label: key === "PureSilver" ? "Pure Silver" : "Silver", rate: Number(r) || 90 };
  }
  if (rateMap[key] != null && Number(rateMap[key]) > 0) {
    return { label: key, rate: Number(rateMap[key]) };
  }
  const basis = Number(goldRate24k) || 0;
  if (key === "22K" && basis > 0) {
    return { label: "22K", rate: Math.round(basis * 0.9167 * 100) / 100 };
  }
  if (key === "18K" && basis > 0) {
    return { label: "18K", rate: Math.round(basis * 0.75 * 100) / 100 };
  }
  if (key === "24K" && basis > 0) return { label: "24K", rate: basis };
  return { label: key || "22K", rate: basis };
}

/** Compress image file to a JPEG data-URL for storage (max edge ~1280px). */
function readImageAsDataUrl(file, maxEdge = 1280, quality = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type?.startsWith("image/")) {
      reject(new Error("Please choose an image file"));
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      reject(new Error("Image must be under 12 MB"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image"));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const STATUS_META = {
  draft:     { label: "Draft",      cls: "bg-[#F1F4ED] text-[#5F6D62]" },
  sent:      { label: "Sent",       cls: "bg-blue-100 text-blue-700" },
  accepted:  { label: "Finalized",  cls: "bg-green-100 text-green-700" },
  booked:    { label: "Booked",     cls: "bg-amber-100 text-amber-800" },
  converted: { label: "Converted",  cls: "bg-emerald-100 text-emerald-700" },
  expired:   { label: "Expired",    cls: "bg-red-100 text-red-600" },
  cancelled: { label: "Cancelled",  cls: "bg-[#F1F4ED] text-[#8D998F]" },
};

/** Full calcLineAmounts breakdown (goldValue/wastage/making/stone/line_total) for one
 * estimation item — the single place tray-weight substitution happens, reused by
 * both the aggregate total and the per-row Amount/edit-panel display below. */
function lineAmounts(p, goldRate, rateMap = {}) {
  // Tray: price the entered weight once (qty=1) — never the product's stored
  // per-unit weight, and never multiplied again by pieces sold (same rule as POS).
  return calcLineAmounts({
    ...p,
    purity: p.purity || (p.metal === "Silver" ? "Silver" : p.purity),
    quantity: p.is_tray ? 1 : (p.qty || p.quantity || 1),
    ...(p.is_tray ? { net_weight: Number(p.tray_weight_sold) || 0, gross_weight: Number(p.tray_weight_sold) || 0 } : {}),
  }, p.metal === "Silver" ? (rateMap.Silver ?? 90) : goldRate, rateMap);
}

function lineTotal(p, goldRate, rateMap = {}) {
  return lineAmounts(p, goldRate, rateMap).line_total;
}

// ── Past quotes list ───────────────────────────────────────────────────────────
function PastQuotes({ quotes, onEdit, onBook, onAddAdvance, onPrint, onCancel, onDelete }) {
  return (
    <div className="table-shell mt-4">
      <table className="w-full">
        <thead>
          <tr className="table-head-row">
            <th className="table-th">Est No</th>
            <th className="table-th">Customer</th>
            <th className="table-th">Items</th>
            <th className="table-th text-right">Total</th>
            <th className="table-th">Valid</th>
            <th className="table-th">Status</th>
            <th className="table-th text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotes.length === 0 && (
            <tr><td colSpan={7} className="table-td text-center text-[#6E786F] py-8">No estimations yet.</td></tr>
          )}
          {quotes.map(q => {
            const sm = STATUS_META[q.status] || STATUS_META.draft;
            const canEdit = q.status === "draft" || q.status === "sent";
            const canAdvance = ["draft", "sent", "accepted"].includes(q.status) && !q.converted_invoice_id && q.customer_id;
            const canAddAdvance = q.status === "booked" && !q.converted_invoice_id && q.customer_id;
            const canCancel = q.status === "booked";
            return (
              <tr key={q.id} className="table-row">
                <td className="table-td font-mono text-[12px] font-semibold">
                  {q.quote_no}
                  {isPreAccountsQuotation(q) && <TestBadge className="ml-1.5 align-middle" />}
                </td>
                <td className="table-td">
                  <div className="text-[13px] font-medium text-[#2F3A32]">{q.customer_name}</div>
                  <div className="text-[11px] text-[#6E786F]">{q.customer_mobile}</div>
                  {q.status === "booked" && (
                    <div className="text-[10.5px] text-amber-700 mt-0.5">
                      Adv {fmtINR(q.advance_paid || 0)}
                      {Number(q.installment_count) > 1 ? ` (${q.installment_count} parts)` : ""}
                      {" · "}Due {fmtINR(q.remaining_amount != null ? q.remaining_amount : Math.max(0, Number(q.grand_total || 0) - Number(q.advance_paid || 0)))}
                      {q.valid_until ? ` · Hold till ${new Date(q.valid_until).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}` : ""}
                      {(() => {
                        const d = displayGoldRateLabel(asArray(q.items), q.gold_rate, {
                          ...(q.gold_22k != null ? { "22K": Number(q.gold_22k) } : {}),
                          ...(q.gold_18k != null ? { "18K": Number(q.gold_18k) } : {}),
                        });
                        return d.rate > 0
                          ? ` · ${d.label} locked ${fmtRatePerGram(d.rate)}`
                          : "";
                      })()}
                    </div>
                  )}
                  {q.status === "expired" && Number(q.advance_paid) > 0 && (
                    <div className="text-[10.5px] text-[#6E786F] mt-0.5">
                      Expired — stock released · advance kept as customer credit ({fmtINR(q.advance_paid)})
                    </div>
                  )}
                </td>
                <td className="table-td text-[12.5px] text-[#5F6D62]">{q.items?.length || 0} items</td>
                <td className="table-td text-right font-medium text-[13px]">{fmtINR(q.grand_total)}</td>
                <td className="table-td text-[12px] text-[#5F6D62]">{q.valid_until ? new Date(q.valid_until).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}) : "—"}</td>
                <td className="table-td"><span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${sm.cls}`}>{sm.label}</span></td>
                <td className="table-td text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5 justify-end">
                    {canEdit && (
                      <button
                        type="button"
                        className="px-2 py-1 rounded border border-[#DCE3D6] text-[11px] font-semibold text-[#5F6D62] hover:border-[#66806B] hover:text-[#244B39]"
                        onClick={() => onEdit(q)}
                      >
                        Edit
                      </button>
                    )}
                    {canAdvance && (
                      <button
                        type="button"
                        className="px-2 py-1 rounded border border-amber-300 bg-amber-50 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                        onClick={() => onBook?.(q)}
                      >
                        Advance
                      </button>
                    )}
                    {canAddAdvance && (
                      <button
                        type="button"
                        className="px-2 py-1 rounded border border-amber-300 bg-amber-50 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                        onClick={() => onAddAdvance?.(q)}
                      >
                        Add advance
                      </button>
                    )}
                    {canCancel && (
                      <button
                        type="button"
                        className="px-2 py-1 rounded border border-red-200 bg-red-50 text-[11px] font-semibold text-red-700 hover:bg-red-100"
                        onClick={() => onCancel?.(q)}
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      className="px-2 py-1 rounded border border-[#DCE3D6] text-[11px] font-semibold text-[#5F6D62] hover:border-[#66806B] hover:text-[#244B39]"
                      onClick={() => onPrint(q)}
                    >
                      Print
                    </button>
                    <button
                      type="button"
                      title="Delete estimation"
                      className="p-1.5 rounded border border-[#DCE3D6] text-[#8D998F] hover:border-red-300 hover:bg-red-50 hover:text-red-600"
                      onClick={() => onDelete?.(q)}
                    >
                      <Trash2 size={13} strokeWidth={1.5} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BookAdvanceModal({ quote, onClose, onDone, onSetupRequired }) {
  const grand = Number(quote.grand_total) || 0;
  const shown = displayGoldRateLabel(
    asArray(quote.items),
    quote.gold_rate,
    {
      ...(quote.gold_22k != null ? { "22K": Number(quote.gold_22k) } : {}),
      ...(quote.gold_18k != null ? { "18K": Number(quote.gold_18k) } : {}),
      ...(quote.silver_rate != null ? { Silver: Number(quote.silver_rate) } : {}),
    },
  );
  const [amount, setAmount] = useState(() => {
    const suggest = Math.round(grand * 0.2);
    return suggest > 0 && suggest < grand ? String(suggest) : "";
  });
  const [mode, setMode] = useState("cash");
  const [days, setDays] = useState("7");
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const amt = parseMoneyInput(amount);
    if (!(amt > 0)) return toast.error("Enter advance amount");
    if (amt >= grand) return toast.error("Advance must be less than total — use POS for full payment");
    if (!quote.customer_id) return toast.error("Customer is required to take advance");
    setBusy(true);
    try {
      const { data } = await api.post(`/quotations/${quote.id}/book`, {
        advance_amount: amt,
        payment_mode: mode,
        deadline_days: Number(days) || 7,
        request_id: `book-${quote.id}-${Date.now()}`,
      });
      toast.success(
        `Advance ${fmtINR(amt)} taken on ${data.quote_no}. ${shown.label} rate locked`
        + (shown.rate ? ` at ${fmtRatePerGram(shown.rate)}` : "")
        + `. Collect balance in POS with ${data.quote_no}.`,
      );
      onDone(data);
    } catch (err) {
      toast.error(formatApiError(err) || "Booking failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#20352A]/35 backdrop-blur-[2px] flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-[#FFFDF8] rounded-[14px] border border-[#DCE3D6] shadow-[0_18px_50px_rgba(35,58,43,0.18)] w-full max-w-md">
        <div className="p-5 border-b border-[#DCE3D6] flex items-center justify-between">
          <div>
            <div className="section-title">Take advance</div>
            <div className="text-[12px] text-[#6E786F] mt-0.5 font-mono">{quote.quote_no} · {fmtINR(grand)}</div>
          </div>
          <button type="button" onClick={onClose} className="text-[#8D998F] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12.5px] text-[#5F6D62]">
            Takes advance payment, locks gold rate/prices, and reserves unique tags for this customer.
            You can add more advance installments later while the booking is active. Customer pays the final balance in POS with this estimation ID.
            If the deadline passes without billing, stock is released and advance stays as customer credit. Use Cancel to refund all installments and unfreeze items.
          </p>
          {shown.rate > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              {shown.label} rate to lock:{" "}
              <span className="font-mono font-semibold">{fmtRatePerGram(shown.rate)}</span>
              <span className="text-amber-800/80"> (as on this estimation)</span>
            </div>
          )}
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider font-semibold text-[#6E786F] mb-1">Advance amount</span>
            <MoneyInput className="input font-mono" min="1" step="1" required value={amount} onValueChange={setAmount} />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider font-semibold text-[#6E786F] mb-1">Payment mode</span>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider font-semibold text-[#6E786F] mb-1">Deadline (days)</span>
            <input className="input font-mono" type="number" min="1" max="90" value={days} onChange={(e) => setDays(e.target.value)} />
          </label>
          <div className="text-[12px] text-[#6E786F]">
            Remaining after advance: <span className="font-semibold text-[#2F3A32]">{fmtINR(Math.max(0, grand - parseMoneyInput(amount)))}</span>
          </div>
        </div>
        <div className="p-5 border-t border-[#DCE3D6] flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Take advance & lock rate"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddAdvanceModal({ quote, onClose, onDone, onSetupRequired }) {
  const grand = Number(quote.grand_total) || 0;
  const paid = Number(quote.advance_paid) || 0;
  const remaining = quote.remaining_amount != null
    ? Number(quote.remaining_amount)
    : Math.max(0, grand - paid);
  const parts = Array.isArray(quote.advance_payments) ? quote.advance_payments : [];
  const [amount, setAmount] = useState(() => {
    const suggest = Math.min(Math.round(remaining * 0.5), Math.max(0, remaining - 1));
    return suggest > 0 ? String(suggest) : "";
  });
  const [mode, setMode] = useState("cash");
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const amt = parseMoneyInput(amount);
    if (!(amt > 0)) return toast.error("Enter advance amount");
    if (amt >= remaining) return toast.error("Leave some balance for final POS payment");
    setBusy(true);
    try {
      const { data } = await api.post(`/quotations/${quote.id}/add-advance`, {
        advance_amount: amt,
        payment_mode: mode,
        request_id: `book-add-${quote.id}-${Date.now()}`,
      });
      toast.success(
        `Installment ${fmtINR(amt)} added on ${data.quote_no}. Total advance ${fmtINR(data.advance_paid)} · due ${fmtINR(data.remaining_amount)}`,
      );
      onDone(data);
    } catch (err) {
      toast.error(formatApiError(err) || "Could not add advance");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#20352A]/35 backdrop-blur-[2px] flex items-center justify-center p-4">
      <form onSubmit={save} className="bg-[#FFFDF8] rounded-[14px] border border-[#DCE3D6] shadow-[0_18px_50px_rgba(35,58,43,0.18)] w-full max-w-md">
        <div className="p-5 border-b border-[#DCE3D6] flex items-center justify-between">
          <div>
            <div className="section-title">Add advance</div>
            <div className="text-[12px] text-[#6E786F] mt-0.5 font-mono">
              {quote.quote_no} · paid {fmtINR(paid)} · due {fmtINR(remaining)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-[#8D998F] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[12.5px] text-[#5F6D62]">
            Collect another installment on this booked ornament. The tag stays reserved until the deadline.
            Final balance is collected in POS with this estimation number.
          </p>
          {quote.valid_until && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Hold till <span className="font-semibold">{new Date(quote.valid_until).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</span>
              {quote.gold_rate != null ? (() => {
                const d = displayGoldRateLabel(asArray(quote.items), quote.gold_rate, {
                  ...(quote.gold_22k != null ? { "22K": Number(quote.gold_22k) } : {}),
                });
                return ` · ${d.label} locked ${fmtRatePerGram(d.rate)}`;
              })() : ""}
            </div>
          )}
          {parts.length > 0 && (
            <div className="rounded-[9px] border border-[#DCE3D6] bg-[#F1F4ED] px-3 py-2">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-[#6E786F] mb-1.5">Previous installments</div>
              <ul className="space-y-1">
                {parts.map((p, idx) => (
                  <li key={p.advance_id || idx} className="flex justify-between text-[12px] text-[#5F6D62]">
                    <span>#{p.installment_no || idx + 1} · {(p.mode || "cash").replace("_", " ")}</span>
                    <span className="font-mono font-semibold text-[#2F3A32]">{fmtINR(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider font-semibold text-[#6E786F] mb-1">This installment</span>
            <MoneyInput className="input font-mono" min="1" step="1" required value={amount} onValueChange={setAmount} />
          </label>
          <label className="block">
            <span className="block text-[11px] uppercase tracking-wider font-semibold text-[#6E786F] mb-1">Payment mode</span>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
              <option value="bank_transfer">Bank transfer</option>
            </select>
          </label>
          <div className="text-[12px] text-[#6E786F]">
            After this: advance <span className="font-semibold text-[#2F3A32]">{fmtINR(paid + parseMoneyInput(amount))}</span>
            {" · "}still due <span className="font-semibold text-[#2F3A32]">{fmtINR(Math.max(0, remaining - parseMoneyInput(amount)))}</span>
          </div>
        </div>
        <div className="p-5 border-t border-[#DCE3D6] flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Add installment"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function Quotations() {
  const navigate = useNavigate();
  const [confirm, confirmModal] = useConfirm();
  const [tab, setTab] = useState("new"); // "new" | "history"
  const [goldRate, setGoldRate] = useState(6650); // 24K basis (same as POS)
  const [rate22k, setRate22k] = useState(null);
  const [rate18k, setRate18k] = useState(null);
  const [silverRate, setSilverRate] = useState(null);
  const [pureSilverRate, setPureSilverRate] = useState(null);
  const [liveRates, setLiveRates] = useState({});
  // Estimations don't carry GST — only final invoices do.
  const gstPct = 0;
  const [company, setCompany] = useState({ name: "Sri Srinivasa Jewellers" });
  // Which printer type (normal A5 vs thermal receipt) is active in
  // Settings → Estimation Print, plus that type's layout — decides which
  // estimation print HTML actually gets generated.
  const [printConfig, setPrintConfig] = useState(() => ({
    type: getCachedEstimationPrinterType(),
    layout: getCachedEstimationLayout(),
  }));
  // Confirm-before-printer preview — same modal/UX as POS Billing.
  const [previewHtml, setPreviewHtml] = useState(null);
  const [printing, setPrinting] = useState(false);
  // Thermal receipts have no fixed page height (continuous roll) — measured
  // from the iframe's actual rendered content once it loads.
  const [thermalPreviewH, setThermalPreviewH] = useState(400);

  // New quote state
  const [editingQuoteId, setEditingQuoteId] = useState(null);
  const [editingQuoteNo, setEditingQuoteNo] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [custSearch, setCustSearch] = useState("");
  const [custResults, setCustResults] = useState([]);
  const [custSearched, setCustSearched] = useState(false);
  const [showCustDrop, setShowCustDrop] = useState(false);

  // New customer — same full drawer as POS Billing (name, mobile, email, address,
  // PAN + photo, tag, DOB, anniversary), not just a name/mobile mini-form.
  const [newCustOpen, setNewCustOpen] = useState(false);
  const [newCustSaving, setNewCustSaving] = useState(false);
  const [newCustForm, setNewCustForm] = useState({
    name: "", mobile: "", email: "", address: "",
    pan_number: "", aadhaar_number: "", pan_image: "", tag: "regular", dob: "", anniversary: "",
  });
  const [panSourceOpen, setPanSourceOpen] = useState(false);
  const panGalleryRef = useRef(null);
  const panCameraRef = useRef(null);
  const [dupCustomer, setDupCustomer] = useState(null);
  const [dupViewing, setDupViewing] = useState(false);

  // Salesperson (same search + dropdown pattern as POS Billing)
  const [employees, setEmployees] = useState([]);
  const [salesperson, setSalesperson] = useState(null);
  const [empSearch, setEmpSearch] = useState("");
  const [empDropOpen, setEmpDropOpen] = useState(false);
  const empDropRef = useRef(null);

  const [items, setItems] = useState([]);
  // Per-item pricing edit (Rate / Wastage / Making / Stone) — only offered
  // when editing an already-saved estimation from History, never while
  // creating a brand-new one (same override fields/UI as POS Billing).
  const [expandedItem, setExpandedItem] = useState(null);
  const [stoneModalItemId, setStoneModalItemId] = useState(null);
  const [stockAlert, setStockAlert] = useState({ open: false, title: "Out of Stock", message: "" });
  const showStockAlert = (productName, message, title = "Out of Stock") => {
    setStockAlert({ open: true, title, message: productName ? `"${productName}" — ${message}` : message });
    playStockAlertSound();
  };
  const [discount, setDiscount] = useState(0);
  const [oldGold, setOldGold] = useState({ active: false, weight: "", purity: "22K", rate: "" });
  const [oldGoldOpen, setOldGoldOpen] = useState(false);
  const [oldSilver, setOldSilver] = useState({ active: false, weight: "", purity: "925", rate: "" });
  const [oldSilverOpen, setOldSilverOpen] = useState(false);
  // Settings → Application Management toggle, per metal — same setting POS Billing reads.
  const [oldMetalManual, setOldMetalManual] = useState({ gold: false, silver: false });
  const [notes, setNotes] = useState("");
  const [validDays, setValidDays] = useState(7);
  const [saving, setSaving] = useState(false);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  // Barcode / product search
  const [barcodeInput, setBarcodeInput] = useState("");
  const [prodResults, setProdResults] = useState([]);
  const [showProdDrop, setShowProdDrop] = useState(false);
  const barcodeRef = useRef(null);

  // History
  const [quotes, setQuotes] = useState([]);
  const [histSearch, setHistSearch] = useState("");
  const [histLoading, setHistLoading] = useState(false);
  const [bookingQuote, setBookingQuote] = useState(null);
  const [addAdvanceQuote, setAddAdvanceQuote] = useState(null);
  const testMode = useAccountsTestMode();

  const applyGoldSettings = useCallback((v) => {
    if (!v || typeof v !== "object") return;
    setLiveRates({
      gold_24k: Number(v.gold_24k) || 0,
      gold_22k: Number(v.gold_22k) || 0,
      gold_18k: Number(v.gold_18k) || 0,
      pure_silver: Number(v.pure_silver) || 0,
      silver: Number(v.silver) || 0,
    });
    if (v.gold_24k != null) setGoldRate(Number(v.gold_24k));
    else if (v.rate != null) setGoldRate(Number(v.rate));
    else if (v.gold_22k != null) setGoldRate(Number(v.gold_22k) / 0.9167);
    if (v.gold_22k != null) setRate22k(Number(v.gold_22k));
    if (v.gold_18k != null) setRate18k(Number(v.gold_18k));
    if (v.silver != null) setSilverRate(Number(v.silver));
    if (v.pure_silver != null) setPureSilverRate(Number(v.pure_silver));
  }, []);

  // Load settings — gold rates from Settings/Dashboard (read-only here)
  useEffect(() => {
    api.get("/settings/gold-rate").then(({ data }) => applyGoldSettings(data)).catch(() => {});
    api.get("/settings").then(r => {
      const arr = Array.isArray(r.data) ? r.data : [];
      const co = arr.find(e => e.key === "company");
      if (co?.value && Object.keys(co.value).length) setCompany(co.value);
    }).catch(() => {});
    loadEstimationPrintSettings().then(({ type, layout }) => setPrintConfig({ type, layout })).catch(() => {});
    api.get("/settings/old-metal-exchange").then(({ data }) => {
      setOldMetalManual({ gold: data?.manual?.gold === true, silver: data?.manual?.silver === true });
    }).catch(() => {});
  }, [applyGoldSettings]);

  useEffect(() => {
    if (tab !== "new") return;
    api.get("/settings/gold-rate").then(({ data }) => applyGoldSettings(data)).catch(() => {});
  }, [tab, applyGoldSettings]);

  // Load salespersons (same source POS Billing uses)
  useEffect(() => {
    api.get("/employees")
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : (data?.employees || []);
        setEmployees(list.filter((e) => !e.status || e.status === "active"));
      })
      .catch((err) => toast.error(formatApiError(err) || "Failed to load salespersons"));
  }, []);

  // Close salesperson dropdown on outside click
  useEffect(() => {
    const onDoc = (e) => {
      if (empDropRef.current && !empDropRef.current.contains(e.target)) setEmpDropOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const filteredEmployees = useMemo(() => {
    const t = empSearch.toLowerCase();
    if (!t) return employees;
    return employees.filter((e) =>
      e.name?.toLowerCase().includes(t) ||
      (e.code || e.employee_code || "").toLowerCase().includes(t)
    );
  }, [employees, empSearch]);

  const loadHistory = useCallback(() => {
    setHistLoading(true);
    api.get("/quotations?limit=100")
      .then(r => setQuotes(r.data?.data || []))
      .catch(() => {})
      .finally(() => setHistLoading(false));
  }, []);

  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  // Customer search
  useEffect(() => {
    if (!custSearch.trim()) { setCustResults([]); setCustSearched(false); return; }
    setCustSearched(false);
    const t = setTimeout(() => {
      api.get(`/customers?q=${encodeURIComponent(custSearch)}&limit=8`)
        .then(r => setCustResults(Array.isArray(r) ? r : r.data || []))
        .catch(() => setCustResults([]))
        .finally(() => setCustSearched(true));
    }, 250);
    return () => clearTimeout(t);
  }, [custSearch]);

  // New customer — same drawer + flow as POS Billing, prefilled from whatever
  // was typed in the customer search box (phone-looking text → mobile, else → name).
  const openNewCustomer = () => {
    setShowCustDrop(false);
    const typed = (custSearch || "").trim();
    const looksPhone = /^[\d+\s-]{6,}$/.test(typed);
    setNewCustForm({
      name: looksPhone ? "" : typed,
      mobile: looksPhone ? typed.replace(/\s+/g, "") : "",
      email: "", address: "", pan_number: "", aadhaar_number: "", pan_image: "",
      tag: "regular", dob: "", anniversary: "",
    });
    setNewCustOpen(true);
  };

  const onPanImagePicked = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await readImageAsDataUrl(file);
      setNewCustForm((f) => ({ ...f, pan_image: dataUrl }));
      setPanSourceOpen(false);
      toast.success("PAN card image attached");
    } catch (err) {
      toast.error(err?.message || "Could not use that image");
    }
  };

  // Shared by "customer created" and "use the existing match instead" —
  // both end with the same customer attached to this estimate.
  const attachCustomer = (saved) => {
    setCustomer(saved);
    setCustSearch(""); setCustResults([]); setShowCustDrop(false);
    setPanSourceOpen(false);
    setNewCustOpen(false);
  };

  const saveNewCustomer = async (e, { force = false } = {}) => {
    e?.preventDefault?.();
    const name = newCustForm.name.trim();
    const normalized = normalizeIndianMobile(newCustForm.mobile);
    if (!name) return toast.error("Customer name is required");
    if (!normalized) return toast.error("Enter a valid 10-digit Indian mobile number");
    const localMobile = toLocalIndianMobile(normalized);

    setNewCustSaving(true);
    try {
      const { data: created } = await api.post("/customers", {
        name,
        mobile: localMobile,
        email: newCustForm.email.trim() || undefined,
        address: newCustForm.address.trim() || undefined,
        pan_number: newCustForm.pan_number.trim().toUpperCase() || undefined,
        aadhaar_number: newCustForm.aadhaar_number.trim() || undefined,
        pan_image: newCustForm.pan_image || undefined,
        tag: newCustForm.tag || "regular",
        dob: newCustForm.dob || undefined,
        anniversary: newCustForm.anniversary || undefined,
        allow_duplicate_mobile: force || undefined,
      });
      attachCustomer(created);
      toast.success(`Customer ${created.name} added`);
    } catch (err) {
      const info = dupInfo(err);
      if (info) setDupCustomer(info);
      else toast.error(formatApiError(err));
    } finally {
      setNewCustSaving(false);
    }
  };

  const useExistingCustomer = async (existing) => {
    setDupViewing(true);
    try {
      const { data } = await api.get(`/customers/${existing.id}`);
      attachCustomer(data);
      setDupCustomer(null);
      toast.success(`Using existing customer "${data.name}"`);
    } catch (err) {
      toast.error(formatApiError(err) || "Could not load that customer");
    } finally {
      setDupViewing(false);
    }
  };

  // Product / barcode search
  useEffect(() => {
    if (!barcodeInput.trim()) { setProdResults([]); setShowProdDrop(false); return; }
    const t = setTimeout(() => {
      api.get(`/products?q=${encodeURIComponent(barcodeInput)}&limit=8&sellable=1`).then(r => {
        const arr = Array.isArray(r) ? r : r.data || [];
        // If exact barcode match, auto-add immediately
        const exact = arr.find(p => p.barcode === barcodeInput.trim() || p.code === barcodeInput.trim());
        if (exact) { addProduct(exact); setBarcodeInput(""); setProdResults([]); return; }
        setProdResults(arr);
        setShowProdDrop(arr.length > 0);
      }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [barcodeInput]);

  // Unique tags: one physical piece — block re-adding the same one.
  // Quantity items: block adding more than what's actually in stock across this estimate.
  const addProduct = (p) => {
    const isUnique = p.inventory_mode === "unique_tag" || p.inventory_mode === "unique" || p.track_type === "unique";
    const isTrayItem = p.unit_code === "tray" || (p.tray_total_weight > 0 && !p.unit_code);
    setItems(prev => {
      if (isUnique) {
        const dup = prev.some((x) => x.product_id === p.id || (p.barcode && x.barcode === p.barcode));
        if (dup) {
          showStockAlert(p.name, "It's already on this estimate — it's a single, one-of-a-kind piece.");
          return prev;
        }
      } else if (!isTrayItem) {
        const availableStock = Number(p.stock_qty) || 0;
        const alreadyInEstimate = prev
          .filter((x) => x.product_id === p.id)
          .reduce((s, x) => s + (Number(x.qty) || 0), 0);
        if (availableStock > 0 && alreadyInEstimate + 1 > availableStock) {
          showStockAlert(
            p.name,
            `Only ${availableStock} in stock, and you already have ${alreadyInEstimate} of it on this estimate.`,
          );
          return prev;
        }
      }
      const trayStockQty = Number(p.stock_qty) || 0;
      const trayTotalWeight = roundWeight(p.tray_total_weight);
      const isPieceItem = p.unit_code === "pc";
      const purity = p.purity_name || "22K";
      const metal = p.metal_name || "Gold";
      const stones = asArray(p.stone_details).map((s) => ({
        stone_type: s?.stone_type || "",
        count: Number(s?.count) || 0,
        total_carat: Number(s?.total_carat) || 0,
        price: Number(s?.price) || 0,
      }));
      return [...prev, {
        _id: Date.now(),
        product_id: p.id, product_name: p.name, code: p.code, barcode: p.barcode,
        inventory_mode: p.inventory_mode || "quantity",
        available_stock: Number(p.stock_qty) || 0,
        purity, metal,
        purity_code: p.purity_code || null,
        purity_factor: purityFactor(purity, p.purity_code, metal).toNumber(),
        gross_weight: p.gross_weight || 0,
        net_weight: p.net_weight || 0,
        stone_weight: Number(p.stone_weight) > 0
          ? Number(p.stone_weight)
          : Math.max(0, Number(p.gross_weight || 0) - Number(p.net_weight || 0)),
        making_charges: p.making_charges || 0,
        making_charge_type: p.making_charge_type || "per_gram",
        wastage_pct: p.wastage_pct || 0,
        stone_charges: stones.reduce((s, r) => s + (Number(r?.price) || 0), 0),
        stone_names: [...new Set(stones.map((r) => r?.stone_type).filter(Boolean))].join(", "),
        stones,
        // Freeze this line's own applicable rate the moment it's added — the
        // estimation must keep showing/billing at the rate it was actually
        // quoted at, even if the shop's gold rate or the product's own
        // defaults change later. Product Master is never touched; this lives
        // only on the estimation's own item snapshot.
        rate_override: resolveLineRate({ purity, metal, rate_override: null, purity_code: p.purity_code }, goldRate, purityRateMap) ?? null,
        wastage_amount_override: null,
        making_amount_override: null,
        // Piece unit: flat per-piece price entered on the product — there's no
        // weight to price off, so it must be carried in as the line's price
        // override or it silently prices at zero (no weight × rate to fall back on).
        price_override: isPieceItem ? (Number(p.selling_price) || null) : null,
        qty: 1,
        is_tray: isTrayItem,
        tray_stock_qty: trayStockQty,
        tray_total_weight: trayTotalWeight,
        tray_pieces_sold: isTrayItem ? 1 : undefined,
        tray_weight_sold: isTrayItem ? 0 : undefined,
        tray_weight_input: isTrayItem ? "0" : undefined,
      }];
    });
    setShowProdDrop(false);
    barcodeRef.current?.focus();
  };

  const removeItem = (id) => setItems(prev => prev.filter(i => i._id !== id));

  const updateItem = (id, key, val) => setItems(prev => prev.map(i => i._id === id ? { ...i, [key]: val } : i));

  // Multi-field patch — same shape POS Billing's per-item edit panel uses, so
  // the shared BreakRow/StoneDetailsModal wiring below is a straight copy.
  const patchItem = (id, patch) => setItems(prev => prev.map(i => i._id === id ? { ...i, ...patch } : i));

  const updateStonePrice = (id, stoneIndex, amount) => setItems(prev => prev.map((x) => {
    if (x._id !== id) return x;
    const stones = Array.isArray(x.stones) ? x.stones.slice() : [];
    stones[stoneIndex] = { ...stones[stoneIndex], price: amount };
    const stone_charges = stones.reduce((s, r) => s + (Number(r?.price) || 0), 0);
    return { ...x, stones, stone_charges };
  }));

  const cancelEdit = () => {
    setEditingQuoteId(null); setEditingQuoteNo(null);
    setCustomer(null); setCustSearch(""); setItems([]); setDiscount(0); setNotes(""); setBarcodeInput("");
    setOldGold({ active: false, weight: "", purity: "22K", rate: "" }); setOldGoldOpen(false);
    setOldSilver({ active: false, weight: "", purity: "925", rate: "" }); setOldSilverOpen(false);
    setSalesperson(null); setEmpSearch("");
    setNewCustOpen(false); setPanSourceOpen(false);
  };

  const editQuote = (q) => {
    if (q.status !== "draft" && q.status !== "sent") {
      toast.error("Only draft or sent estimations can be edited");
      return;
    }
    setEditingQuoteId(q.id);
    setEditingQuoteNo(q.quote_no);
    setCustomer(q.customer_id ? { id: q.customer_id, name: q.customer_name, mobile: q.customer_mobile, email: q.customer_email } : null);
    setCustSearch("");
    setItems(asArray(q.items).map((it, idx) => {
      const base = { ...it, _id: it._id ?? `${q.id}-${idx}` };
      // Older estimations saved before rates were frozen per line have no
      // rate_override — best-effort reconstruct one from this quotation's own
      // saved gold_rate so editing/re-saving it locks in a real number instead
      // of silently drifting to today's rate. Never touches Product Master.
      if (base.rate_override == null && Number(q.gold_rate) > 0) {
        base.rate_override = resolveLineRate({ ...base, rate_override: null }, Number(q.gold_rate), {}) ?? null;
      }
      return base;
    }));
    setDiscount(q.discount || 0);
    const qOg = q.old_gold && typeof q.old_gold === "object" ? q.old_gold : null;
    setOldGold({
      active: Boolean(qOg?.active),
      weight: qOg?.weight != null ? String(qOg.weight) : "",
      purity: qOg?.purity || "22K",
      rate: qOg?.rate != null ? String(qOg.rate) : "",
    });
    setOldGoldOpen(Boolean(qOg?.active));
    const qOs = q.old_silver && typeof q.old_silver === "object" ? q.old_silver : null;
    setOldSilver({
      active: Boolean(qOs?.active),
      weight: qOs?.weight != null ? String(qOs.weight) : "",
      purity: qOs?.purity || "925",
      rate: qOs?.rate != null ? String(qOs.rate) : "",
    });
    setOldSilverOpen(Boolean(qOs?.active));
    setNotes(q.notes || "");
    setSalesperson(q.salesperson_id
      ? (employees.find((e) => e.id === q.salesperson_id) || (q.salesperson_name ? { id: q.salesperson_id, name: q.salesperson_name } : null))
      : null);
    setEmpSearch("");
    setTab("new");
  };

  const cancelBooking = async (q) => {
    if (!(await confirm(
      `Cancel booking for ${q.quote_no}?\n\n• Advance will be refunded/revoked\n• Products will be unfrozen for sale\n• You can make a new estimation for another customer`,
    ))) return;
    try {
      await api.post(`/quotations/${q.id}/cancel-booking`, { reason: "Cancelled from Estimations" });
      toast.success(`${q.quote_no} cancelled — advance refunded, stock released`);
      loadHistory();
    } catch (err) {
      toast.error(formatApiError(err) || "Cancel failed");
    }
  };

  const deleteQuote = async (q) => {
    if (!(await confirm(
      `Delete estimation ${q.quote_no}?\n\nThis cannot be undone.`,
      { title: "Delete estimation", confirmLabel: "Delete", cancelLabel: "Cancel" },
    ))) return;
    try {
      await api.delete(`/quotations/${q.id}`);
      toast.success(`${q.quote_no} deleted`);
      loadHistory();
    } catch (err) {
      toast.error(formatApiError(err) || "Delete failed");
    }
  };

  // Totals — same ROUND_HALF_UP rules as POS / invoices (use purity rateMap)
  const purityRateMap = useMemo(() => {
    const map = {};
    if (goldRate != null) map['24K'] = goldRate;
    if (rate22k != null) map['22K'] = rate22k;
    if (rate18k != null) map['18K'] = rate18k;
    if (silverRate != null) map.Silver = silverRate;
    if (pureSilverRate != null) map.PureSilver = pureSilverRate;
    else if (silverRate != null) map.PureSilver = silverRate;
    return map;
  }, [goldRate, rate22k, rate18k, silverRate, pureSilverRate]);

  const billTotals = calcInvoiceTotals({
    lineTotals: items.map((it) => lineTotal(it, goldRate, purityRateMap)),
    discount: parseMoneyInput(discount),
    discountType: "flat",
    gstPct,
    oldGoldValue: 0,
  });
  const subtotal = billTotals.subtotal;
  const discAmt = billTotals.discount;
  const gstAmt = billTotals.gst_amount;
  const grandTotal = billTotals.grand_total;

  // Old Metal Exchange calculator — informational on the estimate (never
  // reduces the estimate total); carries into POS if this estimate is loaded.
  const oldGoldValue = oldGold.active
    ? calcOldGoldValue({ weight: parseMoneyInput(oldGold.weight), rate: parseMoneyInput(oldGold.rate), manual: oldMetalManual.gold })
    : 0;
  const oldSilverValue = oldSilver.active
    ? calcOldGoldValue({ weight: parseMoneyInput(oldSilver.weight), rate: parseMoneyInput(oldSilver.rate), manual: oldMetalManual.silver })
    : 0;

  // Live receipt preview (updates as items / goldRate / customer change)
  const livePreviewHtml = useMemo(() => {
    const draftQuote = {
      quote_no: editingQuoteNo || "DRAFT",
      customer_name: customer?.name || "",
      customer_mobile: customer?.mobile || "",
      salesperson_name: salesperson?.name || "",
      discount: discAmt,
      notes,
      gst_pct: gstPct,
      created_at: new Date().toISOString(),
      old_gold: oldGold.active ? {
        active: true,
        weight: parseMoneyInput(oldGold.weight),
        purity: oldGold.purity,
        rate: parseMoneyInput(oldGold.rate),
        value: oldGoldValue,
      } : null,
      old_silver: oldSilver.active ? {
        active: true,
        weight: parseMoneyInput(oldSilver.weight),
        purity: oldSilver.purity,
        rate: parseMoneyInput(oldSilver.rate),
        value: oldSilverValue,
      } : null,
    };
    return generateActiveEstimationPrintHTML(draftQuote, items, company, goldRate, purityRateMap, printConfig);
  }, [items, goldRate, purityRateMap, gstPct, discAmt, notes, customer, salesperson, company, editingQuoteNo, printConfig, oldGold, oldGoldValue, oldSilver, oldSilverValue]);

  // Preview panel geometry — the panel used to assume every estimation is
  // A5 (547x794px @ 0.55 scale). Thermal receipts render at roll width with
  // a content-driven height, so hardcoding A5 dimensions made the thermal
  // slip render tiny in a corner of an oversized, wrongly-scaled frame.
  const isThermalPreview = printConfig?.type === "thermal";
  const previewPageWpx = isThermalPreview
    ? Math.round(((printConfig.layout?.paper_width_mm || 80) / 25.4) * 96)
    : 547;
  const previewScale = isThermalPreview ? 1 : 0.55;
  const previewIframeH = isThermalPreview ? thermalPreviewH : 794;
  const previewBoxW = Math.round(previewPageWpx * previewScale);
  const previewBoxH = Math.round(previewIframeH * previewScale);

  // Print — opens a confirm-before-printer preview (same modal/UX as POS
  // Billing) instead of sending to the printer immediately. For a new
  // estimation, save first so the slip gets a real Est No before previewing.
  const confirmPrint = async () => {
    if (!previewHtml) return;
    setPrinting(true);
    try {
      await printHtml(previewHtml, { printerType: "estimation" });
      setPreviewHtml(null);
    } catch {
      /* printHtml already showed toast */
    } finally {
      setPrinting(false);
    }
  };

  const handlePrint = async (q = null, itms = null) => {
    const config = await loadEstimationPrintSettings().catch(() => printConfig);
    setPrintConfig(config);
    // History / already-saved quote: preview only, nothing to save
    if (q?.id) {
      const itemsToPrint = itms || asArray(q.items);
      if (!itemsToPrint.length) { toast.error("Add at least one item"); return; }
      setPreviewHtml(generateActiveEstimationPrintHTML(q, itemsToPrint, company, Number(q.gold_rate) || goldRate, purityRateMap, config));
      return;
    }

    if (!items.length) { toast.error("Add at least one item"); return; }
    setSaving(true);
    try {
      const saved = await persistQuote();
      toast.success(`Estimation ${saved.quote_no} saved`);
      setPreviewHtml(generateActiveEstimationPrintHTML(saved, items, company, goldRate, purityRateMap, config));
    } catch (err) {
      toast.error(formatApiError(err) || err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Builds the exact payload the backend expects — shared by Print, Save and WhatsApp
  const buildQuotePayload = () => {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + validDays);
    return {
      customer_id: customer?.id || null,
      customer_name: customer?.name || "Walk-in Customer",
      customer_mobile: customer?.mobile || "",
      customer_email: customer?.email || "",
      salesperson_id: salesperson?.id || null,
      salesperson_name: salesperson?.name || null,
      items, gold_rate: goldRate,
      gold_22k: rate22k != null ? rate22k : undefined,
      gold_18k: rate18k != null ? rate18k : undefined,
      silver_rate: silverRate != null ? silverRate : undefined,
      subtotal, discount: discAmt, discount_type: "flat",
      gst_pct: gstPct, gst_amount: gstAmt, grand_total: grandTotal,
      valid_until: validUntil.toISOString().slice(0, 10),
      notes,
      terms: "Price valid based on today's gold rate. Final billing rate may vary.",
      old_gold: oldGold.active ? {
        active: true,
        weight: parseMoneyInput(oldGold.weight),
        purity: oldGold.purity,
        rate: parseMoneyInput(oldGold.rate),
        value: oldGoldValue,
      } : null,
      old_silver: oldSilver.active ? {
        active: true,
        weight: parseMoneyInput(oldSilver.weight),
        purity: oldSilver.purity,
        rate: parseMoneyInput(oldSilver.rate),
        value: oldSilverValue,
      } : null,
    };
  };

  const persistQuote = async () => {
    if (!items.length) throw new Error("Add at least one item");
    // Tray lines: pieces and weight are entered independently — validate both
    // against available stock before saving (same rule as POS checkout).
    for (const it of items) {
      if (!it.is_tray) continue;
      const pieces = Number(it.tray_pieces_sold);
      const weight = Number(it.tray_weight_sold);
      if (!Number.isInteger(pieces) || pieces <= 0) {
        throw new Error(`${it.product_name}: enter a valid number of pieces`);
      }
      if (pieces > (it.tray_stock_qty || 0)) {
        throw new Error(`${it.product_name}: only ${it.tray_stock_qty} piece(s) available`);
      }
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`${it.product_name}: enter the weight sold`);
      }
      if (weight > (it.tray_total_weight || 0)) {
        throw new Error(`${it.product_name}: only ${formatWeight(it.tray_total_weight)}g available`);
      }
    }
    const payload = buildQuotePayload();
    let saved;
    if (editingQuoteId) {
      const { data } = await api.put(`/quotations/${editingQuoteId}`, payload);
      saved = data || { ...payload, id: editingQuoteId, quote_no: editingQuoteNo };
    } else {
      const { data } = await api.post("/quotations", { ...payload, created_by: "Sales Staff" });
      saved = data;
    }
    if (!saved?.quote_no) throw new Error("Saved but no estimation number returned");
    setEditingQuoteId(saved.id);
    setEditingQuoteNo(saved.quote_no);
    loadHistory();
    return saved;
  };

  const handleSave = async () => {
    if (!items.length) { toast.error("Add at least one item"); return; }
    setSaving(true);
    try {
      const saved = await persistQuote();
      toast.success(`Estimation ${saved.quote_no} saved`);
    } catch (err) {
      toast.error(formatApiError(err) || err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Send via WhatsApp — free Click-to-Chat only. Saves the quote first (so the
  // message carries a real quote number), then opens wa.me with the message
  // pre-filled; the user still has to press Send inside WhatsApp themselves.
  const sendViaWhatsApp = async () => {
    if (!items.length) return toast.error("Add at least one item");
    if (!customer) return toast.error("Select or add a customer with a valid mobile number first");
    if (!normalizeIndianMobile(customer.mobile)) {
      return toast.error("This customer doesn't have a valid Indian mobile number");
    }

    setSendingWhatsApp(true);
    try {
      const payload = buildQuotePayload();
      let quoteForMessage;
      if (editingQuoteId) {
        const { data } = await api.put(`/quotations/${editingQuoteId}`, payload);
        quoteForMessage = data || { ...payload, quote_no: editingQuoteNo };
        if (data?.status === "draft") {
          await api.put(`/quotations/${editingQuoteId}/status`, { status: "sent" }).catch(() => {});
        }
      } else {
        const { data } = await api.post("/quotations", { ...payload, created_by: "Sales Staff" });
        quoteForMessage = data;
        if (data?.id) {
          await api.put(`/quotations/${data.id}/status`, { status: "sent" }).catch(() => {});
        }
      }

      const itemsWithTotals = items.map(it => ({ ...it, lineTotal: lineTotal(it, goldRate, purityRateMap) }));
      const message = buildWhatsAppQuotationMessage({ quote: quoteForMessage, items: itemsWithTotals, company });
      const result = openWhatsAppChat(quoteForMessage.customer_mobile, message);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("Estimation saved — review and send the message in WhatsApp");
      }

      cancelEdit();
      setTab("history"); loadHistory();
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const filteredQuotes = sortByOccurredAtDesc(quotes.filter(q =>
    !histSearch || q.customer_name?.toLowerCase().includes(histSearch.toLowerCase()) || q.quote_no?.includes(histSearch)
  ));

  return (
    <div className={`${TRADE_PAGE_CLASS} max-w-[1200px]`}>

      <PageHeader
        title="Estimations"
        subtitle="Scan a barcode, add items, print the estimation — done."
        actions={
          <div className="flex items-center gap-1 border border-[#DCE3D6] rounded-[10px] overflow-hidden bg-[#FFFDF8] shadow-[0_1px_2px_rgba(35,58,43,0.04)]">
            {[["new","New Estimation"],["history","History"]].map(([t,lbl]) => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] ${tab === t ? "bg-[#244B39] text-white" : "text-[#6E786F] hover:text-[#244B39]"}`}>
                {lbl}
              </button>
            ))}
          </div>
        }
      />

      {testMode && <TestModeBanner className="mb-4" />}

      {/* ── NEW QUOTE ─────────────────────────────────────────────────── */}
      {tab === "new" && (
        <div className="space-y-4">
          {editingQuoteId && (
            <div className="flex items-center justify-between px-4 py-2.5 bg-[#FDFBF7] border border-[#EADFBF] rounded-[9px]">
              <div className="flex items-center gap-2 text-[13px] text-[#6F5720]">
                <Pencil size={14} strokeWidth={1.5} />
                Editing estimation <span className="font-mono font-medium">{editingQuoteNo}</span>
              </div>
              <button className="text-[12px] text-[#8A6D2F] hover:text-[#6F5720] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2C98C]" onClick={cancelEdit}>
                Cancel edit
              </button>
            </div>
          )}
          <LiveRatesBanner rates={liveRates} />

          <div className="grid grid-cols-[1fr_340px] gap-5">
            {/* Left: main form */}
            <div className="space-y-4">
              {/* Customer */}
              <div className="card">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[12px] font-semibold text-[#6E786F] uppercase tracking-wide">Customer (optional)</div>
                  {!customer && (
                    <button
                      type="button"
                      onClick={openNewCustomer}
                      className="flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-[8px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2C98C]"
                      style={{ borderColor: GOLD, color: GOLD }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#244B39"; e.currentTarget.style.color = "white"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#B49042"; }}
                    >
                      <UserPlus size={12} strokeWidth={1.5} /> New Customer
                    </button>
                  )}
                </div>
                {customer ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-[#244B39] text-white flex items-center justify-center text-[14px] font-bold">
                        {customer.name[0]}
                      </div>
                      <div>
                        <div className="text-[13px] font-semibold text-[#2F3A32]">{customer.name}</div>
                        <div className="text-[11px] text-[#6E786F]">{customer.mobile}</div>
                      </div>
                    </div>
                    <button onClick={() => { setCustomer(null); setCustSearch(""); }} className="text-[#6E786F] hover:text-red-500">
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D998F]" strokeWidth={1.5} />
                    <input
                      className="input pl-9"
                      placeholder="Search customer name or mobile…"
                      value={custSearch}
                      onChange={e => { setCustSearch(e.target.value); setShowCustDrop(true); }}
                      onFocus={() => setShowCustDrop(true)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && showCustDrop && custResults.length > 0) {
                          e.preventDefault();
                          setCustomer(custResults[0]);
                          setCustSearch("");
                          setShowCustDrop(false);
                        }
                      }}
                    />
                    {showCustDrop && custSearch.trim() && (
                      <div className="absolute top-full mt-1 w-full bg-white border border-[#DCE3D6] rounded-lg shadow-lg z-30 overflow-hidden">
                        {custResults.map(c => (
                          <button key={c.id} className="w-full text-left px-4 py-2.5 hover:bg-[#F1F4ED] flex items-center gap-3"
                            onClick={() => { setCustomer(c); setCustSearch(""); setShowCustDrop(false); }}>
                            <div className="h-7 w-7 rounded-full bg-[#E8EFE5] flex items-center justify-center text-[12px] font-bold text-[#526B59]">{c.name[0]}</div>
                            <div>
                              <div className="text-[13px] font-medium">{c.name}</div>
                              <div className="text-[11px] text-[#6E786F]">{c.mobile}</div>
                            </div>
                          </button>
                        ))}
                        {custSearched && custResults.length === 0 && (
                          <div className="px-4 py-3 text-[12px] text-[#6E786F]">
                            No customer found for "{custSearch}".
                          </div>
                        )}
                        <button
                          className="w-full text-left px-4 py-2.5 hover:bg-[#FDFBF7] flex items-center gap-2 text-[12.5px] font-medium text-[#B49042] border-t border-[#DCE3D6]"
                          onClick={openNewCustomer}
                        >
                          <UserPlus size={14} strokeWidth={1.5} /> Add "{custSearch}" as new customer
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Salesperson — same search + dropdown pattern as POS Billing */}
              <div className="card" ref={empDropRef}>
                <div className="text-[12px] font-semibold text-[#6E786F] uppercase tracking-wide mb-2">Sales Person</div>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D998F]" strokeWidth={1.5} />
                  <input
                    className="input pl-9 pr-8"
                    placeholder="Search salesperson…"
                    value={salesperson
                      ? `${salesperson.code || salesperson.employee_code ? `${salesperson.code || salesperson.employee_code} | ` : ""}${salesperson.name}`
                      : empSearch}
                    onChange={(e) => {
                      if (salesperson) setSalesperson(null);
                      setEmpSearch(e.target.value);
                      setEmpDropOpen(true);
                    }}
                    onFocus={() => {
                      if (salesperson) { setSalesperson(null); setEmpSearch(""); }
                      setEmpDropOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && empDropOpen && !salesperson && filteredEmployees.length > 0) {
                        e.preventDefault();
                        setSalesperson(filteredEmployees[0]);
                        setEmpDropOpen(false);
                        setEmpSearch("");
                      }
                      if (e.key === "Escape") setEmpDropOpen(false);
                    }}
                  />
                  {(salesperson || empSearch) && (
                    <button
                      type="button"
                      onClick={() => { setSalesperson(null); setEmpSearch(""); setEmpDropOpen(true); }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8D998F] hover:text-red-500"
                    >
                      <X size={13} strokeWidth={1.5} />
                    </button>
                  )}
                  {empDropOpen && (
                    <div className="absolute top-full mt-1 w-full bg-white border border-[#DCE3D6] rounded-lg shadow-lg z-30 overflow-hidden max-h-56 overflow-y-auto">
                      {employees.length === 0 ? (
                        <div className="px-4 py-3 text-[12px] text-[#6E786F]">No employees found — add staff under Employees</div>
                      ) : filteredEmployees.length === 0 ? (
                        <div className="px-4 py-3 text-[12px] text-[#6E786F]">No matching salesperson</div>
                      ) : (
                        filteredEmployees.map((emp) => (
                          <button
                            key={emp.id}
                            type="button"
                            className="w-full text-left px-4 py-2.5 hover:bg-[#F1F4ED] border-b border-[#F3F4F6] last:border-0"
                            onClick={() => { setSalesperson(emp); setEmpSearch(""); setEmpDropOpen(false); }}
                          >
                            <div className="text-[13px] font-medium text-[#2F3A32]">
                              {(emp.code || emp.employee_code) ? `${emp.code || emp.employee_code} | ` : ""}{emp.name}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Barcode scan / product search */}
              <div className="card">
                <div className="text-[12px] font-semibold text-[#6E786F] uppercase tracking-wide mb-2">Add Items</div>
                <div className="relative">
                  <ScanBarcode size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D998F]" strokeWidth={1.5} />
                  <input
                    ref={barcodeRef}
                    className="input pl-10 font-mono"
                    placeholder="Scan barcode or type product name / code…"
                    value={barcodeInput}
                    onChange={e => setBarcodeInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && prodResults.length > 0) {
                        e.preventDefault();
                        addProduct(prodResults[0]);
                        setBarcodeInput("");
                      }
                    }}
                    autoFocus
                  />
                  {showProdDrop && prodResults.length > 0 && (
                    <div className="absolute top-full mt-1 w-full bg-white border border-[#DCE3D6] rounded-lg shadow-lg z-30 overflow-hidden">
                      {prodResults.map(p => (
                        <button key={p.id} className="w-full text-left px-4 py-2.5 hover:bg-[#F1F4ED] flex items-center gap-3"
                          onClick={() => { addProduct(p); setBarcodeInput(""); }}>
                          <div className="h-8 w-8 bg-[#F1F4ED] rounded-[8px] border border-[#DCE3D6] flex items-center justify-center">
                            <Sparkles size={12} className="text-[#d4d4d8]" strokeWidth={1} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-medium text-[#2F3A32] truncate">{p.name}</div>
                            <div className="text-[11px] text-[#6E786F]">{p.code} · {p.purity_name} · {p.gross_weight}g gross</div>
                          </div>
                          <span className="text-[11px] font-mono text-[#8D998F]">{p.barcode}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-[#8D998F] mt-1.5">Press Enter to add first result, or click to select. Barcode auto-adds directly.</p>
              </div>

              {/* Items table */}
              {items.length > 0 && (
                <div className="table-shell">
                  <table className="w-full">
                    <thead>
                      <tr className="table-head-row">
                        <th className="table-th">Item</th>
                        <th className="table-th">Purity</th>
                        <th className="table-th text-right">Gross Wt</th>
                        <th className="table-th text-right">Net Wt</th>
                        <th className="table-th text-right">Rate (₹/g)</th>
                        <th className="table-th text-right">Amount</th>
                        <th className="table-th w-16"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(it => {
                        const total = lineTotal(it, goldRate, purityRateMap);
                        const amounts = lineAmounts(it, goldRate, purityRateMap);
                        const rate = resolveLineRate(it, goldRate, purityRateMap);
                        const isExpanded = expandedItem === it._id;
                        // Pricing is only editable when reopening a saved estimation from
                        // History — a brand-new estimation just uses the product as-is.
                        const canEditPricing = Boolean(editingQuoteId);
                        return (
                        <Fragment key={it._id}>
                          <tr className="table-row">
                            <td className="table-td">
                              <div className="text-[13px] font-medium text-[#2F3A32]">{it.product_name}</div>
                              <div className="text-[11px] text-[#6E786F]">{it.code}</div>
                              {it.is_tray && (
                                <div className="text-[10px] text-amber-700 font-medium mt-0.5">
                                  Tray · {it.tray_stock_qty} pcs · {formatWeight(it.tray_total_weight)}g avail
                                </div>
                              )}
                            </td>
                            <td className="table-td text-[12.5px]">{it.purity}</td>
                            {it.is_tray ? (
                              <>
                                <td className="table-td text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <button type="button" onClick={() => {
                                      const pieces = Math.max(1, (it.tray_pieces_sold || 1) - 1);
                                      updateItem(it._id, "tray_pieces_sold", pieces);
                                      updateItem(it._id, "qty", pieces);
                                    }} className="h-5 w-5 rounded border border-[#DCE3D6] text-[#5F6D62] hover:bg-[#F1F4ED] text-[12px] font-medium flex items-center justify-center">−</button>
                                    <input type="text" inputMode="decimal" min="1" step="1" max={it.tray_stock_qty}
                                      className="w-10 text-center border border-[#DCE3D6] rounded text-[11px] py-0.5 font-mono"
                                      value={it.tray_pieces_sold || 1}
                                      onChange={(e) => {
                                        const pieces = Math.max(1, Math.min(it.tray_stock_qty || 1, Math.round(Number(e.target.value)) || 1));
                                        updateItem(it._id, "tray_pieces_sold", pieces);
                                        updateItem(it._id, "qty", pieces);
                                      }} />
                                    <button type="button" onClick={() => {
                                      const pieces = Math.min(it.tray_stock_qty || 1, (it.tray_pieces_sold || 1) + 1);
                                      updateItem(it._id, "tray_pieces_sold", pieces);
                                      updateItem(it._id, "qty", pieces);
                                    }} className="h-5 w-5 rounded border border-[#DCE3D6] text-[#5F6D62] hover:bg-[#F1F4ED] text-[12px] font-medium flex items-center justify-center">+</button>
                                  </div>
                                </td>
                                <td className="table-td text-right">
                                  <input type="text" inputMode="decimal" min="0" step="0.001" max={it.tray_total_weight}
                                    className="w-20 text-right border border-amber-300 rounded text-[11px] py-0.5 font-mono bg-amber-50"
                                    value={it.tray_weight_input ?? String(it.tray_weight_sold ?? 0)}
                                    onChange={(e) => {
                                      const raw = sanitizeWeightDraft(e.target.value);
                                      const parsed = parseFloat(raw);
                                      updateItem(it._id, "tray_weight_input", raw);
                                      updateItem(it._id, "tray_weight_sold", Number.isFinite(parsed) ? parsed : 0);
                                    }}
                                    onBlur={(e) => {
                                      const parsed = parseFloat(e.target.value);
                                      const clamped = Math.max(0, Math.min(it.tray_total_weight || 0, Number.isFinite(parsed) ? parsed : 0));
                                      const normalized = parseFloat(clamped.toFixed(3));
                                      updateItem(it._id, "tray_weight_sold", normalized);
                                      updateItem(it._id, "tray_weight_input", String(normalized));
                                    }} />g
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="table-td text-right font-mono text-[12.5px]">{Number(it.gross_weight).toFixed(3)}g</td>
                                <td className="table-td text-right font-mono text-[12.5px]">{Number(it.net_weight).toFixed(3)}g</td>
                              </>
                            )}
                            <td className="table-td text-right font-mono text-[12.5px]">
                              {canEditPricing ? (
                                it.rate_override != null ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <MoneyInput
                                      className="w-16 text-right border rounded text-[11px] px-1 py-0 font-mono"
                                      style={{ borderColor: GOLD }}
                                      value={it.rate_override}
                                      onValueChange={(_, n) => updateItem(it._id, "rate_override", n)}
                                    />
                                    <button type="button" onClick={() => updateItem(it._id, "rate_override", null)}
                                      className="text-[#8D998F] hover:text-red-600" title="Reset to market rate">
                                      <X size={10} strokeWidth={1.5} />
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" className="flex items-center gap-1 hover:opacity-80 ml-auto" title="Override rate"
                                    onClick={() => updateItem(it._id, "rate_override", rate || 0)}>
                                    <span>{rate != null ? fmtINR(rate, { decimals: 0 }) : "—"}</span>
                                    <Pencil size={9} strokeWidth={1.5} className="text-[#8D998F]" />
                                  </button>
                                )
                              ) : (
                                <span>{rate != null ? fmtINR(rate, { decimals: 0 }) : "—"}</span>
                              )}
                            </td>
                            <td className="table-td text-right font-semibold text-[13px]">{fmtINR(total)}</td>
                            <td className="table-td">
                              <div className="flex items-center gap-1 justify-end">
                                {canEditPricing && (
                                  <button type="button" onClick={() => setExpandedItem(isExpanded ? null : it._id)}
                                    className="text-[#6E786F] hover:text-[#244B39] p-1" title="Edit pricing">
                                    <Pencil size={13} strokeWidth={1.5} />
                                  </button>
                                )}
                                <button onClick={() => removeItem(it._id)} className="text-[#6E786F] hover:text-red-500 p-1" title="Remove">
                                  <X size={13} strokeWidth={1.5} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded && canEditPricing && (
                            <tr>
                              <td colSpan={7} className="px-4 py-3 bg-[#F1F4ED] border-b border-[#DCE3D6]">
                                <div className="max-w-sm space-y-1.5">
                                  <BreakRow
                                    label={`Wastage (${it.wastage_pct}%)`}
                                    val={amounts.wastage_amount}
                                    editable
                                    onChange={(_, n) => patchItem(it._id, { wastage_amount_override: n })}
                                    overridden={it.wastage_amount_override != null}
                                    onReset={() => patchItem(it._id, { wastage_amount_override: null })}
                                  />
                                  <BreakRow
                                    label="Making charges"
                                    val={amounts.making_amount}
                                    editable
                                    onChange={(_, n) => patchItem(it._id, { making_amount_override: n })}
                                    overridden={it.making_amount_override != null}
                                    onReset={() => patchItem(it._id, { making_amount_override: null })}
                                  />
                                  <BreakRow
                                    label="Stone charges"
                                    labelAction={() => setStoneModalItemId(it._id)}
                                    val={amounts.stone_charges}
                                    editable
                                    onChange={(_, n) => updateItem(it._id, "stone_charges", n)}
                                  />
                                  <div className="border-t border-[#DCE3D6] pt-1 flex justify-between font-semibold text-[13px] text-[#2F3A32]">
                                    <span>Unit Price</span>
                                    <span>{fmtINR(amounts.unit_price)}</span>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {items.length === 0 && (
                <div className="text-center py-10 text-[#8D998F] text-[13px] border-2 border-dashed border-[#DCE3D6] rounded-lg">
                  <ScanBarcode size={28} className="mx-auto mb-2 text-[#d4d4d8]" strokeWidth={1} />
                  Scan a barcode or search a product above to add items
                </div>
              )}
            </div>

            {/* Right: live A5 preview + actions */}
            <div className="space-y-3 sticky top-24">

              {/* Live receipt preview card */}
              <div className="rounded-[10px] border border-[#DCE3D6] overflow-hidden bg-[#FFFDF8] shadow-[0_1px_2px_rgba(35,58,43,0.04)]">
                {/* Card header + print */}
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-[#F1F4ED] border-b border-[#DCE3D6]">
                  <div>
                    <span className="text-[11px] font-semibold text-[#6E786F] uppercase tracking-wide">Estimation Preview</span>
                    <span className="ml-2 text-[10px] text-[#8D998F] font-mono">
                      {isThermalPreview ? `${printConfig.layout?.paper_width_mm || 80}mm` : "A5"}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="btn-secondary !py-1.5 !px-3 text-[12px]"
                      onClick={handleSave}
                      disabled={!items.length || saving}
                    >
                      <Save size={13} strokeWidth={1.5} /> {saving ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      className="btn-primary !py-1.5 !px-3 text-[12px]"
                      onClick={() => handlePrint()}
                      disabled={!items.length || saving}
                    >
                      <Printer size={13} strokeWidth={1.5} /> Print
                    </button>
                  </div>
                </div>

                {/* Discount in preview panel */}
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-[#DCE3D6] bg-white">
                  <span className="text-[12.5px] text-[#5F6D62]">Discount ₹</span>
                  <MoneyInput
                    min={0}
                    className="input no-spinner w-28 text-right py-1.5 text-[12.5px]"
                    value={discount}
                    onValueChange={setDiscount}
                    placeholder="0"
                  />
                </div>

                {/* Old Metal Exchange calculator — informational only, never reduces the estimate total */}
                <div className="border-b border-[#DCE3D6] bg-white">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
                    onClick={() => {
                      const next = !oldGoldOpen;
                      setOldGoldOpen(next);
                      if (!next) setOldGold((g) => ({ ...g, active: false }));
                      else setOldGold((g) => ({ ...g, active: true }));
                    }}
                  >
                    <span className="text-[12.5px] text-[#5F6D62]">Old Gold Exchange</span>
                    <span className="text-[12.5px] font-medium tabular-nums" style={{ color: oldGoldValue > 0 ? "#8A6D2F" : "#8D998F" }}>
                      {oldGoldValue > 0 ? fmtINR(oldGoldValue) : (oldGoldOpen ? "Enter details" : "+ Add")}
                    </span>
                  </button>
                  {oldGoldOpen && (
                    <div className="px-4 pb-3 bg-[#FDFBF7] space-y-1.5">
                      <div className="flex gap-1.5">
                        <div className="flex-1">
                          <label className="text-[11px] text-[#8A6D2F] mb-0.5 block">Weight (g)</label>
                          <WeightInput placeholder="0.000" className="input !py-1 !text-[12px] font-mono w-full"
                            value={oldGold.weight} onValueChange={(raw) => setOldGold((g) => ({ ...g, weight: raw }))} />
                        </div>
                        <div className="flex-1">
                          <label className="text-[11px] text-[#8A6D2F] mb-0.5 block">Purity</label>
                          <input type="text" list="estimation-old-gold-purity" placeholder="e.g. 18.5K"
                            className="input !py-1 !text-[12px] w-full"
                            value={oldGold.purity} onChange={(e) => setOldGold((g) => ({ ...g, purity: e.target.value }))} />
                          <datalist id="estimation-old-gold-purity">
                            {OLD_GOLD_PURITY_SUGGESTIONS.map((k) => <option key={k} value={k} />)}
                          </datalist>
                        </div>
                        <div className="flex-1">
                          <label className="text-[11px] text-[#8A6D2F] mb-0.5 block">
                            {oldMetalManual.gold ? "Amount (₹)" : "Rate/g"}
                          </label>
                          <MoneyInput placeholder={oldMetalManual.gold ? "0.00" : goldRate} className="input !py-1 !text-[12px] font-mono w-full"
                            value={oldGold.rate} onValueChange={(raw) => setOldGold((g) => ({ ...g, rate: raw }))} />
                        </div>
                      </div>
                      {oldGoldValue > 0 && (
                        <div className="flex justify-between text-[11.5px] font-semibold text-amber-700">
                          <span>Calculated Value</span><span>{fmtINR(oldGoldValue)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="border-b border-[#DCE3D6] bg-white">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
                    onClick={() => {
                      const next = !oldSilverOpen;
                      setOldSilverOpen(next);
                      if (!next) setOldSilver((g) => ({ ...g, active: false }));
                      else setOldSilver((g) => ({ ...g, active: true }));
                    }}
                  >
                    <span className="text-[12.5px] text-[#5F6D62]">Old Silver Exchange</span>
                    <span className="text-[12.5px] font-medium tabular-nums" style={{ color: oldSilverValue > 0 ? "#526B59" : "#8D998F" }}>
                      {oldSilverValue > 0 ? fmtINR(oldSilverValue) : (oldSilverOpen ? "Enter details" : "+ Add")}
                    </span>
                  </button>
                  {oldSilverOpen && (
                    <div className="px-4 pb-3 bg-[#F1F4ED] space-y-1.5">
                      <div className="flex gap-1.5">
                        <div className="flex-1">
                          <label className="text-[11px] text-[#6E786F] mb-0.5 block">Weight (g)</label>
                          <WeightInput placeholder="0.000" className="input !py-1 !text-[12px] font-mono w-full"
                            value={oldSilver.weight} onValueChange={(raw) => setOldSilver((g) => ({ ...g, weight: raw }))} />
                        </div>
                        <div className="flex-1">
                          <label className="text-[11px] text-[#6E786F] mb-0.5 block">Purity</label>
                          <input type="text" list="estimation-old-silver-purity" placeholder="e.g. 925"
                            className="input !py-1 !text-[12px] w-full"
                            value={oldSilver.purity} onChange={(e) => setOldSilver((g) => ({ ...g, purity: e.target.value }))} />
                          <datalist id="estimation-old-silver-purity">
                            {OLD_SILVER_PURITY_SUGGESTIONS.map((k) => <option key={k} value={k} />)}
                          </datalist>
                        </div>
                        <div className="flex-1">
                          <label className="text-[11px] text-[#6E786F] mb-0.5 block">
                            {oldMetalManual.silver ? "Amount (₹)" : "Rate/g"}
                          </label>
                          <MoneyInput placeholder={oldMetalManual.silver ? "0.00" : silverRate} className="input !py-1 !text-[12px] font-mono w-full"
                            value={oldSilver.rate} onValueChange={(raw) => setOldSilver((g) => ({ ...g, rate: raw }))} />
                        </div>
                      </div>
                      {oldSilverValue > 0 && (
                        <div className="flex justify-between text-[11.5px] font-semibold text-[#526B59]">
                          <span>Calculated Value</span><span>{fmtINR(oldSilverValue)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Scrollable paper-strip area */}
                <div className="bg-[#E4E8E0] flex justify-center py-4 px-3" style={{ maxHeight: 520, overflowY: "auto" }}>
                  <div className="bg-white shadow-[0_8px_20px_rgba(35,58,43,0.14)] overflow-hidden" style={{ width: previewBoxW, height: previewBoxH }}>
                    <iframe
                      key={livePreviewHtml}
                      srcDoc={livePreviewHtml}
                      title="Live Estimation Preview"
                      scrolling="no"
                      style={{
                        width: previewPageWpx,
                        height: previewIframeH,
                        border: "none",
                        display: "block",
                        transform: `scale(${previewScale})`,
                        transformOrigin: "top left",
                      }}
                      onLoad={isThermalPreview ? (e) => {
                        try {
                          const doc = e.currentTarget.contentDocument;
                          const h = Math.max(
                            doc?.body?.scrollHeight || 0,
                            doc?.documentElement?.scrollHeight || 0,
                            200,
                          );
                          setThermalPreviewH(h);
                        } catch {
                          setThermalPreviewH(400);
                        }
                      } : undefined}
                    />
                  </div>
                </div>
              </div>

              {/* Compact totals + save actions */}
              <div className="card space-y-3">
                <div className="space-y-1.5 text-[13px]">
                  <div className="flex justify-between text-[#5F6D62]">
                    <span>Subtotal</span><span>{fmtINR(subtotal)}</span>
                  </div>
                  {Number(discAmt) > 0 && (
                    <div className="flex justify-between text-[#5F6D62]">
                      <span>Discount</span><span className="text-green-700">− {fmtINR(discAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[15px] font-bold text-[#2F3A32] border-t border-[#DCE3D6] pt-2">
                    <span>Grand Total</span><span>{fmtINR(grandTotal)}</span>
                  </div>
                </div>

                <div>
                  <label className="label">Valid for</label>
                  <select className="input text-[12px]" value={validDays} onChange={e => setValidDays(Number(e.target.value))}>
                    {[1,3,7,15,30].map(n => <option key={n} value={n}>{n} day{n>1?"s":""}</option>)}
                  </select>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    className="w-full justify-center text-[12.5px] font-medium rounded-[9px] py-2.5 flex items-center gap-1.5 bg-[#244B39] text-white hover:bg-[#1D3B2E] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9] transition-colors"
                    onClick={sendViaWhatsApp}
                    disabled={sendingWhatsApp || !items.length || !customer}
                    title={!customer ? "Select or add a customer first" : "Send via WhatsApp"}
                  >
                    <MessageCircle size={14} strokeWidth={1.5} /> {sendingWhatsApp ? "Sending…" : "Send via WhatsApp"}
                  </button>
                  {editingQuoteNo && (
                    <div className="text-center text-[11px] text-[#6E786F] pt-1">
                      Est No: <span className="font-mono font-semibold text-[#2F3A32]">{editingQuoteNo}</span>
                      <span className="block text-[10px] mt-0.5">Enter this number in POS to load the bill</span>
                    </div>
                  )}
                  <p className="text-center text-[10.5px] text-[#8D998F] pt-0.5">
                    Save stores the estimation. Print saves and prints the detailed A5 slip.
                  </p>
                  <button
                    type="button"
                    className="w-full text-[11px] text-[#B49042] hover:underline pt-0.5"
                    onClick={() => navigate("/pos")}
                  >
                    Open POS to load estimation →
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── HISTORY ──────────────────────────────────────────────────── */}
      {tab === "history" && (
        <div>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-md">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8D998F]" strokeWidth={1.5} />
              <input className="input pl-9" placeholder="Search customer or quote number…" value={histSearch} onChange={e => setHistSearch(e.target.value)} />
            </div>
            <button className="btn-secondary" onClick={loadHistory}><RefreshCw size={14} strokeWidth={1.5} /></button>
            <button className="btn-primary" onClick={() => { cancelEdit(); setTab("new"); }}><Plus size={14} strokeWidth={1.5} /> New Estimation</button>
          </div>
          {histLoading ? (
            <div className="space-y-4">
              <PageLoadingBadge />
              <TableSkeleton rows={6} cols={6} />
            </div>
          ) : (
            <PastQuotes
              quotes={filteredQuotes}
              onEdit={editQuote}
              onBook={(q) => {
                setBookingQuote(q);
              }}
              onAddAdvance={(q) => {
                setAddAdvanceQuote(q);
              }}
              onPrint={(q) => handlePrint(q, asArray(q.items))}
              onCancel={cancelBooking}
              onDelete={deleteQuote}
            />
          )}
        </div>
      )}

      {bookingQuote && (
        <BookAdvanceModal
          quote={bookingQuote}
          onClose={() => setBookingQuote(null)}
          onDone={() => { setBookingQuote(null); loadHistory(); }}
        />
      )}

      {addAdvanceQuote && (
        <AddAdvanceModal
          quote={addAdvanceQuote}
          onClose={() => setAddAdvanceQuote(null)}
          onDone={() => { setAddAdvanceQuote(null); loadHistory(); }}
        />
      )}

      <DuplicateCustomerDialog
        info={dupCustomer}
        viewing={dupViewing}
        creating={newCustSaving}
        onClose={() => setDupCustomer(null)}
        onViewCustomer={useExistingCustomer}
        onCreateAnyway={
          dupCustomer?.code === "DUPLICATE_MOBILE"
            ? () => { setDupCustomer(null); saveNewCustomer(null, { force: true }); }
            : undefined
        }
      />

      {/* New customer — same left drawer as POS Billing */}
      {newCustOpen && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="absolute inset-0 bg-[#20352A]/35 backdrop-blur-[2px]" onClick={() => !newCustSaving && setNewCustOpen(false)} />
          <aside
            className="relative h-full w-full max-w-[380px] bg-[#FFFDF8] shadow-[0_18px_50px_rgba(35,58,43,0.18)] border-r border-[#DCE3D6] flex flex-col animate-in slide-in-from-left duration-200"
            style={{ animation: "quoteCustSlide 180ms ease-out" }}
          >
            <style>{`@keyframes quoteCustSlide { from { transform: translateX(-100%); } to { transform: translateX(0); } }`}</style>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#DCE3D6] flex-shrink-0">
              <div>
                <div className="text-[14px] font-semibold text-[#2F3A32]">New Customer</div>
                <div className="text-[11px] text-[#8A857C]">Saved to list and selected for this quote</div>
              </div>
              <button
                type="button"
                disabled={newCustSaving}
                onClick={() => setNewCustOpen(false)}
                className="h-8 w-8 rounded-[8px] border border-[#DCE3D6] flex items-center justify-center text-[#8A857C] hover:border-[#66806B] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
              >
                <X size={15} strokeWidth={1.5} />
              </button>
            </div>
            <form onSubmit={saveNewCustomer} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              <label className="block">
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Name <span style={{ color: GOLD }}>*</span></span>
                <input
                  autoFocus
                  required
                  className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] outline-none focus:border-[#66806B]"
                  value={newCustForm.name}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Customer name"
                />
              </label>
              <label className="block">
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Mobile <span style={{ color: GOLD }}>*</span></span>
                <input
                  required
                  className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] font-mono outline-none focus:border-[#66806B]"
                  value={newCustForm.mobile}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, mobile: e.target.value }))}
                  placeholder="10-digit mobile"
                />
              </label>
              <label className="block">
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Email</span>
                <input
                  type="email"
                  className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] outline-none focus:border-[#66806B]"
                  value={newCustForm.email}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="optional"
                />
              </label>
              <label className="block">
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Address</span>
                <textarea
                  rows={3}
                  className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] resize-none outline-none focus:border-[#66806B]"
                  value={newCustForm.address}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Full address"
                />
              </label>
              <label className="block">
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">PAN Number</span>
                <input
                  className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] font-mono uppercase outline-none focus:border-[#66806B]"
                  value={newCustForm.pan_number}
                  maxLength={10}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, pan_number: e.target.value.toUpperCase() }))}
                  placeholder="ABCDE1234F"
                />
              </label>
              <label className="block">
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Aadhaar Number</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] font-mono outline-none focus:border-[#66806B]"
                  value={newCustForm.aadhaar_number}
                  maxLength={12}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, aadhaar_number: e.target.value.replace(/\D/g, "").slice(0, 12) }))}
                  placeholder="123456789012"
                />
              </label>

              {/* PAN card image */}
              <div>
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">PAN Card Image</span>
                <input
                  ref={panGalleryRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPanImagePicked}
                />
                <input
                  ref={panCameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onPanImagePicked}
                />
                <button
                  type="button"
                  onClick={() => setPanSourceOpen(true)}
                  className="mt-1 w-full relative rounded-[10px] border border-dashed border-[#C8D4C7] bg-[#F7F8F2] hover:border-[#B49042] transition-colors overflow-hidden"
                  style={{ minHeight: 140 }}
                >
                  {newCustForm.pan_image ? (
                    <>
                      <img src={newCustForm.pan_image} alt="PAN card" className="w-full h-40 object-cover" />
                      <span className="absolute bottom-2 left-2 right-2 text-[11px] text-white bg-[#20352A]/75 rounded px-2 py-1 text-center">
                        Tap to change photo
                      </span>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-[#8A857C]">
                      <Camera size={22} strokeWidth={1.5} style={{ color: GOLD }} />
                      <div className="text-[12.5px] font-medium text-[#2F3A32]">Add PAN card photo</div>
                      <div className="text-[11px]">Camera or gallery</div>
                    </div>
                  )}
                </button>
                {newCustForm.pan_image && (
                  <button
                    type="button"
                    className="mt-1.5 text-[11.5px] text-[#C45C5C] hover:underline"
                    onClick={() => setNewCustForm((f) => ({ ...f, pan_image: "" }))}
                  >
                    Remove image
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Date of Birth</span>
                  <input
                    type="date"
                    className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] outline-none focus:border-[#66806B]"
                    value={newCustForm.dob}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setNewCustForm((f) => ({ ...f, dob: e.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Anniversary</span>
                  <input
                    type="date"
                    className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] outline-none focus:border-[#66806B]"
                    value={newCustForm.anniversary}
                    onChange={(e) => setNewCustForm((f) => ({ ...f, anniversary: e.target.value }))}
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-[12px] uppercase tracking-wide text-[#6E786F]">Tag</span>
                <select
                  className="mt-1 w-full border border-[#C8D4C7] rounded-[9px] px-2.5 py-2 text-[13px] outline-none focus:border-[#66806B] bg-white"
                  value={newCustForm.tag}
                  onChange={(e) => setNewCustForm((f) => ({ ...f, tag: e.target.value }))}
                >
                  <option value="regular">Regular</option>
                  <option value="vip">VIP</option>
                  <option value="wholesale">Wholesale</option>
                </select>
              </label>
            </form>
            <div className="flex-shrink-0 flex gap-2 px-4 py-3 border-t border-[#DCE3D6] bg-[#F7F8F2]">
              <button
                type="button"
                disabled={newCustSaving}
                onClick={() => { setPanSourceOpen(false); setNewCustOpen(false); }}
                className="flex-1 py-2 rounded-[9px] border border-[#DCE3D6] text-[13px] text-[#5F6D62] hover:border-[#66806B] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={newCustSaving}
                onClick={saveNewCustomer}
                className="flex-1 py-2 rounded-md text-[13px] font-semibold text-white disabled:opacity-60"
                style={{ background: "#244B39" }}
              >
                {newCustSaving ? "Saving…" : "Save Customer"}
              </button>
            </div>
          </aside>

          {/* Camera / Gallery chooser */}
          {panSourceOpen && (
            <div className="absolute inset-0 z-[70] flex items-end sm:items-center justify-center p-4">
              <div className="absolute inset-0 bg-[#20352A]/35 backdrop-blur-[2px]" onClick={() => setPanSourceOpen(false)} />
              <div className="relative w-full max-w-sm bg-[#FFFDF8] rounded-[12px] border border-[#DCE3D6] shadow-[0_18px_50px_rgba(35,58,43,0.18)] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#DCE3D6]">
                  <div className="text-[14px] font-semibold text-[#2F3A32]">Add PAN card image</div>
                  <div className="text-[11.5px] text-[#8A857C]">Choose camera or gallery</div>
                </div>
                <div className="p-3 space-y-2">
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-[10px] border border-[#DCE3D6] hover:border-[#AFC2AE] hover:bg-[#F1F4ED] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
                    onClick={() => panCameraRef.current?.click()}
                  >
                    <span className="h-9 w-9 rounded-full flex items-center justify-center" style={{ background: "#F1F4ED" }}>
                      <Camera size={16} style={{ color: GOLD }} strokeWidth={1.6} />
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium text-[#2F3A32]">Camera</span>
                      <span className="block text-[11px] text-[#8A857C]">Take a new photo</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-[10px] border border-[#DCE3D6] hover:border-[#AFC2AE] hover:bg-[#F1F4ED] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
                    onClick={() => panGalleryRef.current?.click()}
                  >
                    <span className="h-9 w-9 rounded-full flex items-center justify-center" style={{ background: "#F1F4ED" }}>
                      <ImageIcon size={16} style={{ color: GOLD }} strokeWidth={1.6} />
                    </span>
                    <span>
                      <span className="block text-[13px] font-medium text-[#2F3A32]">Gallery</span>
                      <span className="block text-[11px] text-[#8A857C]">Pick from photos</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="w-full py-2.5 text-[13px] text-[#6E786F] hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]"
                    onClick={() => setPanSourceOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      {confirmModal}
      <StockAlertDialog
        open={stockAlert.open}
        title={stockAlert.title}
        message={stockAlert.message}
        onClose={() => setStockAlert((s) => ({ ...s, open: false }))}
      />
      {stoneModalItemId != null && items.find((x) => x._id === stoneModalItemId) && (
        <StoneDetailsModal
          item={items.find((x) => x._id === stoneModalItemId)}
          accentColor={GOLD}
          onClose={() => setStoneModalItemId(null)}
          onChangePrice={(stoneIdx, amount) => updateStonePrice(stoneModalItemId, stoneIdx, amount)}
        />
      )}
      {previewHtml && (
        <PrintPreviewModal
          html={previewHtml}
          title="Estimation Preview"
          onPrint={confirmPrint}
          onClose={() => setPreviewHtml(null)}
          printing={printing}
        />
      )}
    </div>
  );
}
