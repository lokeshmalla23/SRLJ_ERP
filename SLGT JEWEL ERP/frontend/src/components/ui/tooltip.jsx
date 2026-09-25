import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

const TooltipProvider = ({ children }) => <>{children}</>;

const Tooltip = ({ children, delayDuration }) => <>{children}</>;

const TooltipTrigger = forwardRef(({ className, children, asChild, ...props }, ref) => (
  <span ref={ref} className={cn("inline-flex", className)} {...props}>{children}</span>
));
TooltipTrigger.displayName = "TooltipTrigger";

const TooltipContent = forwardRef(({ className, children, sideOffset = 4, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("z-50 overflow-hidden rounded-md bg-[#0a0a0a] px-3 py-1.5 text-xs text-white shadow-md animate-in fade-in-0 zoom-in-95", className)}
    {...props}
  >
    {children}
  </div>
));
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
