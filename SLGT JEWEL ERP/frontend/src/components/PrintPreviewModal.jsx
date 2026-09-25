import { useEffect, useMemo } from "react";
import { X } from "lucide-react";

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
export default function PrintPreviewModal({ html, title = "Print Preview", subtitle, onPrint, onClose, printing }) {
  const frameWidth = useMemo(() => pageWidthPx(html), [html]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dialog-overlay fixed inset-0 z-[60] flex items-center justify-center p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[92vh] w-full max-w-[920px] flex-col overflow-hidden rounded-2xl border border-[#E2E7E2] bg-[#FFFDF9] shadow-float">
        <div className="flex shrink-0 items-center justify-between border-b border-[#E2E7E2] bg-[#FAF7EF] px-5 py-3.5">
          <div>
            <p className="font-display text-[15px] font-semibold tracking-[-0.01em] text-[#17201C]">{title}</p>
            <p className="mt-0.5 text-[11.5px] leading-4 text-[#6F7772]">
              {printing ? "Sending to printer…" : (subtitle || "Check before sending to printer")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-transparent text-[#6F7772] transition-colors hover:border-[#D3DCD5] hover:bg-[#FFFDF9] hover:text-[#214F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/25"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#EAE6DC] p-5">
          <div
            className="mx-auto bg-white shadow-[0_12px_30px_rgba(74,64,46,0.18),0_0_0_1px_rgba(123,111,88,0.16)]"
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

        <div className="flex shrink-0 justify-end gap-2 border-t border-[#E2E7E2] bg-[#F7F9F6] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary min-h-9 text-[13px] focus-visible:ring-2 focus-visible:ring-[#214F3A]/25 focus-visible:ring-offset-2"
          >
            {printing ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={onPrint}
            className="btn-primary min-h-9 text-[13px] focus-visible:ring-2 focus-visible:ring-[#214F3A]/25 focus-visible:ring-offset-2"
            disabled={printing}
          >
            {printing ? "Printing…" : "Print"}
          </button>
        </div>
      </div>
    </div>
  );
}
