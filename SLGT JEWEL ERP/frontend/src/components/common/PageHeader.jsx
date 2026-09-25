export default function PageHeader({ title, subtitle, actions, onTitleClick, titleHint }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2
          className={`font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] text-[#17201C]${onTitleClick ? " cursor-pointer select-none" : ""}`}
          onClick={onTitleClick}
          title={titleHint}
        >
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-[#6B756F]">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div>}
    </div>
  );
}
