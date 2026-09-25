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
        <button type="button" onClick={labelAction} className="text-[#6E786F] underline decoration-dotted hover:text-[#244B39] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B8CBB9]">
          {label}
        </button>
      ) : (
        <span className="text-[#6E786F]">{label}</span>
      )}
      {editable ? (
        <div className="flex items-center gap-1">
          <MoneyInput className="w-16 text-right border border-[#C8D4C7] rounded-[7px] text-[11px] px-1 py-0 font-mono focus:border-[#66806B]"
            value={val} onValueChange={(raw, number) => onChange?.(raw, number)} />
          {overridden && (
            <button type="button" onClick={onReset} className="text-[#8A857C] hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E8B5B2]" title="Reset to computed value">
              <X size={10} strokeWidth={1.5} />
            </button>
          )}
        </div>
      ) : (
        <span className="text-[#2F3A32] font-mono tabular-nums">{fmtINR(val)}</span>
      )}
    </div>
  );
}
