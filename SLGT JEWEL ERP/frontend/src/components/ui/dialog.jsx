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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-[#17382A]/45 backdrop-blur-[2px]" onClick={() => onOpenChange?.(false)} />
      <div className="relative z-10 w-full">{children}</div>
    </div>
  );
};

const DialogTrigger = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;
const DialogPortal = ({ children }) => <>{children}</>;
const DialogOverlay = forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn("fixed inset-0 bg-[#17382A]/45 backdrop-blur-[2px]", className)} {...props} />);
DialogOverlay.displayName = "DialogOverlay";
const DialogClose = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;

const DialogContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-[#E2E7E2] bg-white p-6 text-[#17201C] shadow-[0_24px_60px_rgba(23,32,28,0.16)]", className)} {...props}>
    {children}
  </div>
));
DialogContent.displayName = "DialogContent";

const DialogHeader = ({ className, children }) => <div className={cn("mb-5 flex flex-col gap-2 border-b border-[#E2E7E2] pb-4", className)}>{children}</div>;
const DialogFooter = ({ className, children }) => <div className={cn("mt-6 flex flex-wrap justify-end gap-2 border-t border-[#E2E7E2] pt-4", className)}>{children}</div>;

const DialogTitle = forwardRef(({ className, children, ...props }, ref) => (
  <h2 ref={ref} className={cn("font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-[#17201C]", className)} {...props}>{children}</h2>
));
DialogTitle.displayName = "DialogTitle";

const DialogDescription = forwardRef(({ className, children, ...props }, ref) => (
  <p ref={ref} className={cn("text-[13px] leading-relaxed text-[#6B756F]", className)} {...props}>{children}</p>
));
DialogDescription.displayName = "DialogDescription";

export { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTrigger, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
