import { useEffect, useRef } from "react";
import { ShieldAlert } from "lucide-react";

/**
 * Blocking prompt when POS / Estimation is attempted before Accounts opening setup.
 */
export default function AccountsSetupRequiredDialog({
  open,
  title = "Accounts Setup Required",
  message,
  onClose,
  onGoToSetup,
}) {
  const actionRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => actionRef.current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <ShieldAlert size={20} className="text-amber-700" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-[#0A0A0A]">{title}</div>
            <div className="mt-1 text-[13px] leading-5 text-[#525252] whitespace-pre-line">{message}</div>
          </div>
        </div>
        <div className="flex gap-2 border-t border-[#E5E7EB] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-[#E5E7EB] py-2 text-[13px] font-medium text-[#525252] hover:bg-[#FAFAFA]"
          >
            Cancel
          </button>
          <button
            ref={actionRef}
            type="button"
            onClick={onGoToSetup}
            className="flex-1 rounded-md bg-[#171A17] py-2 text-[13px] font-semibold text-white hover:bg-black"
          >
            Complete Accounts Setup
          </button>
        </div>
      </div>
    </div>
  );
}
