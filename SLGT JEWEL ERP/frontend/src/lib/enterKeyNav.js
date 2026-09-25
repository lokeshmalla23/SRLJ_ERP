// ─── Enter-key-as-Tab navigation — shared, framework-agnostic DOM utilities ───
//
// One global keydown listener (wired up once via useEnterKeyNavigation, see
// src/hooks/useEnterKeyNavigation.js) uses these helpers to let Enter move
// focus to the next field app-wide, without every screen needing its own
// per-field wiring. See that hook for the cooperation contract with local
// onKeyDown handlers (autocomplete selection, inline-save fields, etc.).

const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not([disabled])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  "a[href]",
].join(", ");

const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox", "radio", "button", "submit", "reset", "image", "file", "range", "color",
]);

function isElementVisible(el) {
  if (!el) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  // offsetParent is null for display:none, position:fixed elements themselves, and
  // detached nodes — but fixed-position *ancestors* still give their children a
  // valid offsetParent, so this correctly excludes only truly hidden elements.
  if (el.offsetParent === null && style.position !== "fixed") return false;
  return true;
}

/** True for elements Enter-navigation should treat as a "field" to land on. */
function isTextEntryField(el) {
  if (!el) return false;
  if (el.tagName === "SELECT" || el.tagName === "TEXTAREA") return !el.disabled && !el.readOnly;
  if (el.tagName !== "INPUT") return false;
  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (NON_TEXT_INPUT_TYPES.has(type)) return false;
  return !el.disabled && !el.readOnly;
}

/**
 * Finds the nearest ancestor that should bound Enter-navigation for `el` —
 * every modal/side-panel/dialog in this app is built as a `position: fixed`
 * container (or explicitly opts in via `data-enter-scope`), so scoping to
 * that ancestor keeps Enter from ever jumping focus to the page behind an
 * open modal. Falls back to the whole document for normal page content.
 */
export function getEnterScope(el) {
  let node = el?.parentElement;
  while (node && node !== document.body) {
    if (node.hasAttribute("data-enter-scope") || node.getAttribute("role") === "dialog") return node;
    if (window.getComputedStyle(node).position === "fixed") return node;
    node = node.parentElement;
  }
  return document;
}

export function getFocusableElements(root) {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isElementVisible);
}

/**
 * Moves focus to the next enterable field (input/select/textarea) after
 * `current`, within `scope`, in natural DOM order. Returns true if focus moved.
 */
export function focusNextField(current, scope) {
  const all = getFocusableElements(scope);
  const idx = all.indexOf(current);
  if (idx === -1) return false;
  for (let i = idx + 1; i < all.length; i++) {
    const el = all[i];
    if (isTextEntryField(el)) {
      el.focus();
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
      return true;
    }
  }
  return false;
}

/**
 * Finds the explicit "final action" button within `scope`, if the screen marked
 * one. Deliberately only ever FOCUSED, never auto-clicked, by the caller — for
 * anything irreversible (completing a POS payment, saving a transaction) the
 * user must still press Enter/Space (or click) once more on the now-focused
 * button, exactly like landing on it via Tab would. That extra deliberate step
 * is what keeps rapid Enter-through-a-form navigation from ever accidentally
 * firing a payment or save action the moment the last field is filled in.
 */
export function findEnterSubmit(scope) {
  if (!scope || typeof scope.querySelector !== "function") return null;
  return scope.querySelector('[data-enter-submit="true"]:not([disabled])');
}
