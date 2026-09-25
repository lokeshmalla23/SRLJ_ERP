import { useEffect, useRef, useState } from "react";
import { X, Delete } from "lucide-react";

/**
 * Numeric keypad dialog for Hidden Bill password.
 * Accepts on-screen keypad and physical keyboard (digits, Backspace, Enter, Esc).
 */
export default function HiddenBillPasswordDialog({ open, onClose, onSubmit, busy, error }) {
  const [pin, setPin] = useState("");
  const inputRef = useRef(null);
  const pinRef = useRef("");

  useEffect(() => {
    pinRef.current = pin;
  }, [pin]);

  useEffect(() => {
    if (!open) {
      setPin("");
      return;
    }
    // Focus hidden input so keyboard typing works immediately
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (error) {
      setPin("");
      inputRef.current?.focus();
    }
  }, [error]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (e) => {
      // Don't steal keys from another focused editable (except our pin input)
      const tag = String(e.target?.tagName || "").toLowerCase();
      const isOurInput = e.target === inputRef.current;
      if ((tag === "input" || tag === "textarea") && !isOurInput) return;

      if (e.key === "Escape") {
        e.preventDefault();
        // Always allow dismiss — a hung unlock request must not trap the UI
        onClose();
        return;
      }
      if (busy) return;
      if (e.key === "Enter") {
        e.preventDefault();
        const value = pinRef.current;
        if (value.length >= 4) onSubmit(value);
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (e.key === "Delete" || (e.key.toLowerCase() === "c" && (e.ctrlKey || e.metaKey))) {
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        setPin((p) => (p.length >= 8 ? p : p + e.key));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose, onSubmit]);

  if (!open) return null;

  const press = (digit) => {
    setPin((p) => (p.length >= 8 ? p : p + digit));
    inputRef.current?.focus();
  };
  const backspace = () => {
    setPin((p) => p.slice(0, -1));
    inputRef.current?.focus();
  };
  const clear = () => {
    setPin("");
    inputRef.current?.focus();
  };

  const submit = (e) => {
    e?.preventDefault?.();
    if (!pin || pin.length < 4 || busy) return;
    onSubmit(pin);
  };

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"];

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.5)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#E5E7EB" }}>
          <div>
            <div className="text-sm font-semibold text-[#0A0A0A]">Hidden Bill</div>
            <div className="text-[11px] text-[#737373]">Keypad or keyboard · Enter to unlock</div>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <X size={18} className="text-[#737373]" />
          </button>
        </div>

        <form onSubmit={submit} className="p-4 space-y-3">
          {/* Real input for keyboard / accessibility; visually mirrored by dots */}
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={8}
            value={pin}
            disabled={busy}
            aria-label="Hidden bill PIN"
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
              setPin(digits);
            }}
            className="sr-only"
          />

          <div
            className="h-12 rounded-xl border flex items-center justify-center tracking-[0.35em] text-xl font-mono font-semibold cursor-text"
            style={{ borderColor: error ? "#FCA5A5" : "#E5E7EB", background: error ? "#FEF2F2" : "#FAFAFA" }}
            onClick={() => inputRef.current?.focus()}
          >
            {pin ? "•".repeat(pin.length) : <span className="text-[#a3a3a3] tracking-normal text-sm font-sans">Type PIN…</span>}
          </div>
          {error && (
            <div className="text-[12px] text-red-600 text-center font-medium" role="alert">
              {error}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {keys.map((k) => (
              <button
                key={k}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (k === "C") clear();
                  else if (k === "⌫") backspace();
                  else press(k);
                }}
                className="h-12 rounded-xl border text-lg font-semibold text-[#0A0A0A] hover:bg-[#F5F5F4] active:bg-[#E7E5E4] disabled:opacity-50"
                style={{ borderColor: "#E5E7EB" }}
              >
                {k === "⌫" ? <Delete size={18} className="mx-auto" /> : k}
              </button>
            ))}
          </div>

          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className="w-full h-11 rounded-xl text-white text-sm font-semibold disabled:opacity-50"
            style={{ background: "#0A0A0A" }}
          >
            {busy ? "Checking…" : "Unlock Hidden Bill"}
          </button>
        </form>
      </div>
    </div>
  );
}
