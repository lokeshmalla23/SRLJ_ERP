import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Slider = forwardRef(({ className, value, defaultValue, onValueChange, min = 0, max = 100, step = 1, ...props }, ref) => {
  const val = (value?.[0] ?? defaultValue?.[0] ?? min);
  const pct = ((val - min) / (max - min)) * 100;
  return (
    <div ref={ref} className={cn("relative flex w-full touch-none select-none items-center", className)} {...props}>
      <div className="relative h-2 w-full rounded-full bg-[#e5e7eb] overflow-hidden">
        <div className="h-full bg-[#0a0a0a] rounded-full" style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={val}
        onChange={(e) => onValueChange?.([Number(e.target.value)])}
        className="absolute inset-0 w-full opacity-0 cursor-pointer"
      />
    </div>
  );
});
Slider.displayName = "Slider";

export { Slider };
export default Slider;
