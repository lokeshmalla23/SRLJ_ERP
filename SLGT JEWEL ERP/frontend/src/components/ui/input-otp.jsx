import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const InputOTP = forwardRef(({ className, maxLength = 6, value = "", onChange, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center gap-2", className)} {...props}>
    {Array.from({ length: maxLength }).map((_, i) => (
      <input
        key={i}
        type="text"
        maxLength={1}
        value={value[i] ?? ""}
        onChange={(e) => {
          const chars = value.split("");
          chars[i] = e.target.value.slice(-1);
          onChange?.(chars.join(""));
        }}
        className="h-10 w-10 rounded-md border text-center text-sm focus:outline-none focus:ring-2 focus:ring-ring"
      />
    ))}
  </div>
));
InputOTP.displayName = "InputOTP";

const InputOTPGroup = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center", className)} {...props}>{children}</div>
));
InputOTPGroup.displayName = "InputOTPGroup";

const InputOTPSlot = forwardRef(({ index, className, ...props }, ref) => (
  <div ref={ref} className={cn("relative flex h-10 w-10 items-center justify-center border-y border-r text-sm first:rounded-l-md first:border-l last:rounded-r-md", className)} {...props} />
));
InputOTPSlot.displayName = "InputOTPSlot";

const InputOTPSeparator = forwardRef(({ ...props }, ref) => (
  <div ref={ref} role="separator" {...props}><span>-</span></div>
));
InputOTPSeparator.displayName = "InputOTPSeparator";

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator };
