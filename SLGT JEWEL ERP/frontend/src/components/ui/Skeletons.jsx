// Reusable shimmer skeleton components.
// Uses the .shimmer CSS class defined in index.css.
import { useCompany } from "@/context/CompanyContext";
import slgtLogo from "@/assets/slgt-logo.png";
import { APP_WINDOW_TITLE } from "@/lib/appBrand";
import { cn } from "@/lib/utils";

function Box({ className = "" }) {
  return <div className={cn("shimmer rounded-lg", className)} />;
}

// ── Brand badge — small shop-name + spinner marker shown above skeletons ─────
export function PageLoadingBadge() {
  const { displayName, logo } = useCompany();
  return (
    <div className="inline-flex items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#D9C48C] bg-[#214F3A] animate-pulse">
        {logo ? (
          <img src={logo} alt="" className="h-full w-full object-contain bg-white" />
        ) : (
          <img src={slgtLogo} alt={APP_WINDOW_TITLE} className="h-full w-full object-contain" />
        )}
      </div>
      <div className="leading-tight">
        <div className="font-display text-[12.5px] font-semibold text-[#17201C]">
          {displayName}
        </div>
        <div className="text-[9.5px] uppercase tracking-[0.14em] text-[#8A9690]">
          Loading…
        </div>
      </div>
    </div>
  );
}

// ── Table skeleton — realistic rows matching a typical data table ────────────
export function TableSkeleton({ rows = 7, cols = 5 }) {
  const colWidths = ["40%", "20%", "15%", "15%", "10%"];
  return (
    <div className="w-full">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-[#E2E7E2] px-5 py-3.5"
          style={{ opacity: 1 - i * 0.08 }}
        >
          {Array.from({ length: cols }).map((_, j) => (
            <Box
              key={j}
              className="h-4 flex-1"
              style={{ maxWidth: colWidths[j] ?? "auto" }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Card grid skeleton — for product / employee / vendor card grids ──────────
export function CardGridSkeleton({ count = 8, cols = 4 }) {
  return (
    <div
      className="grid gap-5"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="space-y-3 rounded-[14px] border border-[#E2E7E2] bg-white p-5 shadow-[0_1px_2px_rgba(23,32,28,0.03)]"
          style={{ opacity: 1 - i * 0.04 }}
        >
          <Box className="h-36 w-full rounded-lg" />
          <Box className="h-4 w-3/4" />
          <Box className="h-3 w-1/2" />
          <Box className="h-5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

// ── KPI / stat card skeleton — for dashboard summary cards ──────────────────
export function KPISkeleton({ count = 4 }) {
  return (
    <div
      className="grid gap-5"
      style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="space-y-3 rounded-[14px] border border-[#E2E7E2] bg-white p-5 shadow-[0_1px_2px_rgba(23,32,28,0.03)]"
        >
          <div className="flex justify-between items-start">
            <Box className="h-3 w-24" />
            <Box className="h-8 w-8 rounded-full" />
          </div>
          <Box className="h-7 w-32" />
          <Box className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

// ── List skeleton — for simple card/list-item layouts ────────────────────────
export function ListSkeleton({ rows = 6 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-[14px] border border-[#E2E7E2] bg-white p-4 shadow-[0_1px_2px_rgba(23,32,28,0.03)]"
          style={{ opacity: 1 - i * 0.08 }}
        >
          <Box className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Box className="h-4 w-1/3" />
            <Box className="h-3 w-1/2" />
          </div>
          <Box className="h-6 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

// ── Form skeleton — for detail/form pages loading their data ─────────────────
export function FormSkeleton({ fields = 6 }) {
  return (
    <div className="space-y-5 max-w-2xl">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Box className="h-3 w-28" />
          <Box className="h-10 w-full" />
        </div>
      ))}
    </div>
  );
}

// ── Section shimmer — generic full-width placeholder ────────────────────────
export function SectionSkeleton({ height = "h-96" }) {
  return <div className={`${height} shimmer w-full rounded-[14px] border border-[#E2E7E2]`} />;
}
