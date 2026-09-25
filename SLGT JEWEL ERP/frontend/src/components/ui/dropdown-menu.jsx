import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const DropdownMenu = ({ children }) => <>{children}</>;
const DropdownMenuTrigger = forwardRef(({ children, asChild, className, ...props }, ref) => (
  <span ref={ref} className={cn("inline-flex", className)} style={{ cursor: "pointer" }} {...props}>{children}</span>
));
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";
const DropdownMenuPortal = ({ children }) => <>{children}</>;
const DropdownMenuContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-40 rounded-xl border border-[#E2E7E2] bg-white p-1.5 text-[#17201C] shadow-[0_12px_32px_rgba(23,32,28,0.12)]", className)} {...props}>{children}</div>
));
DropdownMenuContent.displayName = "DropdownMenuContent";
const DropdownMenuGroup = ({ children }) => <>{children}</>;
const DropdownMenuItem = forwardRef(({ className, children, inset, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer select-none items-center rounded-lg px-3 py-2 text-sm text-[#17201C] transition-colors duration-150 hover:bg-[#F7F5EF] focus-visible:bg-[#F7F5EF] focus-visible:outline-none", inset && "pl-8", className)} {...props}>{children}</div>
));
DropdownMenuItem.displayName = "DropdownMenuItem";
const DropdownMenuCheckboxItem = forwardRef(({ className, children, checked, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm text-[#17201C] transition-colors duration-150 hover:bg-[#F7F5EF] focus-visible:bg-[#F7F5EF] focus-visible:outline-none", className)} {...props}>
    <span className="mr-2 w-4 text-[#214F3A]">{checked ? "✓" : ""}</span>{children}
  </div>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
const DropdownMenuRadioGroup = ({ children }) => <>{children}</>;
const DropdownMenuRadioItem = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm text-[#17201C] transition-colors duration-150 hover:bg-[#F7F5EF] focus-visible:bg-[#F7F5EF] focus-visible:outline-none", className)} {...props}>{children}</div>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";
const DropdownMenuLabel = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#6B756F]", inset && "pl-8", className)} {...props}>{children}</div>
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";
const DropdownMenuSeparator = forwardRef(({ className, ...props }, ref) => (
  <hr ref={ref} className={cn("my-1.5 border-[#E2E7E2]", className)} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
const DropdownMenuShortcut = ({ className, children, ...props }) => (
  <span className={cn("ml-auto text-[10px] font-medium uppercase tracking-[0.12em] text-[#8A9690]", className)} {...props}>{children}</span>
);
const DropdownMenuSub = ({ children }) => <>{children}</>;
const DropdownMenuSubTrigger = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center rounded-lg px-3 py-2 text-sm text-[#17201C] transition-colors duration-150 hover:bg-[#F7F5EF] focus-visible:bg-[#F7F5EF] focus-visible:outline-none", inset && "pl-8", className)} {...props}>{children}</div>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";
const DropdownMenuSubContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-40 rounded-xl border border-[#E2E7E2] bg-white p-1.5 text-[#17201C] shadow-[0_12px_32px_rgba(23,32,28,0.12)]", className)} {...props}>{children}</div>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
  DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal,
};
