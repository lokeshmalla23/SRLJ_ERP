export default function PageHeader({ title, subtitle, actions, onTitleClick, titleHint }) {
  return (
    <div className="flex items-end justify-between mb-8">
      <div>
        <h2
          className={`font-display text-[26px] font-semibold text-[#0A0A0A] tracking-tight${onTitleClick ? " select-none" : ""}`}
          onClick={onTitleClick}
          title={titleHint}
        >
          {title}
        </h2>
        {subtitle && (
          <p className="text-[13.5px] text-[#525252] mt-1.5 max-w-2xl">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
