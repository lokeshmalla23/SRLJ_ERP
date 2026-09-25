import * as React from "react"

import { cn } from "@/lib/utils"

const Textarea = React.forwardRef(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[104px] w-full rounded-lg border border-[#E2E7E2] bg-white px-3 py-2.5 text-sm leading-relaxed text-[#17201C] shadow-[0_1px_2px_rgba(23,32,28,0.03)] transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[#8A9690] hover:border-[#B9C8BC] focus-visible:border-[#214F3A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:border-[#E2E7E2] disabled:bg-[#F7F8F6] disabled:text-[#8A9690] disabled:opacity-100 md:text-sm",
        className
      )}
      ref={ref}
      {...props} />
  );
})
Textarea.displayName = "Textarea"

export { Textarea }
