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
    <div className="card border-2 !rounded-xl !border-[#CBDED2] bg-[#FFFDF9] shadow-[0_8px_24px_rgba(23,56,42,0.06)]" style={{ borderColor: "#CBDED2" }}>
      <div className="text-[13px] font-bold text-[#17201C] mb-3 flex items-center gap-2">
        <span className="h-7 w-7 rounded-full bg-[#EAF2ED] border border-[#CBDED2] flex items-center justify-center">
          <ScanLine size={13} strokeWidth={2} className="text-[#214F3A]" />
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
          <div className="text-[12px] text-[#89928C]">Ready to scan</div>
        ) : lastResult.result === "matched" ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#EAF2ED] border border-[#CBDED2]">
            <CheckCircle2 size={16} className="text-[#214F3A] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
            <div>
              <div className="text-[12.5px] font-semibold text-[#17382A]">Barcode Matched</div>
              <div className="text-[12px] text-[#214F3A] font-mono">{lastResult.barcode}</div>
              {lastResult.item_name && <div className="text-[12px] text-[#2F6B4F]">{lastResult.item_name}</div>}
              <div className="text-[11.5px] text-[#2F6B4F] mt-0.5">
                Scanned: {lastResult.scanned_quantity} / {lastResult.expected_quantity} · Pending: {lastResult.pending_quantity}
              </div>
            </div>
          </div>
        ) : lastResult.result === "already_completed" ? (
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#FBF4E3] border border-amber-200">
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
          <div className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg bg-[#F4F5F8] border border-[#D9DEE8]">
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
