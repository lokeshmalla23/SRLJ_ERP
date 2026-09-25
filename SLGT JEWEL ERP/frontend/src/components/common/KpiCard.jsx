import { ArrowUpRight } from "lucide-react";

export default function KpiCard({ label, value, delta, icon: Icon, accent = false, testId }) {
  return (
    <div className="kpi-card min-w-0 rounded-[14px] border border-[#E2E7E2] bg-white p-5 shadow-[0_1px_2px_rgba(23,32,28,0.03),0_8px_24px_rgba(23,32,28,0.04)] transition-[border-color,box-shadow,transform] duration-200 ease-out hover:-translate-y-0.5 hover:border-[#C7D1C8] hover:shadow-[0_8px_24px_rgba(23,32,28,0.08)]" data-testid={testId}>
      <div className="flex items-start justify-between">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-[#6B756F]">
          {label}
        </div>
        {Icon && (
          <div
            className={`h-7 w-7 rounded-md flex items-center justify-center border ${
              accent
                ? "border-[#D9C48C] bg-[#FBF5E8]"
                : "border-[#E2E7E2] bg-[#F7F8F6]"
            }`}
          >
            <Icon
              size={14}
              strokeWidth={1.5}
              className={accent ? "text-[#D9A441]" : "text-[#6B756F]"}
            />
          </div>
        )}
      </div>
      <div className="mt-4 font-display text-[28px] font-semibold leading-none tracking-[-0.02em] text-[#17201C] tabular-nums">
        {value}
      </div>
      {delta && (
        <div className="mt-3 flex items-center gap-1.5 text-[11.5px]">
          <ArrowUpRight size={12} className="text-[#2F6B4F]" strokeWidth={1.5} />
          <span className="font-medium text-[#2F6B4F]">{delta}</span>
          <span className="text-[#8A9690]">vs last period</span>
        </div>
      )}
    </div>
  );
}
