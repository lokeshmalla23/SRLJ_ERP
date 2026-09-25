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
      "inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-[#E2E7E2] bg-white p-0 shadow-[0_1px_1px_rgba(23,32,28,0.03)] transition-[background-color,border-color,box-shadow] duration-150 hover:border-[#B9C8BC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/30 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "border-[#214F3A] bg-[#214F3A] text-white shadow-[0_1px_2px_rgba(23,56,42,0.16)]" : "bg-white",
      className
    )}
    {...props}
  >
    {checked && <Check size={12} strokeWidth={2.5} className="mx-auto" />}
  </button>
));
Checkbox.displayName = "Checkbox";

export { Checkbox };
export default Checkbox;
