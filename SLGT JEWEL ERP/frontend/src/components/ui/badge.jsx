import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "border-[#214F3A] bg-[#214F3A] text-white shadow-[0_1px_1px_rgba(23,56,42,0.12)]",
  secondary: "border-[#E2E7E2] bg-[#F7F8F6] text-[#4E5B54]",
  destructive: "border-[#E8C9C5] bg-[#F9ECEA] text-[#9D4B47]",
  outline: "border-[#D9C48C] bg-white text-[#214F3A]",
};

export function badgeVariants({ variant = "default", className = "" } = {}) {
  return cn(
    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-4 tracking-[0.01em] transition-colors duration-150",
    variants[variant] ?? variants.default,
    className
  );
}

const Badge = forwardRef(({ className, variant = "default", ...props }, ref) => (
  <div ref={ref} className={badgeVariants({ variant, className })} {...props} />
));
Badge.displayName = "Badge";

export { Badge };
