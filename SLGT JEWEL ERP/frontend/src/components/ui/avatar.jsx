import { forwardRef, useState } from "react";
import { cn } from "@/lib/utils";

const Avatar = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full bg-[#e5e7eb]", className)} {...props}>
    {children}
  </div>
));
Avatar.displayName = "Avatar";

const AvatarImage = forwardRef(({ src, alt, className, ...props }, ref) => {
  const [err, setErr] = useState(false);
  if (!src || err) return null;
  return <img ref={ref} src={src} alt={alt} onError={() => setErr(true)} className={cn("h-full w-full object-cover", className)} {...props} />;
});
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = forwardRef(({ className, children, ...props }, ref) => (
  <span ref={ref} className={cn("flex h-full w-full items-center justify-center text-sm font-medium text-[#525252]", className)} {...props}>
    {children}
  </span>
));
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
