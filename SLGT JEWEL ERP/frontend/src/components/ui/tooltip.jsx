import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

const TooltipProvider = ({ children }) => <>{children}</>;

const Tooltip = ({ children, delayDuration }) => <>{children}</>;

const TooltipTrigger = forwardRef(({ className, children, asChild, ...props }, ref) => (
  <span ref={ref} className={cn("inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/25", className)} {...props}>{children}</span>
));
TooltipTrigger.displayName = "TooltipTrigger";

const TooltipContent = forwardRef(({ className, children, sideOffset = 4, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("z-50 max-w-[240px] overflow-hidden rounded-lg bg-[#17382A] px-3 py-2 text-[11px] font-medium leading-4 text-white shadow-[0_8px_24px_rgba(23,32,28,0.18)] ring-1 ring-white/10 animate-in fade-in-0 zoom-in-95", className)}
    {...props}
  >
    {children}
  </div>
));
TooltipContent.displayName = "TooltipContent";

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
