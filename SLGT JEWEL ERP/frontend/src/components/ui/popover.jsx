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

const PopoverTrigger = forwardRef(({ children, asChild, onClick, ...props }, ref) => (
  <span ref={ref} onClick={onClick} style={{ cursor: "pointer" }} {...props}>{children}</span>
));
PopoverTrigger.displayName = "PopoverTrigger";

const PopoverContent = forwardRef(({ className, children, align = "center", sideOffset = 4, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("absolute z-50 top-full mt-1 min-w-[200px] rounded-md border border-[#e5e7eb] bg-white p-4 shadow-md outline-none", className)}
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
