import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const ContextMenu = ({ children }) => <>{children}</>;
const ContextMenuTrigger = forwardRef(({ children, className, ...props }, ref) => (
  <div ref={ref} className={cn(className)} {...props}>{children}</div>
));
ContextMenuTrigger.displayName = "ContextMenuTrigger";
const ContextMenuPortal = ({ children }) => <>{children}</>;
const ContextMenuContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-32 rounded-md border bg-white shadow-md p-1", className)} {...props}>{children}</div>
));
ContextMenuContent.displayName = "ContextMenuContent";
const ContextMenuItem = forwardRef(({ className, children, inset, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-gray-100", inset && "pl-8", className)} {...props}>{children}</div>
));
ContextMenuItem.displayName = "ContextMenuItem";
const ContextMenuCheckboxItem = forwardRef(({ className, children, checked, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", className)} {...props}>
    <span className="mr-2">{checked ? "✓" : " "}</span>{children}
  </div>
));
ContextMenuCheckboxItem.displayName = "ContextMenuCheckboxItem";
const ContextMenuRadioGroup = ({ children }) => <>{children}</>;
const ContextMenuRadioItem = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", className)} {...props}>{children}</div>
));
ContextMenuRadioItem.displayName = "ContextMenuRadioItem";
const ContextMenuLabel = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("px-2 py-1.5 text-xs font-semibold text-gray-500", inset && "pl-8", className)} {...props}>{children}</div>
));
ContextMenuLabel.displayName = "ContextMenuLabel";
const ContextMenuSeparator = forwardRef(({ className, ...props }, ref) => (
  <hr ref={ref} className={cn("my-1 border-gray-100", className)} {...props} />
));
ContextMenuSeparator.displayName = "ContextMenuSeparator";
const ContextMenuShortcut = ({ className, children, ...props }) => (
  <span className={cn("ml-auto text-xs tracking-widest text-gray-400", className)} {...props}>{children}</span>
);
const ContextMenuSub = ({ children }) => <>{children}</>;
const ContextMenuSubTrigger = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", inset && "pl-8", className)} {...props}>{children}</div>
));
ContextMenuSubTrigger.displayName = "ContextMenuSubTrigger";
const ContextMenuSubContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-32 rounded-md border bg-white shadow-md p-1", className)} {...props}>{children}</div>
));
ContextMenuSubContent.displayName = "ContextMenuSubContent";

export {
  ContextMenu, ContextMenuTrigger, ContextMenuPortal, ContextMenuContent,
  ContextMenuItem, ContextMenuCheckboxItem, ContextMenuRadioGroup, ContextMenuRadioItem,
  ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut, ContextMenuSub,
  ContextMenuSubTrigger, ContextMenuSubContent,
};
