import { forwardRef, useState, createContext, useContext } from "react";
import { cn } from "@/lib/utils";

const TabsCtx = createContext({ active: "", setActive: () => {} });

const Tabs = forwardRef(({ className, value, onValueChange, defaultValue, children, ...props }, ref) => {
  const [internal, setInternal] = useState(defaultValue ?? "");
  const active = value ?? internal;
  const setActive = (v) => { onValueChange?.(v); setInternal(v); };
  return (
    <TabsCtx.Provider value={{ active, setActive }}>
      <div ref={ref} className={cn(className)} {...props}>{children}</div>
    </TabsCtx.Provider>
  );
});
Tabs.displayName = "Tabs";

const TabsList = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("inline-flex items-center rounded-md bg-gray-100 p-1 gap-0.5", className)} {...props}>
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
        "inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition-all",
        isActive ? "bg-white text-[#0a0a0a] shadow-sm" : "text-[#737373] hover:text-[#0a0a0a]",
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
    <div ref={ref} className={cn("mt-2", className)} {...props}>{children}</div>
  );
});
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
