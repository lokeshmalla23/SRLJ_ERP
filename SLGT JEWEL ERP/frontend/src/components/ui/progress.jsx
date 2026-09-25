import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Progress = forwardRef(({ className, value, ...props }, ref) => (
  <div ref={ref} className={cn("relative h-2 w-full overflow-hidden rounded-full bg-[#e5e7eb]", className)} {...props}>
    <div className="h-full bg-[#0a0a0a] rounded-full transition-all duration-300" style={{ width: `${Math.min(100, Math.max(0, value ?? 0))}%` }} />
  </div>
));
Progress.displayName = "Progress";

export { Progress };
export default Progress;
