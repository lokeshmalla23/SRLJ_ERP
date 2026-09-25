import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Menubar = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex h-10 items-center rounded-md border bg-white p-1 gap-1", className)} {...props}>{children}</div>
));
Menubar.displayName = "Menubar";
const MenubarMenu = ({ children }) => <>{children}</>;
const MenubarGroup = ({ children }) => <>{children}</>;
const MenubarPortal = ({ children }) => <>{children}</>;
const MenubarSub = ({ children }) => <>{children}</>;
const MenubarRadioGroup = ({ children }) => <>{children}</>;
const MenubarTrigger = forwardRef(({ className, children, ...props }, ref) => (
  <button ref={ref} className={cn("flex cursor-pointer select-none items-center rounded-sm px-3 py-1.5 text-sm font-medium", className)} {...props}>{children}</button>
));
MenubarTrigger.displayName = "MenubarTrigger";
const MenubarContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-48 rounded-md border bg-white shadow-md p-1", className)} {...props}>{children}</div>
));
MenubarContent.displayName = "MenubarContent";
const MenubarItem = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center rounded-sm px-2 py-1.5 text-sm hover:bg-gray-100", inset && "pl-8", className)} {...props}>{children}</div>
));
MenubarItem.displayName = "MenubarItem";
const MenubarSeparator = forwardRef(({ className, ...props }, ref) => (
  <hr ref={ref} className={cn("my-1 border-gray-100", className)} {...props} />
));
MenubarSeparator.displayName = "MenubarSeparator";
const MenubarLabel = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("px-2 py-1.5 text-xs font-semibold text-gray-500", inset && "pl-8", className)} {...props}>{children}</div>
));
MenubarLabel.displayName = "MenubarLabel";
const MenubarCheckboxItem = forwardRef(({ className, children, checked, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", className)} {...props}>
    <span className="mr-2">{checked ? "✓" : " "}</span>{children}
  </div>
));
MenubarCheckboxItem.displayName = "MenubarCheckboxItem";
const MenubarRadioItem = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", className)} {...props}>{children}</div>
));
MenubarRadioItem.displayName = "MenubarRadioItem";
const MenubarSubTrigger = forwardRef(({ className, inset, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex cursor-pointer items-center px-2 py-1.5 text-sm hover:bg-gray-100 rounded-sm", inset && "pl-8", className)} {...props}>{children}</div>
));
MenubarSubTrigger.displayName = "MenubarSubTrigger";
const MenubarSubContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("z-50 min-w-32 rounded-md border bg-white shadow-md p-1", className)} {...props}>{children}</div>
));
MenubarSubContent.displayName = "MenubarSubContent";
const MenubarShortcut = ({ className, children, ...props }) => (
  <span className={cn("ml-auto text-xs tracking-widest text-gray-400", className)} {...props}>{children}</span>
);

export {
  Menubar, MenubarMenu, MenubarGroup, MenubarPortal, MenubarSub, MenubarRadioGroup,
  MenubarTrigger, MenubarContent, MenubarItem, MenubarSeparator, MenubarLabel,
  MenubarCheckboxItem, MenubarRadioItem, MenubarSubTrigger, MenubarSubContent, MenubarShortcut,
};
