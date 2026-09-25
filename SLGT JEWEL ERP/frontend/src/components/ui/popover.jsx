import { forwardRef, useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const Popover = ({ children, open: controlledOpen, onOpenChange }) => {
  const [open, setOpen] = useState(false);
  const isOpen = controlledOpen ?? open;
  const toggle = (v) => { setOpen(v); onOpenChange?.(v); };
  return (
    <div className="relative inline-block" data-open={isOpen}>
      {typeof children === "function" ? children({ open: isOpen, toggle }) : children}
    </div>
  );
};

const PopoverTrigger = forwardRef(({ children, asChild, onClick, className, ...props }, ref) => (
  <span ref={ref} className={cn("inline-flex", className)} onClick={onClick} style={{ cursor: "pointer" }} {...props}>{children}</span>
));
PopoverTrigger.displayName = "PopoverTrigger";

const PopoverContent = forwardRef(({ className, children, align = "center", sideOffset = 4, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("absolute left-0 top-full z-50 mt-2 min-w-[200px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#E2E7E2] bg-white p-4 text-[#17201C] shadow-[0_12px_32px_rgba(23,32,28,0.12)] outline-none", className)}
    {...props}
  >
    {children}
  </div>
));
PopoverContent.displayName = "PopoverContent";

const PopoverAnchor = forwardRef(({ children, ...props }, ref) => (
  <span ref={ref} {...props}>{children}</span>
));
PopoverAnchor.displayName = "PopoverAnchor";

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
