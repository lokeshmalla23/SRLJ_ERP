import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variantStyles = {
  default: "border-[#E2E7E2] bg-[#FBFAF6] text-[#17201C]",
  destructive: "border-[#E8C9C5] bg-[#F9ECEA] text-[#9D4B47]",
};

const Alert = forwardRef(({ className, variant = "default", ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(
      "relative w-full rounded-xl border px-4 py-3.5 text-sm shadow-[0_1px_2px_rgba(23,32,28,0.03)] transition-colors duration-200 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg~*]:pl-7",
      variantStyles[variant] ?? variantStyles.default,
      className
    )}
    {...props}
  />
));
Alert.displayName = "Alert";

const AlertTitle = forwardRef(({ className, ...props }, ref) => (
  <h5 ref={ref} className={cn("mb-1.5 font-display text-[14px] font-semibold leading-tight tracking-[-0.01em]", className)} {...props} />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-[13px] leading-relaxed [&_p]:leading-relaxed", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
