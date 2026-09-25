import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { toggleVariants } from "@/components/ui/toggle";

const ToggleGroup = forwardRef(({ className, type = "single", value, onValueChange, children, variant, size, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-1", className)} role="group" {...props}>
    {children}
  </div>
));
ToggleGroup.displayName = "ToggleGroup";

const ToggleGroupItem = forwardRef(({ className, children, value, variant, size, pressed, onClick, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      toggleVariants({ variant, size }),
      pressed ? "bg-[#0a0a0a] text-white" : "bg-white text-[#0a0a0a] border border-[#e5e7eb] hover:bg-gray-50",
      "h-9 px-3 text-sm",
      className
    )}
    onClick={() => onClick?.(value)}
    {...props}
  >
    {children}
  </button>
));
ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
