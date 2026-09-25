import { forwardRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const Accordion = forwardRef(({ className, children, type = "single", collapsible, ...props }, ref) => (
  <div ref={ref} className={cn("divide-y divide-[#e5e7eb]", className)} {...props}>{children}</div>
));
Accordion.displayName = "Accordion";

const AccordionItem = forwardRef(({ className, children, value, ...props }, ref) => {
  const [open, setOpen] = useState(false);
  return (
    <div ref={ref} className={cn("border-b border-[#e5e7eb]", className)} data-value={value} {...props}>
      {typeof children === "function" ? children({ open, toggle: () => setOpen(!open) }) : children}
    </div>
  );
});
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = forwardRef(({ className, children, onClick, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn("flex w-full items-center justify-between py-4 text-sm font-medium transition-all hover:underline [&[data-open=true]>svg]:rotate-180", className)}
    onClick={onClick}
    {...props}
  >
    {children}
    <ChevronDown size={16} className="transition-transform duration-200" />
  </button>
));
AccordionTrigger.displayName = "AccordionTrigger";

const AccordionContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("pb-4 text-sm", className)} {...props}>{children}</div>
));
AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };
