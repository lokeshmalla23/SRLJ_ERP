import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "bg-[#0a0a0a] text-white border-transparent",
  secondary: "bg-gray-100 text-gray-800 border-transparent",
  destructive: "bg-red-100 text-red-800 border-transparent",
  outline: "bg-transparent text-[#0a0a0a] border-[#e5e7eb]",
};

export function badgeVariants({ variant = "default", className = "" } = {}) {
  return cn(
    "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
    variants[variant] ?? variants.default,
    className
  );
}

const Badge = forwardRef(({ className, variant = "default", ...props }, ref) => (
  <div ref={ref} className={badgeVariants({ variant, className })} {...props} />
));
Badge.displayName = "Badge";

export { Badge };
