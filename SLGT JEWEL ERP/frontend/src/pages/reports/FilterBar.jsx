import { useEffect, useRef, useState } from "react";
import { Filter, ChevronDown, Check } from "lucide-react";

/** Sticky filter toolbar shell — each Quick Report / tab fills it with its own fields. */
export function FilterBar({ children }) {
  return (
    <div className="card mb-4 sticky top-0 z-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1.5 text-[#525252] mb-0.5">
          <Filter size={13} strokeWidth={1.5} />
          <span className="text-[12px] font-medium">Filters</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function FilterField({ label, children, className = "" }) {
  return (
    <div className={className}>
      {label && <div className="text-[10px] uppercase tracking-[0.06em] text-[#a3a3a3] mb-1">{label}</div>}
      {children}
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options, placeholder = "All", className = "" }) {
  return (
    <FilterField label={label} className={className}>
      <select className="input !py-1.5 !text-[12.5px] min-w-[140px]" value={value || ""} onChange={(e) => onChange(e.target.value)}>
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
          className="input !py-1.5 !text-[12.5px] min-w-[140px] flex items-center justify-between gap-2 text-left"
        >
          <span className={selected.length ? "text-[#0A0A0A]" : "text-[#a3a3a3]"}>{summary}</span>
          <ChevronDown size={13} strokeWidth={1.5} className="text-[#a3a3a3] shrink-0" />
        </button>
        {open && (
          <div className="absolute z-20 mt-1 w-full min-w-[180px] max-h-64 overflow-y-auto bg-white border border-[#E5E7EB] rounded-lg shadow-lg py-1">
            {selected.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-1.5 text-[11.5px] text-[#991B1B] hover:bg-[#FEF2F2]"
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
                  className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] text-[#0A0A0A] hover:bg-[#F5F5F5] cursor-pointer"
                >
                  <span className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${checked ? "bg-[#0A0A0A] border-[#0A0A0A]" : "border-[#D4D4D4]"}`}>
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
        className="input !py-1.5 !text-[12.5px] min-w-[140px]"
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </FilterField>
  );
}
