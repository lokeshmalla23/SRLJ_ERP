import { forwardRef, useState, createContext, useContext } from "react";
import { cn } from "@/lib/utils";

const TabsCtx = createContext({ active: "", setActive: () => {} });

const Tabs = forwardRef(({ className, value, onValueChange, defaultValue, children, ...props }, ref) => {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const active = value ?? internal;
  const setActive = (v) => { onValueChange?.(v); setInternal(v); };
  return (
    <TabsCtx.Provider value={{ active, setActive }}>
      <div ref={ref} className={cn("w-full", className)} {...props}>{children}</div>
    </TabsCtx.Provider>
  );
});
Tabs.displayName = "Tabs";

const TabsList = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-[#E2E7E2] bg-[#F7F8F6] p-1", className)} {...props}>
    {children}
  </div>
));
TabsList.displayName = "TabsList";

const TabsTrigger = forwardRef(({ className, value, children, ...props }, ref) => {
  const { active, setActive } = useContext(TabsCtx);
  const isActive = active === value;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => setActive(value)}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-lg border border-transparent px-3.5 py-2 text-[13px] font-semibold transition-[background-color,color,border-color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#214F3A]/25",
        isActive ? "border-[#E2E7E2] bg-white text-[#214F3A] shadow-[0_1px_2px_rgba(23,32,28,0.06)]" : "text-[#6B756F] hover:bg-white/70 hover:text-[#214F3A]",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = forwardRef(({ className, value, children, ...props }, ref) => {
  const { active } = useContext(TabsCtx);
  if (active !== value) return null;
  return (
    <div ref={ref} className={cn("mt-4", className)} {...props}>{children}</div>
  );
});
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
