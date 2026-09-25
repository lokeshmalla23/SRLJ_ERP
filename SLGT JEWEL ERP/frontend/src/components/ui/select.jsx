import { forwardRef, useState, useRef, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = ({ children, value, onValueChange, defaultValue }) => {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState(defaultValue ?? "");
  const current = value ?? internal;
  const change = (v) => { onValueChange?.(v); setInternal(v); setOpen(false); };
  return (
    <div className="relative" data-open={open}>
      {typeof children === "function" ? children({ open, setOpen, current, change }) : children}
    </div>
  );
};

const SelectTrigger = forwardRef(({ className, children, onClick, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn("flex h-9 w-full items-center justify-between rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-sm placeholder:text-[#a3a3a3] focus:outline-none focus:ring-2 focus:ring-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-50", className)}
    onClick={onClick}
    {...props}
  >
    {children}
    <ChevronDown size={14} className="opacity-50" />
  </button>
));
SelectTrigger.displayName = "SelectTrigger";

const SelectValue = ({ placeholder, children }) => (
  <span className={children ? "" : "text-[#a3a3a3]"}>{children ?? placeholder}</span>
);

const SelectContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("absolute top-full left-0 z-50 mt-1 w-full rounded-md border border-[#e5e7eb] bg-white shadow-md py-1 max-h-60 overflow-auto", className)} {...props}>
    {children}
  </div>
));
SelectContent.displayName = "SelectContent";

const SelectItem = forwardRef(({ className, value, children, onClick, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative flex cursor-pointer select-none items-center px-3 py-2 text-sm hover:bg-gray-50 transition-colors", className)}
    onClick={() => onClick?.(value)}
    data-value={value}
    {...props}
  >
    {children}
  </div>
));
SelectItem.displayName = "SelectItem";

const SelectGroup = ({ children }) => <>{children}</>;
const SelectLabel = ({ className, children }) => (
  <div className={cn("px-3 py-1.5 text-xs font-semibold text-[#737373]", className)}>{children}</div>
);
const SelectSeparator = ({ className }) => <hr className={cn("my-1 border-[#e5e7eb]", className)} />;
const SelectScrollUpButton = () => null;
const SelectScrollDownButton = () => null;

export {
  Select, SelectTrigger, SelectValue, SelectContent,
  SelectItem, SelectGroup, SelectLabel, SelectSeparator,
  SelectScrollUpButton, SelectScrollDownButton,
};
