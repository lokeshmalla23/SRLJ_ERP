import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const DropdownMenu = ({ children }) => <>{children}</>;
const DropdownMenuTrigger = forwardRef(({ children, asChild, ...props }, ref) => (
  <span ref={ref} style={{ cursor: "pointer" }} {...props}>{children}</span>
));
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";
const DropdownMenuPortal = ({ children }) => <>{children}</>;
const DropdownMenuContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-32 rounded-md border border-[#e5e7eb] bg-white shadow-md p-1", className)} {...props}>{children}</div>
));
DropdownMenuContent.displayName = "DropdownMenuContent";
const DropdownMenuGroup = ({ children }) => <>{children}</>;
const DropdownMenuItem = forwardRef(({ className, children, inset, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm hover:bg-gray-100 transition-colors", inset && "pl-8", className)} {...props}>{children}</div>
));
DropdownMenuItem.displayName = "DropdownMenuItem";
const DropdownMenuCheckboxItem = forwardRef(({ className, children, checked, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", className)} {...props}>
    <span className="mr-2 w-4">{checked ? "✓" : ""}</span>{children}
  </div>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";
const DropdownMenuRadioGroup = ({ children }) => <>{children}</>;
const DropdownMenuRadioItem = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", className)} {...props}>{children}</div>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";
const DropdownMenuLabel = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("px-2 py-1.5 text-xs font-semibold text-[#737373]", inset && "pl-8", className)} {...props}>{children}</div>
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";
const DropdownMenuSeparator = forwardRef(({ className, ...props }, ref) => (
  <hr ref={ref} className={cn("my-1 border-[#e5e7eb]", className)} {...props} />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";
const DropdownMenuShortcut = ({ className, children, ...props }) => (
  <span className={cn("ml-auto text-xs tracking-widest text-[#a3a3a3]", className)} {...props}>{children}</span>
);
const DropdownMenuSub = ({ children }) => <>{children}</>;
const DropdownMenuSubTrigger = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", inset && "pl-8", className)} {...props}>{children}</div>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";
const DropdownMenuSubContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-32 rounded-md border border-[#e5e7eb] bg-white shadow-md p-1", className)} {...props}>{children}</div>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

export {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup,
  DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub,
  DropdownMenuSubTrigger, DropdownMenuSubContent, DropdownMenuPortal,
};
