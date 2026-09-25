import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Switch = forwardRef(({ className, checked, onCheckedChange, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onCheckedChange?.(!checked)}
    className={cn(
      "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent p-0 transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
      checked ? "bg-[#214F3A] shadow-[inset_0_1px_2px_rgba(23,56,42,0.18)]" : "bg-[#B8C2BB] shadow-[inset_0_1px_2px_rgba(23,32,28,0.08)]",
      className
    )}
    {...props}
  >
    <span
      className={cn(
        "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-[0_1px_3px_rgba(23,32,28,0.22)] transition-transform duration-200 ease-out",
        checked ? "translate-x-5" : "translate-x-0"
      )}
    />
  </button>
));
Switch.displayName = "Switch";

export { Switch };
export default Switch;
