import { useEffect, useRef } from "react";

/**
 * In-app confirm modal — replaces window.confirm().
 *
 * Electron's native window.confirm()/alert() runs as a blocking Chromium
 * dialog inside the renderer; after it closes, the window can be left in a
 * state where clicks land but nothing focuses (no cursor, no text
 * selection) until the OS window loses and regains focus. Routing
 * confirmations through this component avoids that dialog entirely.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => (danger ? cancelRef : confirmRef).current?.focus(), 30);
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel?.(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [open, danger, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
        {title && (
          <div className="px-5 py-3.5 border-b border-[#E5E7EB]">
            <div className="text-[14px] font-semibold text-[#0A0A0A]">{title}</div>
          </div>
        )}
        <div className="px-5 py-4 text-[13px] text-[#404040] whitespace-pre-line">{message}</div>
        <div className="flex gap-2 px-5 py-3.5 border-t border-[#E5E7EB]">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="flex-1 py-2 rounded-md border border-[#E5E7EB] text-[13px] font-medium text-[#525252] hover:border-[#0A0A0A] disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`flex-1 py-2 rounded-md text-[13px] font-semibold text-white disabled:opacity-60 ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-[#0A0A0A] hover:bg-[#262626]"
            }`}
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
