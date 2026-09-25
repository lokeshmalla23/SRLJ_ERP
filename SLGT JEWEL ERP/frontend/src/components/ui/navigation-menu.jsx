import { forwardRef } from "react";
import { cn } from "@/lib/utils";

const NavigationMenu = forwardRef(({ className, children, ...props }, ref) => (
  <nav ref={ref} className={cn("relative z-10 flex max-w-max flex-1 items-center justify-center", className)} {...props}>{children}</nav>
));
NavigationMenu.displayName = "NavigationMenu";
const NavigationMenuList = forwardRef(({ className, children, ...props }, ref) => (
  <ul ref={ref} className={cn("group flex flex-1 list-none items-center justify-center gap-1", className)} {...props}>{children}</ul>
));
NavigationMenuList.displayName = "NavigationMenuList";
const NavigationMenuItem = forwardRef(({ children, ...props }, ref) => (
  <li ref={ref} {...props}>{children}</li>
));
NavigationMenuItem.displayName = "NavigationMenuItem";
const NavigationMenuTrigger = forwardRef(({ className, children, ...props }, ref) => (
  <button ref={ref} className={cn("group inline-flex h-10 w-max items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors hover:bg-accent", className)} {...props}>
    {children}
  </button>
));
NavigationMenuTrigger.displayName = "NavigationMenuTrigger";
const NavigationMenuContent = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("left-0 top-0 w-full md:absolute md:w-auto", className)} {...props}>{children}</div>
));
NavigationMenuContent.displayName = "NavigationMenuContent";
const NavigationMenuLink = forwardRef(({ className, children, ...props }, ref) => (
  <a ref={ref} className={cn("block select-none rounded-md p-3 text-sm leading-none no-underline transition-colors hover:bg-accent", className)} {...props}>{children}</a>
));
NavigationMenuLink.displayName = "NavigationMenuLink";
const NavigationMenuViewport = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("origin-top-center relative mt-1.5 h-[var(--radix-navigation-menu-viewport-height)] w-full overflow-hidden rounded-md border bg-popover shadow-md", className)} {...props} />
));
NavigationMenuViewport.displayName = "NavigationMenuViewport";
const NavigationMenuIndicator = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("top-full z-[1] flex h-1.5 items-end justify-center overflow-hidden", className)} {...props}>
    <div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border shadow-md" />
  </div>
));
NavigationMenuIndicator.displayName = "NavigationMenuIndicator";

export function navigationMenuTriggerStyle() { return ""; }

export {
  NavigationMenu, NavigationMenuList, NavigationMenuItem, NavigationMenuContent,
  NavigationMenuTrigger, NavigationMenuLink, NavigationMenuViewport, NavigationMenuIndicator,
};
