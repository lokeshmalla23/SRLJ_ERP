import { Printer, RotateCcw, Save } from "lucide-react";

/**
 * Shared full-width layout widgets for Settings tabs.
 */
export function SettingsTabFrame({ children, className = "" }) {
  return (
    <div className={`w-full space-y-5 ${className}`.trim()}>
      {children}
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  actions = null,
  children,
  className = "",
  tone = "default",
}) {
  const toneClass =
    tone === "danger"
      ? "border-red-200 bg-red-50/40"
      : tone === "emphasis"
        ? "border-[#0A0A0A] bg-[#FAFAFA]"
        : "border-[#E5E7EB] bg-white";

  return (
    <section className={`w-full border rounded-lg ${toneClass} ${className}`.trim()}>
      {(title || description || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-inherit">
          <div className="min-w-0">
            {title ? (
              <h3 className="text-[14px] font-semibold text-[#0A0A0A]">{title}</h3>
            ) : null}
            {description ? (
              <p className="text-[12.5px] text-[#737373] mt-0.5 max-w-3xl">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function SettingsStatGrid({ children }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 w-full">
      {children}
    </div>
  );
}

export function SettingsStat({ label, value, hint = null }) {
  return (
    <div className="border border-[#E5E7EB] bg-white rounded-lg px-4 py-3 min-h-[88px] flex flex-col justify-center">
      <div className="font-display text-[24px] font-bold text-[#0A0A0A] tabular-nums leading-none">
        {value == null || value === "" ? "—" : Number(value).toLocaleString()}
      </div>
      <div className="text-[12px] text-[#737373] mt-1.5">{label}</div>
      {hint ? <div className="text-[11px] text-[#a3a3a3] mt-0.5">{hint}</div> : null}
    </div>
  );
}

export function DragModeToggle({ on, onChange, disabled = false }) {
  return (
    <div className={`flex items-center gap-2 shrink-0 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-[12.5px] text-[#525252]">Draggable</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-[#0A0A0A]" : "bg-[#D4D4D4]"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            on ? "translate-x-5" : ""
          }`}
        />
      </button>
      <span className="text-[11px] font-semibold text-[#737373] w-7">{on ? "ON" : "OFF"}</span>
    </div>
  );
}

export function DesignerActionBar({ canWrite, saving, testing, onSave, onTest, onReset, compact = false }) {
  const wrap = compact
    ? "flex flex-wrap gap-2"
    : "space-y-2 pt-3 border-t border-[#E5E7EB]";
  const full = compact ? "" : "w-full";
  return (
    <div className={wrap}>
      <button type="button" className={`btn-primary ${full}`.trim()} disabled={!canWrite || saving} onClick={onSave}>
        <Save size={15} strokeWidth={1.75} />
        {saving ? "Saving…" : "Save layout"}
      </button>
      <button type="button" className={`btn-secondary ${full}`.trim()} disabled={testing} onClick={onTest}>
        <Printer size={15} strokeWidth={1.75} />
        {testing ? "Printing…" : "Test print sample"}
      </button>
      <button type="button" className={`btn-secondary ${full}`.trim()} disabled={!canWrite} onClick={onReset}>
        <RotateCcw size={15} strokeWidth={1.75} />
        Reset defaults
      </button>
    </div>
  );
}

export function PrintDesignerFrame({ left, right }) {
  return (
    <div className="flex flex-col xl:flex-row items-start gap-4 w-full">
      <aside className="w-full xl:flex-1 min-w-0">{left}</aside>
      <section className="w-full xl:w-auto xl:shrink-0 xl:sticky xl:top-[7.25rem] xl:self-start xl:z-[4]">
        {right}
      </section>
    </div>
  );
}

/** Shared lock banner. Frozen tabs show only "Locked" — no unlock hints. */
export function PrintSettingsLockBanner({ frozen }) {
  if (!frozen) return null;
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] font-medium text-amber-900">
      Locked
    </div>
  );
}

export function DesignerPreviewHeader({ title, subtitle }) {
  return (
    <div className="mb-2">
      <h3 className="text-[16px] font-semibold text-[#0A0A0A]">{title}</h3>
      {subtitle ? <p className="text-[12px] text-[#737373] mt-0.5">{subtitle}</p> : null}
    </div>
  );
}

export function SettingsActionCard({
  icon: Icon = null,
  title,
  description,
  children = null,
  footer = null,
  className = "",
}) {
  return (
    <div className={`border border-[#E5E7EB] bg-white rounded-lg p-4 h-full flex flex-col ${className}`.trim()}>
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#0A0A0A] text-white">
            <Icon size={16} strokeWidth={1.5} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-[#0A0A0A]">{title}</div>
          {description ? (
            <p className="text-[12.5px] text-[#737373] mt-1 leading-relaxed">{description}</p>
          ) : null}
        </div>
      </div>
      {children ? <div className="mt-4 flex-1">{children}</div> : null}
      {footer ? <div className="mt-4 pt-3 border-t border-[#F3F4F6]">{footer}</div> : null}
    </div>
  );
}

export function SettingsSplit({ children, className = "" }) {
  return (
    <div className={`grid grid-cols-1 xl:grid-cols-2 gap-4 w-full ${className}`.trim()}>
      {children}
    </div>
  );
}

export function SettingsExportRow({
  label,
  description,
  badge = null,
  badgeClassName = "text-[#525252] bg-[#F3F4F6]",
  action = null,
}) {
  return (
    <div className="flex items-center justify-between gap-3 p-3 border border-[#E5E7EB] rounded-lg bg-[#FAFAFA] hover:bg-white transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        {badge != null ? (
          <span className={`text-[11px] font-semibold px-2 py-1 rounded-md shrink-0 tabular-nums ${badgeClassName}`}>
            {badge}
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-[#0A0A0A] truncate">{label}</div>
          {description ? (
            <div className="text-[11.5px] text-[#737373] truncate">{description}</div>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}
