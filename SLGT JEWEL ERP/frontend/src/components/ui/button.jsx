import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "bg-[#0a0a0a] text-white border border-[#0a0a0a] hover:bg-[#1a1a1a]",
  destructive: "bg-red-600 text-white border border-red-600 hover:bg-red-700",
  outline: "bg-white text-[#0a0a0a] border border-[#e5e7eb] hover:bg-gray-50",
  secondary: "bg-gray-100 text-[#0a0a0a] border border-gray-200 hover:bg-gray-200",
  ghost: "bg-transparent text-[#0a0a0a] border border-transparent hover:bg-gray-100",
  link: "bg-transparent text-[#0a0a0a] underline-offset-4 hover:underline border-none p-0 h-auto",
};

const sizes = {
  default: "h-9 px-4 py-2 text-sm",
  sm: "h-8 px-3 text-xs",
  lg: "h-10 px-6 text-sm",
  icon: "h-9 w-9 p-0",
};

export function buttonVariants({ variant = "default", size = "default", className = "" } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
    variants[variant] ?? variants.default,
    sizes[size] ?? sizes.default,
    className
  );
}

const Button = forwardRef(({ className, variant = "default", size = "default", asChild, children, ...props }, ref) => (
  <button ref={ref} className={buttonVariants({ variant, size, className })} {...props}>
    {children}
  </button>
));
Button.displayName = "Button";

export { Button };
export default Button;
