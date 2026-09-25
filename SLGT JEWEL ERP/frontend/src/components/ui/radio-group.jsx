import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const RadioGroup = forwardRef(({ className, value, onValueChange, children, ...props }, ref) => (
  <div ref={ref} role="radiogroup" className={cn("grid gap-2", className)} {...props}>{children}</div>
));
RadioGroup.displayName = "RadioGroup";

const RadioGroupItem = forwardRef(({ className, value, checked, onChange, id, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="radio"
    id={id}
    aria-checked={checked}
    onClick={() => onChange?.(value)}
    className={cn(
      "h-4 w-4 rounded-full border border-[#e5e7eb] transition-colors focus:outline-none focus:ring-2 focus:ring-[#0a0a0a] focus:ring-offset-1",
      checked ? "border-[#0a0a0a] bg-[#0a0a0a] shadow-[inset_0_0_0_2px_white]" : "bg-white",
      className
    )}
    {...props}
  />
));
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
