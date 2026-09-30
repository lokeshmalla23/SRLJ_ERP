import { useEffect, useMemo, useState } from "react";
import { X, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { openWhatsAppChat } from "@/lib/whatsapp.js";
import { normalizeIndianMobile } from "@/lib/phone.js";

/** Read the designed page width off the generator's own @page size (same source the desktop print pipeline reads) — avoids a scroll-measurement guess that can drift from the real page. */
function pageWidthPx(html) {
  const src = String(html || "");
  const inches = Number(src.match(/data-page-w-in="([\d.]+)"/)?.[1]);
  if (Number.isFinite(inches) && inches > 0) return Math.round(inches * 96);
  // Thermal receipt layouts declare width in mm (58/80mm roll), not inches —
  // falling through to the 420px default here made every thermal preview
  // render in a frame roughly double the real receipt width, with the actual
  // narrow content floating inside it (and, if any row's content genuinely
  // didn't fit, a scrollbar on top of that mismatch).
  const mm = Number(src.match(/data-paper-width-mm="([\d.]+)"/)?.[1]);
  if (Number.isFinite(mm) && mm > 0) return Math.round((mm / 25.4) * 96);
  return 420;
}

/**
 * Generic "confirm before sending to printer" modal — an iframe sized to the
 * exact designed page width (matching the Settings layout editor and the
 * desktop print pipeline) rendering the exact HTML that will print, on a
 * gray backdrop like a sheet of paper on a desk, with Cancel/Print actions.
 * Originally POS Billing's invoice preview; shared here so any print flow
 * (POS, Estimation, ...) gets the same confirm-before-print step instead of
 * printing immediately.
 */
export default function PrintPreviewModal({ html, title = "Print Preview", subtitle, onPrint, onClose, printing, customerMobile }) {
  const frameWidth = useMemo(() => pageWidthPx(html), [html]);
  const [waBusy, setWaBusy] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleWhatsApp = async () => {
    setWaBusy(true);
    try {
      if (window.jewelleryCRM?.copyInvoiceImage) {
        const copied = await window.jewelleryCRM.copyInvoiceImage(html);
        if (copied?.success) {
          const mobile = customerMobile || "";
          if (normalizeIndianMobile(mobile)) {
            const chat = openWhatsAppChat(mobile, "Scheme document");
            if (!chat.ok) {
              toast.error("Could not open WhatsApp chat");
            } else {
              toast.success("Image copied — paste in WhatsApp (Ctrl+V)");
            }
          } else {
            toast.success("Image copied to clipboard — paste anywhere (Ctrl+V)");
          }
          return;
        }
      }
      toast.error("Could not copy image to clipboard");
    } catch {
      toast.error("Could not copy image to clipboard");
    } finally {
      setWaBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-[920px] max-h-[92vh]">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#E5E7EB]">
          <div>
            <p className="text-[14px] font-semibold">{title}</p>
            <p className="text-[11px] text-[#737373]">
              {printing ? "Sending to printer…" : (subtitle || "Check before sending to printer")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 text-[#737373]">
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto bg-[#D9D9D9] p-5">
          <div
            className="mx-auto bg-white shadow-md"
            style={{ width: `${frameWidth}px` }}
          >
            <iframe
              key={html}
              srcDoc={html}
              title={title}
              scrolling="no"
              style={{
                width: `${frameWidth}px`,
                minHeight: 500,
                border: "none",
                display: "block",
              }}
              onLoad={(e) => {
                try {
                  const doc = e.currentTarget.contentDocument;
                  if (!doc?.body) return;

                  const height = Math.max(
                    doc.body.scrollHeight,
                    doc.documentElement.scrollHeight,
                    500,
                  );

                  e.currentTarget.style.height = `${height + 20}px`;
                } catch {
                  e.currentTarget.style.height = "500px";
                }
              }}
            />
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-[#E5E7EB] flex justify-between items-center gap-2">
          <button
            type="button"
            onClick={handleWhatsApp}
            disabled={waBusy || printing}
            className="btn-secondary text-[13px] inline-flex items-center gap-1.5"
          >
            <MessageCircle size={14} strokeWidth={1.5} />
            {waBusy ? "Copying…" : "WhatsApp"}
          </button>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="btn-secondary text-[13px]">
              {printing ? "Close" : "Cancel"}
            </button>
            <button type="button" onClick={onPrint} className="btn-primary text-[13px]" disabled={printing}>
              {printing ? "Printing…" : "Print"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
