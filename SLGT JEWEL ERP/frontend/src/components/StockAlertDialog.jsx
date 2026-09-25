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
      className="dialog-overlay fixed inset-0 z-[95] flex items-center justify-center p-4 backdrop-blur-[2px]"
      style={{ background: "rgba(23, 32, 28, 0.46)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#E2E7E2] bg-[#FFFDF9] shadow-float">
        <div className="flex items-start gap-3.5 border-b border-[#E2E7E2] bg-[linear-gradient(90deg,rgba(249,236,234,0.92),rgba(255,253,249,0.98)_58%)] px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#E8C9C5] bg-[#F9ECEA]">
            <AlertTriangle size={20} className="text-[#9D4B47]" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#17201C]">{title}</div>
            <div className="mt-1.5 whitespace-pre-line text-[13px] leading-5 text-[#6F7772]">{message}</div>
          </div>
        </div>
        <div className="border-t border-[#E2E7E2] bg-[#F7F9F6] px-5 py-3.5">
          <button
            ref={okRef}
            type="button"
            onClick={onClose}
            className="btn-primary min-h-9 w-full focus-visible:ring-2 focus-visible:ring-[#214F3A]/25 focus-visible:ring-offset-2"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
