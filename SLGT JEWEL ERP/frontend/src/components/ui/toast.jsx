import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Toast = forwardRef(({ className, variant, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center gap-3 rounded-lg border p-4 shadow-md text-sm",
      variant === "destructive" ? "bg-red-50 border-red-200 text-red-800" : "bg-white border-[#e5e7eb] text-[#0a0a0a]",
      className
    )}
    {...props}
  >
    {children}
  </div>
));
Toast.displayName = "Toast";

const ToastAction = forwardRef(({ className, children, ...props }, ref) => (
  <button ref={ref} className={cn("ml-auto text-xs font-medium underline", className)} {...props}>{children}</button>
));
ToastAction.displayName = "ToastAction";

const ToastClose = forwardRef(({ className, ...props }, ref) => (
  <button ref={ref} className={cn("ml-auto opacity-50 hover:opacity-100", className)} {...props}>✕</button>
));
ToastClose.displayName = "ToastClose";

const ToastTitle = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("font-semibold", className)} {...props}>{children}</div>
));
ToastTitle.displayName = "ToastTitle";

const ToastDescription = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("text-sm opacity-90", className)} {...props}>{children}</div>
));
ToastDescription.displayName = "ToastDescription";

const ToastProvider = ({ children }) => <>{children}</>;
const ToastViewport = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("fixed top-0 right-0 z-[100] flex flex-col gap-2 p-4 w-[390px]", className)} {...props} />
));
ToastViewport.displayName = "ToastViewport";

export { Toast, ToastAction, ToastClose, ToastTitle, ToastDescription, ToastProvider, ToastViewport };
