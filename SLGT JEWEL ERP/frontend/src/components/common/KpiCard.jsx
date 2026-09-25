import { ArrowUpRight } from "lucide-react";

export default function KpiCard({ label, value, delta, icon: Icon, accent = false, testId }) {
  return (
    <div className="kpi-card" data-testid={testId}>
      <div className="flex items-start justify-between">
        <div className="text-[10.5px] uppercase tracking-[0.11em] font-semibold text-[#737373]">
          {label}
        </div>
        {Icon && (
          <div
            className={`h-7 w-7 rounded-md flex items-center justify-center border ${
              accent
                ? "bg-[#FDFBF7] border-[#EADFBF]"
                : "bg-[#F9FAFB] border-[#E5E7EB]"
            }`}
          >
            <Icon
              size={14}
              strokeWidth={1.5}
              className={accent ? "text-[#B49042]" : "text-[#525252]"}
            />
          </div>
        )}
      </div>
      <div className="mt-4 font-display text-[28px] font-semibold text-[#0A0A0A] leading-none tracking-tight">
        {value}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5 text-[11.5px]">
          <ArrowUpRight size={12} className="text-[#166534]" strokeWidth={1.5} />
          <span className="text-[#166534] font-medium">{delta}</span>
          <span className="text-[#a3a3a3]">vs last period</span>
        </div>
      )}
    </div>
  );
}
