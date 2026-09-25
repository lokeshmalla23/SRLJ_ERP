import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

const Collapsible = forwardRef(({ open, onOpenChange, defaultOpen, children, className, ...props }, ref) => {
  const [internal, setInternal] = useState(defaultOpen ?? false);
  const isOpen = open ?? internal;
  return (
    <div ref={ref} className={cn(className)} data-open={isOpen} {...props}>
      {typeof children === "function" ? children({ isOpen, toggle: () => (onOpenChange ?? setInternal)(!isOpen) }) : children}
    </div>
  );
});
Collapsible.displayName = "Collapsible";

const CollapsibleTrigger = forwardRef(({ children, className, ...props }, ref) => (
  <button ref={ref} className={cn(className)} type="button" {...props}>{children}</button>
));
CollapsibleTrigger.displayName = "CollapsibleTrigger";

const CollapsibleContent = forwardRef(({ children, className, ...props }, ref) => (
  <div ref={ref} className={cn(className)} {...props}>{children}</div>
));
CollapsibleContent.displayName = "CollapsibleContent";

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
