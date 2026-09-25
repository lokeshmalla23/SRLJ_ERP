import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const RadioGroup = forwardRef(({ className, value, onValueChange, children, ...props }, ref) => (
  <div ref={ref} role="radiogroup" className={cn("grid gap-3", className)} {...props}>{children}</div>
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
      "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-[#E2E7E2] bg-white p-0 shadow-[0_1px_1px_rgba(23,32,28,0.03)] transition-[background-color,border-color,box-shadow] duration-150 hover:border-[#B9C8BC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/30 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "border-[#214F3A] bg-[#214F3A] shadow-[inset_0_0_0_4px_white]" : "bg-white",
      className
    )}
    {...props}
  />
));
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
