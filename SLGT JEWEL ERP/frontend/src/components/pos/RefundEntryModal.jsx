import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { fmtINR } from "@/lib/format";

const MODE_LABELS = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  old_gold_exchange: "Old Gold",
  old_silver_exchange: "Old Silver",
};

const REFUND_MODES = ["cash", "upi", "card", "bank_transfer", "cheque"];

/**
 * Asks how a refund is being physically handed back to the customer before a
 * cancel/return is allowed to proceed. Entered amounts must sum to exactly
 * `totalDue` (the amount actually collected on the invoice/returned lines).
 * `lockedRows` ([{ mode, amount }]) are fixed, non-editable portions — e.g. old
 * gold / silver taken in exchange, which goes back as metal, not cash.
 */
export default function RefundEntryModal({
  open,
  title = "Refund to customer",
  totalDue = 0,
  lockedRows = [],
  busy = false,
  onCancel,
  onConfirm,
}) {
  const [amounts, setAmounts] = useState({});

  const locked = (lockedRows || []).filter((r) => Number(r?.amount) > 0);
  const lockedTotal = locked.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const entered = useMemo(
    () => Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0),
    [amounts],
  ) + lockedTotal;
  const remaining = Math.round((totalDue - entered) * 100) / 100;
  const matches = Math.abs(remaining) < 0.5;

  if (!open) return null;

  const submit = () => {
    if (!matches) return;
    const refund = REFUND_MODES
      .map((mode) => ({ mode, amount: Number(amounts[mode]) || 0 }))
      .filter((r) => r.amount > 0);
    onConfirm?.([...refund, ...locked.map((r) => ({ mode: r.mode, amount: Number(r.amount) }))]);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        <div className="px-5 py-4 border-b" style={{ borderColor: "#E5E7EB" }}>
          <div className="font-semibold text-sm">{title}</div>
          <div className="text-[12px] text-[#737373] mt-0.5">
            ₹{fmtINR(totalDue)} was collected on this invoice — enter how it's being refunded.
          </div>
        </div>
        <div className="px-5 py-4 space-y-2.5">
          {locked.map((r) => (
            <div key={r.mode} className="flex items-center gap-3">
              <label className="text-[13px] text-[#374151] w-28 flex-shrink-0">
                {MODE_LABELS[r.mode] || r.mode}
                <span className="block text-[11px] text-[#737373]">Metal returned</span>
              </label>
              <input
                type="text"
                className="input flex-1 text-right bg-[#F3F4F6] cursor-not-allowed"
                value={fmtINR(r.amount)}
                readOnly
                disabled
              />
            </div>
          ))}
          {locked.length > 0 && (
            <div className="text-[11.5px] text-[#737373] pb-1">
              Old metal goes back to the customer — it is not taken from the cash drawer.
              Enter only the money refund below.
            </div>
          )}
          {REFUND_MODES.map((mode) => (
            <div key={mode} className="flex items-center gap-3">
              <label className="text-[13px] text-[#374151] w-28 flex-shrink-0">{MODE_LABELS[mode]}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="input flex-1 text-right"
                placeholder="0.00"
                value={amounts[mode] ?? ""}
                onChange={(e) => setAmounts((a) => ({ ...a, [mode]: e.target.value }))}
              />
            </div>
          ))}
          <div className={`text-[12.5px] pt-1 ${matches ? "text-green-600" : "text-red-600"} font-medium`}>
            {matches
              ? `Matches total — ${fmtINR(entered)}`
              : remaining > 0
                ? `₹${fmtINR(remaining)} still remaining`
                : `₹${fmtINR(Math.abs(remaining))} over the collected amount`}
          </div>
        </div>
        <div className="px-5 py-4 border-t flex gap-2" style={{ borderColor: "#E5E7EB" }}>
          <button type="button" className="btn-secondary flex-1" disabled={busy} onClick={onCancel}>
            Back
          </button>
          <button
            type="button"
            className="btn-primary flex-1 inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            disabled={busy || !matches}
            onClick={submit}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : null}
            Confirm refund
          </button>
        </div>
      </div>
    </div>
  );
}
