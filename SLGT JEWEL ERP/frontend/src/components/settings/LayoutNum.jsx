import { useEffect, useState } from "react";

/** Number field that can be typed (no spinner snap) and stepped with + / −. */
export default function LayoutNum({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 100,
  disabled = false,
  suffix,
}) {
  const [draft, setDraft] = useState(String(value ?? ""));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value ?? ""));
  }, [value, focused]);

  const commit = (raw) => {
    const n = parseFloat(String(raw).replace(",", "."));
    if (Number.isNaN(n)) {
      setDraft(String(value ?? ""));
      return;
    }
    const clamped = Math.min(max, Math.max(min, n));
    onChange(clamped);
    setDraft(String(clamped));
  };

  const nudge = (dir) => {
    const base = Number(value);
    const next = (Number.isNaN(base) ? min : base) + dir * step;
    const clamped = Math.min(max, Math.max(min, Math.round(next * 1000) / 1000));
    onChange(clamped);
    setDraft(String(clamped));
  };

  return (
    <label className="block text-[11.5px] font-medium text-[#5F6F63]">
      {label}
      <div className="mt-1 flex items-center gap-1">
        <button type="button" className="btn-secondary !h-8 !w-8 !rounded-[8px] !p-0 text-[13px]" disabled={disabled} onClick={() => nudge(-1)} aria-label="decrease">−</button>
        <input
          className="input min-w-0 flex-1 text-center !rounded-[8px] !border-[#C8D2C5] focus:!border-[#5F7D67] focus:!ring-2 focus:!ring-[#DCE7D8]"
          type="text"
          inputMode="decimal"
          disabled={disabled}
          value={focused ? draft : String(value ?? "")}
          onFocus={() => { setFocused(true); setDraft(String(value ?? "")); }}
          onChange={(e) => {
            const t = e.target.value;
            setDraft(t);
            const n = parseFloat(String(t).replace(",", "."));
            if (!Number.isNaN(n) && n >= min && n <= max) onChange(n);
          }}
          onBlur={() => { setFocused(false); commit(draft); }}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        />
        <button type="button" className="btn-secondary !h-8 !w-8 !rounded-[8px] !p-0 text-[13px]" disabled={disabled} onClick={() => nudge(1)} aria-label="increase">+</button>
        {suffix ? <span className="text-[11px] text-[#737373] w-8 shrink-0">{suffix}</span> : null}
      </div>
    </label>
  );
}
