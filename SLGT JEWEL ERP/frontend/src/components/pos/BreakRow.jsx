import { X } from "lucide-react";
import MoneyInput from "@/components/ui/MoneyInput";
import { fmtINR } from "@/lib/format";

/**
 * One editable/read-only breakdown line inside a cart item's expanded panel
 * (Wastage, Making charges, Stone charges, Unit Price). Shared by POS Billing
 * and Estimation editing so both reuse the exact same override UI/behavior.
 */
export default function BreakRow({ label, labelAction, val, editable, onChange, overridden, onReset }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      {labelAction ? (
        <button type="button" onClick={labelAction} className="text-[#737373] underline decoration-dotted hover:text-[#0A0A0A]">
          {label}
        </button>
      ) : (
        <span className="text-[#737373]">{label}</span>
      )}
      {editable ? (
        <div className="flex items-center gap-1">
          <MoneyInput className="w-16 text-right border border-[#E5E7EB] rounded text-[11px] px-1 py-0 font-mono"
            value={val} onValueChange={(raw, number) => onChange?.(raw, number)} />
          {overridden && (
            <button type="button" onClick={onReset} className="text-[#8A857C] hover:text-red-600" title="Reset to computed value">
              <X size={10} strokeWidth={1.5} />
            </button>
          )}
        </div>
      ) : (
        <span className="text-[#0A0A0A] font-mono tabular-nums">{fmtINR(val)}</span>
      )}
    </div>
  );
}
