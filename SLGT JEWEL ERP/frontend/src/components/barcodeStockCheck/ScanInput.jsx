import { useEffect, useRef, useState } from "react";
import { ScanLine, CheckCircle2, AlertTriangle, XCircle, ShieldAlert } from "lucide-react";

/**
 * Prominent scan box. Works with USB/HID scanners (keyboard-wedge, Enter-terminated)
 * as well as manual typing — Enter submits, input clears and refocuses automatically.
 */
export default function ScanInput({ onScan, busy, disabled, lastResult, inputRef }) {
  const [value, setValue] = useState("");
  const localRef = useRef(null);
  const ref = inputRef || localRef;

  useEffect(() => {
    if (!disabled) ref.current?.focus();
  }, [disabled, ref]);

  const submit = async () => {
    const code = value.trim();
    if (!code || busy) return;
    setValue("");
    await onScan(code);
    ref.current?.focus();
  };

  return (
    <div className="card border-2" style={{ borderColor: "#EFE4C8" }}>
      <div className="text-[13px] font-bold text-[#0A0A0A] mb-3 flex items-center gap-2">
        <span className="h-6 w-6 rounded-full bg-[#FBF3DF] flex items-center justify-center">
          <ScanLine size={13} strokeWidth={2} className="text-[#B49042]" />
        </span>
        Scan Barcode
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          className="input flex-1 font-mono text-[16px] tracking-wide"
          placeholder="Scan barcode here…"
          value={value}
          disabled={disabled}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" className="btn-primary" disabled={disabled || busy || !value.trim()} onClick={submit}>
          Scan
        </button>
      </div>

      <div className="mt-3">
        {!lastResult ? (
          <div className="text-[12px] text-[#a3a3a3]">Ready to scan</div>
        ) : lastResult.result === "matched" ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md bg-green-50 border border-green-200">
            <CheckCircle2 size={16} className="text-green-600 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <div className="text-[12.5px] font-semibold text-green-800">Barcode Matched</div>
              <div className="text-[12px] text-green-700 font-mono">{lastResult.barcode}</div>
              {lastResult.item_name && <div className="text-[12px] text-green-700">{lastResult.item_name}</div>}
              <div className="text-[11.5px] text-green-700 mt-0.5">
                Scanned: {lastResult.scanned_quantity} / {lastResult.expected_quantity} · Pending: {lastResult.pending_quantity}
              </div>
            </div>
          </div>
        ) : lastResult.result === "already_completed" ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md bg-amber-50 border border-amber-200">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <div className="text-[12.5px] font-semibold text-amber-800">Product Already Checked</div>
              <div className="text-[12px] text-amber-700 font-mono">{lastResult.barcode}</div>
              <div className="text-[11.5px] text-amber-700 mt-0.5">
                {lastResult.barcode} has already been completely verified. Expected: {lastResult.expected_quantity} · Scanned: {lastResult.scanned_quantity}
              </div>
            </div>
          </div>
        ) : lastResult.result === "wrong_category" ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md bg-violet-50 border border-violet-200">
            <ShieldAlert size={16} className="text-violet-600 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <div className="text-[12.5px] font-semibold text-violet-800">Wrong Category</div>
              <div className="text-[12px] text-violet-700 font-mono">{lastResult.barcode}</div>
              <div className="text-[11.5px] text-violet-700 mt-0.5">
                Barcode belongs to {lastResult.actual_category_name || "another"} category.
                Currently checking {lastResult.expected_category_name || "a different category"}.
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-md bg-red-50 border border-red-200">
            <XCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <div className="text-[12.5px] font-semibold text-red-800">Barcode Not Found</div>
              <div className="text-[12px] text-red-700 font-mono">{lastResult.barcode}</div>
              <div className="text-[11.5px] text-red-700 mt-0.5">
                Not present in the current ERP stock. Please verify the physical item.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
