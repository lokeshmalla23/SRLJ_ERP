import { forwardRef, useEffect } from "react";
import { cn } from "@/lib/utils";

const Drawer = ({ open, onOpenChange, children }) => {
  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onOpenChange?.(false); };
    if (open) document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="fixed inset-0 bg-black/80" onClick={() => onOpenChange?.(false)} />
      {children}
    </div>
  );
};

const DrawerTrigger = ({ children, onClick }) => (
  <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>
);

const DrawerPortal = ({ children }) => children;
const DrawerClose = ({ children, onClick }) => (
  <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>
);

const DrawerOverlay = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("fixed inset-0 z-50 bg-black/80", className)} {...props} />
));
DrawerOverlay.displayName = "DrawerOverlay";

const DrawerContent = forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("relative z-50 w-full mt-24 flex flex-col rounded-t-[10px] border bg-background", className)}
    {...props}
  >
    <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
    {children}
  </div>
));
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({ className, ...props }) => (
  <div className={cn("grid gap-1.5 p-4 text-center sm:text-left", className)} {...props} />
);

const DrawerFooter = ({ className, ...props }) => (
  <div className={cn("mt-auto flex flex-col gap-2 p-4", className)} {...props} />
);

const DrawerTitle = forwardRef(({ className, ...props }, ref) => (
  <h2 ref={ref} className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />
));
DrawerTitle.displayName = "DrawerTitle";

const DrawerDescription = forwardRef(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DrawerDescription.displayName = "DrawerDescription";

export {
  Drawer, DrawerPortal, DrawerOverlay, DrawerTrigger, DrawerClose,
  DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription,
};
