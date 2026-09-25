import { forwardRef } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const Checkbox = forwardRef(({ className, checked, onCheckedChange, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="checkbox"
    aria-checked={checked}
    onClick={() => onCheckedChange?.(!checked)}
    className={cn(
      "h-4 w-4 shrink-0 rounded border border-[#e5e7eb] transition-colors focus:outline-none focus:ring-2 focus:ring-[#0a0a0a] focus:ring-offset-1",
      checked ? "bg-[#0a0a0a] border-[#0a0a0a] text-white" : "bg-white",
      className
    )}
    {...props}
  >
    {checked && <Check size={12} strokeWidth={3} className="mx-auto" />}
  </button>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
export default Checkbox;
