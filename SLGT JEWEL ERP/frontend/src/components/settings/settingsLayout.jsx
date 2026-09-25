import { Printer, RotateCcw, Save } from "lucide-react";

/**
 * Shared full-width layout widgets for Settings tabs.
 */
export function SettingsTabFrame({ children, className = "" }) {
  return (
    <div className={`w-full min-w-0 space-y-4 ${className}`.trim()}>
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
      ? "border-[#E7C9C2] bg-[#FFFCFB]"
      : tone === "emphasis"
        ? "border-[#B9CCBA] bg-[#F9FBF7]"
        : "border-[#DCE3D6] bg-[#FEFEFB]";
  const headerClass =
    tone === "danger"
      ? "border-[#EED8D2] bg-[#FFF7F5]"
      : tone === "emphasis"
        ? "border-[#D2E0D0] bg-[#F0F5EE]"
        : "border-[#E3E7DF] bg-[#F6F7F1]";

  return (
    <section className={`w-full overflow-hidden rounded-[10px] border shadow-[0_1px_2px_rgba(36,55,45,0.04)] transition-colors focus-within:border-[#B8C9B8] [&_.input]:!border-[#C8D2C5] [&_.input:focus]:!border-[#5F7D67] [&_.input:focus]:!ring-2 [&_.input:focus]:!ring-[#DCE7D8] [&_.input:disabled]:!bg-[#F1F2ED] [&_.table-shell]:!border-[#DCE3D6] [&_.table-head-row]:!border-[#D9E0D6] [&_.table-head-row]:!bg-[#F3F5EE] [&_.table-th]:!text-[#66766A] [&_.table-td]:!border-[#E6E9E2] [&_.table-row:hover_.table-td]:!bg-[#F5F7F1] ${toneClass} ${className}`.trim()}>
      {(title || description || actions) && (
        <div className={`flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3 ${headerClass}`}>
          <div className="min-w-0">
            {title ? (
              <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-[#294236]">{title}</h3>
            ) : null}
            {description ? (
              <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-[#6F7C72]">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function SettingsStatGrid({ children }) {
  return (
    <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {children}
    </div>
  );
}

export function SettingsStat({ label, value, hint = null }) {
  return (
    <div className="relative flex min-h-[88px] flex-col justify-center overflow-hidden rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] px-4 py-3 shadow-[0_1px_2px_rgba(36,55,45,0.035)] before:absolute before:inset-x-0 before:top-0 before:h-0.5 before:bg-[#B49042]">
      <div className="font-display text-[24px] font-bold leading-none tabular-nums text-[#244B39]">
        {value == null || value === "" ? "—" : Number(value).toLocaleString()}
      </div>
      <div className="mt-1.5 text-[12px] font-medium text-[#5F6F63]">{label}</div>
      {hint ? <div className="mt-0.5 text-[11px] text-[#8A958D]">{hint}</div> : null}
    </div>
  );
}

export function DragModeToggle({ on, onChange, disabled = false }) {
  return (
    <div className={`flex shrink-0 items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-[12px] font-medium text-[#596A5E]">Draggable</span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`relative h-6 w-11 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/40 focus-visible:ring-offset-2 ${
          on ? "border-[#244B39] bg-[#244B39]" : "border-[#C8D0C4] bg-[#D8DDD5]"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            on ? "translate-x-5" : ""
          }`}
        />
      </button>
      <span className={`w-7 text-[10px] font-bold tracking-[0.08em] ${on ? "text-[#315E48]" : "text-[#7D887F]"}`}>
        {on ? "ON" : "OFF"}
      </span>
    </div>
  );
}

export function DesignerActionBar({ canWrite, saving, testing, onSave, onTest, onReset, compact = false }) {
  const wrap = compact
    ? "flex flex-wrap gap-2"
    : "grid gap-2 rounded-[9px] border border-[#DEE4DA] bg-[#F5F6F0] p-2.5 sm:grid-cols-2";
  const full = compact ? "" : "w-full";
  const primaryFull = compact ? "" : "w-full sm:col-span-2";
  const secondary = "inline-flex h-9 items-center justify-center gap-2 rounded-[9px] border border-[#CDD6CA] bg-white px-3.5 text-[12.5px] font-semibold text-[#344A3C] transition-colors hover:border-[#9FAF9E] hover:bg-[#F7F9F4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#78917C]/35 disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div className={wrap}>
      <button
        type="button"
        className={`inline-flex h-9 items-center justify-center gap-2 rounded-[9px] border border-[#244B39] bg-[#244B39] px-3.5 text-[12.5px] font-semibold text-white transition-colors hover:border-[#173D2C] hover:bg-[#173D2C] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315E48]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${primaryFull}`.trim()}
        disabled={!canWrite || saving}
        onClick={onSave}
      >
        <Save size={15} strokeWidth={1.75} />
        {saving ? "Saving…" : "Save layout"}
      </button>
      <button type="button" className={`${secondary} ${full}`.trim()} disabled={testing} onClick={onTest}>
        <Printer size={15} strokeWidth={1.75} />
        {testing ? "Printing…" : "Test print sample"}
      </button>
      <button type="button" className={`${secondary} ${full}`.trim()} disabled={!canWrite} onClick={onReset}>
        <RotateCcw size={15} strokeWidth={1.75} />
        Reset defaults
      </button>
    </div>
  );
}

export function PrintDesignerFrame({ left, right }) {
  return (
    <div className="flex w-full min-w-0 flex-col items-start gap-4 xl:flex-row">
      <aside className="min-w-0 w-full xl:flex-1">{left}</aside>
      <section className="w-full xl:sticky xl:top-[7.25rem] xl:z-[4] xl:w-auto xl:shrink-0 xl:self-start">
        {right}
      </section>
    </div>
  );
}

/** Shared lock banner. Frozen tabs show only "Locked" — no unlock hints. */
export function PrintSettingsLockBanner({ frozen }) {
  if (!frozen) return null;
  return (
    <div className="flex items-center gap-2 rounded-[9px] border border-[#E4D4AA] bg-[#FBF7ED] px-3 py-2 text-[12px] font-semibold text-[#7A6129] before:h-4 before:w-0.5 before:rounded-full before:bg-[#B49042]">
      Locked
    </div>
  );
}

export function DesignerPreviewHeader({ title, subtitle }) {
  return (
    <div className="mb-2.5">
      <h3 className="font-display text-[15px] font-semibold tracking-[-0.015em] text-[#294236]">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-[#748078]">{subtitle}</p> : null}
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
    <div className={`flex h-full flex-col rounded-[10px] border border-[#DCE3D6] bg-[#FEFEFB] p-4 shadow-[0_1px_2px_rgba(36,55,45,0.04)] transition-colors hover:border-[#C4D0C1] ${className}`.trim()}>
      <div className="flex items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border border-[#C8D7C7] bg-[#EAF1E8] text-[#244B39]">
            <Icon size={16} strokeWidth={1.7} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-[#294236]">{title}</div>
          {description ? (
            <p className="mt-1 text-[12px] leading-relaxed text-[#707C73]">{description}</p>
          ) : null}
        </div>
      </div>
      {children ? <div className="mt-4 flex-1">{children}</div> : null}
      {footer ? <div className="mt-4 border-t border-[#E6EAE3] pt-3">{footer}</div> : null}
    </div>
  );
}

export function SettingsSplit({ children, className = "" }) {
  return (
    <div className={`grid w-full grid-cols-1 gap-4 xl:grid-cols-2 ${className}`.trim()}>
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
    <div className="flex items-center justify-between gap-3 rounded-[9px] border border-[#E0E5DD] bg-[#F7F8F3] p-3 transition-colors hover:border-[#CAD5C8] hover:bg-white">
      <div className="flex min-w-0 items-center gap-3">
        {badge != null ? (
          <span className={`shrink-0 rounded-md border border-transparent px-2 py-1 text-[10.5px] font-semibold tabular-nums ${badgeClassName}`}>
            {badge}
          </span>
        ) : null}
        <div className="min-w-0">
          <div className="truncate text-[12.5px] font-semibold text-[#34463A]">{label}</div>
          {description ? (
            <div className="truncate text-[11px] text-[#7A857D]">{description}</div>
          ) : null}
        </div>
      </div>
      {action}
    </div>
  );
}
