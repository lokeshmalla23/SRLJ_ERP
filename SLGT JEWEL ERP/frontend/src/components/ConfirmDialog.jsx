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
      className="dialog-overlay fixed inset-0 z-[90] flex items-center justify-center p-4 backdrop-blur-[2px]"
      style={{ background: "rgba(23, 32, 28, 0.46)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#E2E7E2] bg-[#FFFDF9] shadow-float">
        {title && (
          <div className="border-b border-[#E2E7E2] bg-[#FAF7EF] px-5 py-3.5">
            <div className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#17201C]">{title}</div>
          </div>
        )}
        <div className="whitespace-pre-line bg-[#FFFDF9] px-5 py-4 text-[13px] leading-5 text-[#4F5A54]">{message}</div>
        <div className="flex gap-2.5 border-t border-[#E2E7E2] bg-[#F7F9F6] px-5 py-3.5">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="btn-secondary min-h-9 flex-1 px-3 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:ring-2 focus-visible:ring-[#214F3A]/25 focus-visible:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`min-h-9 flex-1 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:ring-2 focus-visible:ring-offset-2 ${
              danger
                ? "btn-danger focus-visible:ring-[#9D4B47]/25"
                : "btn-primary focus-visible:ring-[#214F3A]/25"
            }`}
          >
            {busy ? "Please wait…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
