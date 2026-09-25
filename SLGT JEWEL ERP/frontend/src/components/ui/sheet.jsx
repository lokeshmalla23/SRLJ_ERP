import { forwardRef, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Sheet = ({ open, onOpenChange, children }) => {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onOpenChange?.(false); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange?.(false)} />
      <div className="relative ml-auto">{children}</div>
    </div>
  );
};

const SheetTrigger = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;
const SheetPortal = ({ children }) => <>{children}</>;
const SheetOverlay = forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn(className)} {...props} />);
SheetOverlay.displayName = "SheetOverlay";

const SheetContent = forwardRef(({ className, children, side = "right", ...props }, ref) => (
  <div
    ref={ref}
    className={cn("h-full w-[400px] bg-white shadow-xl flex flex-col p-6 overflow-y-auto", className)}
    {...props}
  >
    {children}
  </div>
));
SheetContent.displayName = "SheetContent";

const SheetHeader = ({ className, children }) => <div className={cn("flex flex-col gap-2 mb-4", className)}>{children}</div>;
const SheetFooter = ({ className, children }) => <div className={cn("flex justify-end gap-2 mt-auto pt-4", className)}>{children}</div>;

const SheetTitle = forwardRef(({ className, children, ...props }, ref) => (
  <h2 ref={ref} className={cn("text-lg font-semibold text-[#0a0a0a]", className)} {...props}>{children}</h2>
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = forwardRef(({ className, children, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-[#737373]", className)} {...props}>{children}</p>
));
SheetDescription.displayName = "SheetDescription";

const SheetClose = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
