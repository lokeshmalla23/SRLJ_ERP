import { useEffect } from "react";

/**
 * Prevent mouse-wheel from changing values in native number/date inputs and selects.
 * Mount once from App.jsx / main.jsx.
 *
 * Prefer text inputs with inputMode="decimal" for numeric entry (no wheel mutation).
 * This listener is the safety net for any remaining native number/date fields.
 */
export function installBlockWheelOnFocusedFields() {
  if (typeof document === "undefined") return () => {};
  if (typeof window !== "undefined" && window.__ssjWheelBlockInstalled) return () => {};
  if (typeof window !== "undefined") window.__ssjWheelBlockInstalled = true;

  const isWheelMutatingControl = (el) => {
    if (el instanceof HTMLSelectElement) return true;
    if (!(el instanceof HTMLInputElement)) return false;
    const type = String(el.type || el.getAttribute("type") || "text").toLowerCase();
    return type === "number" || type === "date" || type === "time" || type === "month" || type === "week";
  };

  const onWheel = (e) => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (!isWheelMutatingControl(el)) return;
    // Only when focused — otherwise let the page scroll normally
    if (document.activeElement !== el) return;
    e.preventDefault();
    try { el.blur(); } catch { /* ignore */ }
  };

  document.addEventListener("wheel", onWheel, { passive: false, capture: true });
  document.addEventListener("mousewheel", onWheel, { passive: false, capture: true });

  return () => {
    document.removeEventListener("wheel", onWheel, { capture: true });
    document.removeEventListener("mousewheel", onWheel, { capture: true });
    if (typeof window !== "undefined") window.__ssjWheelBlockInstalled = false;
  };
}

export default function useBlockWheelOnFocusedFields() {
  useEffect(() => installBlockWheelOnFocusedFields(), []);
}
