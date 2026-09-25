import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const ScrollArea = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("overflow-auto", className)} {...props}>{children}</div>
));
ScrollArea.displayName = "ScrollArea";

const ScrollBar = forwardRef(({ className, orientation = "vertical", ...props }, ref) => (
  <div ref={ref} className={cn(className)} {...props} />
));
ScrollBar.displayName = "ScrollBar";

export { ScrollArea, ScrollBar };
