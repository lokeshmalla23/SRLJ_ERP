import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Separator = forwardRef(({ className, orientation = "horizontal", decorative, ...props }, ref) => (
  <div
    ref={ref}
    role={decorative ? "none" : "separator"}
    aria-orientation={orientation}
    className={cn(
      "shrink-0 bg-[#e5e7eb]",
      orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
      className
    )}
    {...props}
  />
));
Separator.displayName = "Separator";

export { Separator };
export default Separator;
