import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variants = {
  default:
    "border border-[#214F3A] bg-[#214F3A] text-white shadow-[0_1px_2px_rgba(23,56,42,0.16)] hover:border-[#17382A] hover:bg-[#17382A] active:bg-[#102B20]",
  destructive:
    "border border-[#9D4B47] bg-[#9D4B47] text-white shadow-[0_1px_2px_rgba(132,61,58,0.16)] hover:border-[#843D3A] hover:bg-[#843D3A] active:bg-[#6F3431]",
  outline:
    "border border-[#E2E7E2] bg-white text-[#214F3A] shadow-[0_1px_1px_rgba(23,32,28,0.03)] hover:border-[#B9C8BC] hover:bg-[#F7F5EF] active:bg-[#F0EEE7]",
  secondary:
    "border border-[#E2E7E2] bg-[#F7F8F6] text-[#214F3A] shadow-[0_1px_1px_rgba(23,32,28,0.03)] hover:border-[#C7D1C8] hover:bg-[#EEF2EE] active:bg-[#E6ECE7]",
  ghost:
    "border border-transparent bg-transparent text-[#214F3A] hover:bg-[#F0F3EF] active:bg-[#E8EEE9]",
  link:
    "h-auto rounded-none border-0 bg-transparent p-0 text-[#214F3A] underline-offset-4 hover:bg-transparent hover:text-[#17382A] hover:underline active:text-[#17382A]",
};

const sizes = {
  default: "h-10 px-4 py-2 text-sm",
  sm: "h-9 px-3 text-xs",
  lg: "h-11 px-5 text-sm",
  icon: "h-10 w-10 p-0",
};

export function buttonVariants({ variant = "default", size = "default", className = "" } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold tracking-[-0.01em] transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FBFAF6] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
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
