import { forwardRef, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Dialog = ({ open, onOpenChange, children }) => {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onOpenChange?.(false); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={() => onOpenChange?.(false)} />
      <div className="relative z-10">{children}</div>
    </div>
  );
};

const DialogTrigger = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;
const DialogPortal = ({ children }) => <>{children}</>;
const DialogOverlay = forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn(className)} {...props} />);
DialogOverlay.displayName = "DialogOverlay";
const DialogClose = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;

const DialogContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto", className)} {...props}>
    {children}
  </div>
));
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, children }) => <div className={cn("flex flex-col gap-1.5 mb-4", className)}>{children}</div>;
const DialogFooter = ({ className, children }) => <div className={cn("flex justify-end gap-2 mt-6", className)}>{children}</div>;

const DialogTitle = forwardRef(({ className, children, ...props }, ref) => (
  <h2 ref={ref} className={cn("text-lg font-semibold text-[#0a0a0a]", className)} {...props}>{children}</h2>
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef(({ className, children, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-[#737373]", className)} {...props}>{children}</p>
));
DialogDescription.displayName = "DialogDescription";

export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
