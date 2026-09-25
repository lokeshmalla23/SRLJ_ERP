import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export function toggleVariants({ variant = "default", size = "default", className = "" } = {}) {
  return cn("inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors border border-transparent", className);
}

const Toggle = forwardRef(({ className, variant, size, pressed, onPressedChange, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-pressed={pressed}
    onClick={() => onPressedChange?.(!pressed)}
    className={cn(
      toggleVariants({ variant, size }),
      pressed ? "bg-[#0a0a0a] text-white" : "bg-white text-[#0a0a0a] border-[#e5e7eb] hover:bg-gray-50",
      "h-9 px-3",
      className
    )}
    {...props}
  >
    {children}
  </button>
));
Toggle.displayName = "Toggle";

export { Toggle };
export default Toggle;
