import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Label = forwardRef(({ className, children, ...props }, ref) => (
  <label ref={ref} className={cn("block text-sm font-medium text-[#0a0a0a] leading-none", className)} {...props}>
    {children}
  </label>
));
Label.displayName = "Label";

export { Label };
export default Label;
