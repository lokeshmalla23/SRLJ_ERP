import { toast } from "sonner";

let installed = false;

function formatReason(reason) {
  if (!reason) return "Unknown error";
  if (typeof reason === "string") return reason;
  if (reason?.message) return reason.message;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

/**
 * Surface uncaught JS / promise errors as toasts instead of a silent white screen.
 * React render errors are still handled by ErrorBoundary.
 */
export function installGlobalErrorHandlers() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event) => {
    const message = event?.error?.message || event?.message || "Unexpected script error";
    // Ignore noisy ResizeObserver / cancelled loads
    if (/ResizeObserver|Loading chunk|Script error\.?$/i.test(message)) return;
    console.error("[global error]", event.error || event.message);
    toast.error(message, {
      description: "An unexpected error occurred. Check Sync Diagnostics if data looks wrong.",
      duration: 8000,
      id: `global-error-${message.slice(0, 80)}`,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const message = formatReason(event?.reason);
    if (/ResizeObserver|AbortError|Failed to fetch|NetworkError/i.test(message)) {
      // Network noise — still log, softer toast
      console.warn("[unhandledrejection]", event.reason);
      toast.error(message, {
        description: "Request failed. Check internet / Branch Service.",
        duration: 6000,
        id: `global-reject-${message.slice(0, 80)}`,
      });
      return;
    }
    console.error("[unhandledrejection]", event.reason);
    toast.error(message, {
      description: "An unexpected error occurred.",
      duration: 8000,
      id: `global-reject-${message.slice(0, 80)}`,
    });
  });
}
