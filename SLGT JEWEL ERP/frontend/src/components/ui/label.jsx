import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Label = forwardRef(({ className, children, ...props }, ref) => (
  <label ref={ref} className={cn("block text-[12px] font-semibold leading-5 tracking-[0.01em] text-[#4E5B54]", className)} {...props}>
    {children}
  </label>
));
Label.displayName = "Label";

export { Label };
export default Label;
