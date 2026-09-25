import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const HoverCard = ({ children }) => <>{children}</>;
const HoverCardTrigger = forwardRef(({ children, asChild, className, ...props }, ref) => (
  <span ref={ref} className={cn(className)} {...props}>{children}</span>
));
HoverCardTrigger.displayName = "HoverCardTrigger";
const HoverCardContent = forwardRef(({ className, children, align = "center", sideOffset = 4, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 w-64 rounded-md border bg-white p-4 shadow-md", className)} {...props}>{children}</div>
));
HoverCardContent.displayName = "HoverCardContent";

export { HoverCard, HoverCardTrigger, HoverCardContent };
