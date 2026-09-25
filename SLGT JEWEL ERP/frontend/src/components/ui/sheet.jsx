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
      <div className="absolute inset-0 bg-[#17382A]/45 backdrop-blur-[2px]" onClick={() => onOpenChange?.(false)} />
      <div className="relative ml-auto flex h-full w-full">{children}</div>
    </div>
  );
};

const SheetTrigger = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;
const SheetPortal = ({ children }) => <>{children}</>;
const SheetOverlay = forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn("fixed inset-0 bg-[#17382A]/45 backdrop-blur-[2px]", className)} {...props} />);
SheetOverlay.displayName = "SheetOverlay";

const SheetContent = forwardRef(({ className, children, side = "right", ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex h-full w-[400px] max-w-full flex-col overflow-y-auto border-l border-[#E2E7E2] bg-white p-6 text-[#17201C] shadow-[-12px_0_40px_rgba(23,32,28,0.12)]", className)}
    {...props}
  >
    {children}
  </div>
));
SheetContent.displayName = "SheetContent";

const SheetHeader = ({ className, children }) => <div className={cn("mb-5 flex flex-col gap-2 border-b border-[#E2E7E2] pb-4", className)}>{children}</div>;
const SheetFooter = ({ className, children }) => <div className={cn("mt-auto flex flex-wrap justify-end gap-2 border-t border-[#E2E7E2] pt-4", className)}>{children}</div>;

const SheetTitle = forwardRef(({ className, children, ...props }, ref) => (
  <h2 ref={ref} className={cn("font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[#17201C]", className)} {...props}>{children}</h2>
));
SheetTitle.displayName = "SheetTitle";

const SheetDescription = forwardRef(({ className, children, ...props }, ref) => (
  <p ref={ref} className={cn("text-[13px] leading-relaxed text-[#6B756F]", className)} {...props}>{children}</p>
));
SheetDescription.displayName = "SheetDescription";

const SheetClose = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;

export { Sheet, SheetPortal, SheetOverlay, SheetTrigger, SheetClose, SheetContent, SheetHeader, SheetFooter, SheetTitle, SheetDescription };
