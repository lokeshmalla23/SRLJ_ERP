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
    className={cn("flex h-10 w-full items-center justify-between rounded-lg border border-[#E2E7E2] bg-white px-3.5 py-2 text-sm text-[#17201C] shadow-[0_1px_2px_rgba(23,32,28,0.03)] transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[#8A9690] hover:border-[#B9C8BC] focus-visible:border-[#214F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:bg-[#F7F8F6] disabled:text-[#8A9690] disabled:opacity-100", className)}
    onClick={onClick}
    {...props}
  >
    {children}
    <ChevronDown size={15} strokeWidth={1.5} className="ml-2 shrink-0 text-[#6B756F] transition-transform duration-200" />
  </button>
));
SelectTrigger.displayName = "SelectTrigger";

const SelectValue = ({ placeholder, children }) => (
  <span className={cn("min-w-0 flex-1 truncate", children ? "text-[#17201C]" : "text-[#8A9690]")}>{children ?? placeholder}</span>
);

const SelectContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("absolute left-0 top-full z-50 mt-2 max-h-64 w-full min-w-[8rem] overflow-auto rounded-xl border border-[#E2E7E2] bg-white p-1.5 text-[#17201C] shadow-[0_12px_32px_rgba(23,32,28,0.12)] outline-none", className)} {...props}>
    {children}
  </div>
));
SelectContent.displayName = "SelectContent";

const SelectItem = forwardRef(({ className, value, children, onClick, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative flex cursor-pointer select-none items-center rounded-lg px-3 py-2 text-sm text-[#17201C] transition-colors duration-150 hover:bg-[#F7F5EF] focus-visible:bg-[#F7F5EF] focus-visible:outline-none", className)}
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
  <div className={cn("px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6B756F]", className)}>{children}</div>
);
const SelectSeparator = ({ className }) => <hr className={cn("my-1.5 border-[#E2E7E2]", className)} />;
const SelectScrollUpButton = () => null;
const SelectScrollDownButton = () => null;

export {
  Select, SelectTrigger, SelectValue, SelectContent,
  SelectItem, SelectGroup, SelectLabel, SelectSeparator,
  SelectScrollUpButton, SelectScrollDownButton,
};
