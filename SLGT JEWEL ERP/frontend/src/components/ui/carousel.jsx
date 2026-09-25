import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const Carousel = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("relative", className)} role="region" aria-roledescription="carousel" {...props}>
    {children}
  </div>
));
Carousel.displayName = "Carousel";

const CarouselContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex overflow-hidden", className)} {...props}>{children}</div>
));
CarouselContent.displayName = "CarouselContent";

const CarouselItem = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} role="group" aria-roledescription="slide" className={cn("min-w-0 shrink-0 grow-0 basis-full", className)} {...props}>
    {children}
  </div>
));
CarouselItem.displayName = "CarouselItem";

const CarouselPrevious = forwardRef(({ className, ...props }, ref) => (
  <button ref={ref} className={cn("absolute left-2 top-1/2 -translate-y-1/2 rounded-full border bg-white p-2 shadow", className)} {...props}>‹</button>
));
CarouselPrevious.displayName = "CarouselPrevious";

const CarouselNext = forwardRef(({ className, ...props }, ref) => (
  <button ref={ref} className={cn("absolute right-2 top-1/2 -translate-y-1/2 rounded-full border bg-white p-2 shadow", className)} {...props}>›</button>
));
CarouselNext.displayName = "CarouselNext";

const useCarousel = () => ({ canScrollPrev: false, canScrollNext: false, scrollPrev: () => {}, scrollNext: () => {} });

export { Carousel, CarouselContent, CarouselItem, CarouselPrevious, CarouselNext, useCarousel };
