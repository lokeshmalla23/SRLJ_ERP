import { useEffect, useRef, useState } from "react";
import { Filter, ChevronDown, Check } from "lucide-react";

/** Sticky filter toolbar shell — each Quick Report / tab fills it with its own fields. */
export function FilterBar({ children }) {
  return (
    <div className="card !mb-4 !rounded-xl !border-[#D8D2C6] !bg-[#FFFDF9]/95 !p-3.5 shadow-[0_1px_2px_rgba(38,52,43,0.04),0_8px_24px_rgba(38,52,43,0.04)] sticky top-0 z-10 backdrop-blur-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mb-0.5 flex items-center gap-1.5 border-r border-[#E3DED4] pr-3 text-[#315C4A]">
          <Filter size={13} strokeWidth={1.7} />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">Filters</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FilterField({ label, children, className = "" }) {
  return (
    <div className={className}>
      {label && <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#747B76]">{label}</div>}
      {children}
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, placeholder = "All", className = "" }) {
  return (
    <FilterField label={label} className={className}>
      <select className="input !min-w-[140px] !rounded-[9px] !border-[#CFC8BB] !py-1.5 !text-[12.5px] focus:!border-[#3D6B5B] focus:!shadow-[0_0_0_3px_rgba(61,107,91,0.10)]" value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.id || o.value} value={o.id || o.value}>{o.name || o.label}</option>
        ))}
      </select>
    </FilterField>
  );
}

/**
 * Multi-select version of FilterSelect — `value` is an array of ids, `onChange`
 * receives the new array. Renders as a button showing "All" / one label /
 * "N selected", opening a checkbox list on click. Pass an array to `value`
 * (never a scalar) — that's what distinguishes this from FilterSelect.
 */
export function FilterMultiSelect({ label, value, onChange, options, placeholder = "All", className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const selected = Array.isArray(value) ? value : [];

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const toggle = (id) => {
    const next = selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id];
    onChange(next);
  };

  const optionLabel = (id) => {
    const o = options.find((o) => String(o.id ?? o.value) === String(id));
    return o?.name || o?.label || id;
  };

  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? optionLabel(selected[0])
      : `${selected.length} selected`;

  return (
    <FilterField label={label} className={className}>
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="input !min-w-[140px] !rounded-[9px] !border-[#CFC8BB] !py-1.5 !text-[12.5px] flex items-center justify-between gap-2 text-left focus:!border-[#3D6B5B] focus:!shadow-[0_0_0_3px_rgba(61,107,91,0.10)]"
        >
          <span className={selected.length ? "text-[#0A0A0A]" : "text-[#a3a3a3]"}>{summary}</span>
          <ChevronDown size={13} strokeWidth={1.7} className="shrink-0 text-[#747B76]" />
        </button>
        {open && (
          <div className="absolute z-20 mt-1.5 w-full min-w-[180px] max-h-64 overflow-y-auto rounded-[10px] border border-[#D8D2C6] bg-[#FFFDF9] py-1 shadow-[0_14px_35px_rgba(37,49,41,0.14)]">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full px-3 py-1.5 text-left text-[11.5px] font-medium text-[#9B3A3A] hover:bg-[#FBECEC]"
              >
                Clear all
              </button>
            )}
            {options.map((o) => {
              const id = o.id ?? o.value;
              const checked = selected.includes(id);
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[12.5px] text-[#24332B] hover:bg-[#F3F1EB]"
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${checked ? "border-[#315C4A] bg-[#315C4A]" : "border-[#C8C1B5] bg-white"}`}>
                    {checked && <Check size={11} strokeWidth={2.5} className="text-white" />}
                  </span>
                  <input type="checkbox" className="hidden" checked={checked} onChange={() => toggle(id)} />
                  {o.name || o.label}
                </label>
              );
            })}
            {options.length === 0 && (
              <div className="px-3 py-1.5 text-[11.5px] text-[#a3a3a3]">No options</div>
            )}
          </div>
        )}
      </div>
    </FilterField>
  );
}

export function FilterInput({ label, value, onChange, placeholder, className = "", type = "text" }) {
  return (
    <FilterField label={label} className={className}>
      <input
        type={type}
        className="input !min-w-[140px] !rounded-[9px] !border-[#CFC8BB] !py-1.5 !text-[12.5px] focus:!border-[#3D6B5B] focus:!shadow-[0_0_0_3px_rgba(61,107,91,0.10)]"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </FilterField>
  );
}
