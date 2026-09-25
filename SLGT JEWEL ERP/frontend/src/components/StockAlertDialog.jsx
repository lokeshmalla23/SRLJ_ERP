import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * Blocking "can't add this" popup for POS/Estimation — shown (with a sound,
 * see @/lib/stockAlert) when adding a product would exceed what's actually
 * in stock, e.g. only 1 piece available and it's already on the bill.
 */
export default function StockAlertDialog({ open, title = "Out of Stock", message, onClose }) {
  const okRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => okRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); onClose?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="px-5 py-4 flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={20} className="text-red-600" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#0A0A0A]">{title}</div>
            <div className="text-[13px] text-[#525252] mt-1 whitespace-pre-line">{message}</div>
          </div>
        </div>
        <div className="px-5 py-3.5 border-t border-[#E5E7EB]">
          <button
            ref={okRef}
            type="button"
            onClick={onClose}
            className="w-full py-2 rounded-md bg-[#0A0A0A] text-white text-[13px] font-semibold hover:bg-[#262626]"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
