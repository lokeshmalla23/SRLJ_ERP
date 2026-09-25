import { ArrowUpRight } from "lucide-react";
import { kpiTones } from "@/lib/theme";

/**
 * Shared metric surface. `tone` opts into one of the four soft-gradient
 * treatments from the design system; omitting it keeps the neutral surface.
 * Presentation only — value/label/delta come from the caller.
 */
export default function KpiCard({ label, value, delta, icon: Icon, accent = false, tone, testId }) {
  const t = tone ? kpiTones[tone] : null;
  return (
    <div
      className={`kpi-card relative min-w-0 overflow-hidden rounded-[14px] border p-5 shadow-[0_1px_2px_rgba(23,32,28,0.03),0_8px_24px_rgba(23,32,28,0.04)] transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(23,32,28,0.08)] ${
        t
          ? `${t.surface} hover:brightness-[1.015]`
          : "border-[#E2E7E2] bg-white hover:border-[#C7D1C8]"
      }`}
      data-testid={testId}
    >
      {t && <span aria-hidden="true" className={`pointer-events-none absolute inset-0 ${t.glow}`} />}
      <div className="relative z-10 flex items-start justify-between">
        <div className={`text-[10.5px] font-semibold uppercase tracking-[0.11em] ${t ? t.label : "text-[#6B756F]"}`}>
          {label}
        </div>
        {Icon && (
          <div
            className={`flex h-7 w-7 items-center justify-center rounded-md border ${
              t ? t.icon : accent ? "border-[#D9C48C] bg-[#FBF5E8]" : "border-[#E2E7E2] bg-[#F7F8F6]"
            }`}
          >
            <Icon
              size={14}
              strokeWidth={1.5}
              className={t ? t.iconFg : accent ? "text-[#D9A441]" : "text-[#6B756F]"}
            />
          </div>
        )}
      </div>
      <div className={`relative z-10 mt-4 font-display text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${t ? t.value : "text-[#17201C]"}`}>
        {value}
      </div>
      {delta && (
        <div className="relative z-10 mt-3 flex items-center gap-1.5 text-[11.5px]">
          <ArrowUpRight size={12} className="text-[#2F6B4F]" strokeWidth={1.5} />
          <span className="font-medium text-[#2F6B4F]">{delta}</span>
          <span className="text-[#8A9690]">vs last period</span>
        </div>
      )}
    </div>
  );
}
