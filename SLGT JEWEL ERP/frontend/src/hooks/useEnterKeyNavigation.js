import { useEffect } from "react";
import { getEnterScope, focusNextField, findEnterSubmit } from "@/lib/enterKeyNav";

const SKIPPED_INPUT_TYPES = new Set([
  "checkbox", "radio", "button", "submit", "reset", "file", "range", "color",
]);

/**
 * App-wide "Enter behaves like Tab" navigation — mount once (see App.jsx).
 *
 * Cooperation contract for any field with its own onKeyDown Enter handling
 * (autocomplete select-first-result, inline-save-on-Enter, etc.): call
 * `e.preventDefault()` once it has fully handled the key press. This listener
 * runs in the bubble phase on `document`, i.e. strictly after such handlers,
 * and backs off whenever `e.defaultPrevented` is already true — so it only
 * ever supplies the *default* next-field behavior, never overrides one a
 * screen has deliberately implemented.
 *
 * Opt-outs available to any field/screen without touching this file:
 *   - `data-enter-ignore="true"` on a field — Enter does nothing special here.
 *   - `data-enter-scope` on a modal/panel wrapper — bounds navigation to it
 *     (normally auto-detected via `position: fixed`, see getEnterScope).
 *   - `data-enter-submit="true"` on a button — the "final action" to trigger
 *     via click() when Enter is pressed on the last field with no <form>
 *     ancestor to fall back on for native implicit submission.
 */
export default function useEnterKeyNavigation() {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.isContentEditable) return;
      if (target.dataset.enterIgnore === "true") return;

      const tag = target.tagName;
      if (tag === "TEXTAREA") return; // Enter must insert a newline
      if (tag === "BUTTON" || tag === "A") return; // let its own activation/onKeyDown run
      if (tag === "INPUT") {
        const type = (target.getAttribute("type") || "text").toLowerCase();
        if (SKIPPED_INPUT_TYPES.has(type)) return;
      } else if (tag !== "SELECT") {
        return; // only plain inputs/selects get generic Enter-as-Tab behavior
      }

      // A local handler on this field already fully handled this Enter press.
      if (e.defaultPrevented) return;

      // Respect native HTML5 validation (required/pattern/type=email/etc.)
      // before moving on — keep focus on the field that needs correcting.
      if (typeof target.checkValidity === "function" && !target.checkValidity()) {
        target.reportValidity();
        e.preventDefault();
        return;
      }

      const scope = getEnterScope(target);

      if (focusNextField(target, scope)) {
        e.preventDefault();
        return;
      }

      // No more fields ahead in this modal/section. If the screen marked its
      // designated action button, move focus there (never auto-click it —
      // completing a payment or saving a record must stay a deliberate final
      // Enter/Space/click on that now-focused button, not an automatic side
      // effect of filling in the last field). Otherwise let native implicit
      // form submission proceed, which is a no-op outside of a real <form>.
      const submitEl = findEnterSubmit(scope);
      if (submitEl) {
        e.preventDefault();
        submitEl.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);
}
