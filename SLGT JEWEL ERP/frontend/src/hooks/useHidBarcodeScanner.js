import { useEffect, useRef } from "react";

/**
 * Capture HID / keyboard-wedge barcode scanners even when the barcode text field
 * does not have focus (e.g. user clicked cart / payment / empty area).
 *
 * Scanners inject characters very quickly (< ~45ms between keys) and end with Enter.
 * Slow typing into other inputs is ignored. Pass `shouldIgnore` to skip when the
 * dedicated barcode input is already focused (that field handles Enter itself).
 *
 * @param {(code: string) => void|Promise<void>} onScan
 * @param {{
 *   enabled?: boolean,
 *   maxGapMs?: number,
 *   minLength?: number,
 *   shouldIgnore?: (e: KeyboardEvent) => boolean,
 * }} [opts]
 */
export default function useHidBarcodeScanner(onScan, opts = {}) {
  const {
    enabled = true,
    maxGapMs = 45,
    minLength = 3,
    shouldIgnore = null,
  } = opts;

  const onScanRef = useRef(onScan);
  const shouldIgnoreRef = useRef(shouldIgnore);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);
  useEffect(() => { shouldIgnoreRef.current = shouldIgnore; }, [shouldIgnore]);

  const bufRef = useRef("");
  const lastTsRef = useRef(0);
  const gapsOkRef = useRef(true);
  const busyRef = useRef(false);
  const clearTimerRef = useRef(null);

  useEffect(() => {
    if (!enabled) return undefined;

    const reset = () => {
      bufRef.current = "";
      lastTsRef.current = 0;
      gapsOkRef.current = true;
      if (clearTimerRef.current) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };

    const isEditableTarget = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const tag = el.tagName;
      if (tag === "TEXTAREA" || tag === "SELECT") return true;
      if (tag === "INPUT") {
        const type = String(el.getAttribute("type") || "text").toLowerCase();
        if (["button", "submit", "reset", "checkbox", "radio", "file", "hidden", "color", "range"].includes(type)) {
          return false;
        }
        return true;
      }
      if (el.isContentEditable) return true;
      return Boolean(el.closest?.("[contenteditable='true']"));
    };

    const flush = async (code) => {
      const value = String(code || "").trim();
      reset();
      if (!value || value.length < minLength) return;
      if (busyRef.current) return;
      busyRef.current = true;
      try {
        await onScanRef.current?.(value);
      } finally {
        busyRef.current = false;
      }
    };

    const onKeyDown = (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.isComposing) return;
      if (shouldIgnoreRef.current?.(e)) return;

      const active = document.activeElement;
      const inEditable = isEditableTarget(active);
      const key = e.key;
      const now = Date.now();

      if (key === "Enter") {
        if (bufRef.current && gapsOkRef.current && bufRef.current.length >= minLength) {
          e.preventDefault();
          e.stopPropagation();
          flush(bufRef.current);
        } else {
          reset();
        }
        return;
      }

      if (key === "Escape" || key === "Tab") {
        reset();
        return;
      }

      // Only printable single characters (scanner wedge)
      if (key.length !== 1) return;

      const last = lastTsRef.current;
      if (last && now - last > maxGapMs) {
        // Gap too large for a continuous scan — start a new burst
        bufRef.current = "";
        gapsOkRef.current = true;
        // Slow key while typing in another field — do not steal
        if (inEditable) return;
      }

      // In another text field: only steal once the burst is clearly scanner-fast
      // (2nd+ char within maxGap). First char is allowed through so humans can type.
      if (inEditable) {
        if (!bufRef.current) {
          bufRef.current = key;
          lastTsRef.current = now;
          gapsOkRef.current = true;
          if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
          clearTimerRef.current = window.setTimeout(reset, 140);
          return; // do not preventDefault
        }
        if (!last || now - last > maxGapMs) {
          reset();
          return;
        }
      }

      bufRef.current += key;
      lastTsRef.current = now;

      e.preventDefault();
      e.stopPropagation();

      if (clearTimerRef.current) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(reset, 140);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      reset();
    };
  }, [enabled, maxGapMs, minLength]);
}
