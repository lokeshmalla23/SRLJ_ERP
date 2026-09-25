import { forwardRef } from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

const Command = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("flex h-full w-full flex-col overflow-hidden rounded-md bg-white", className)} {...props}>
    {children}
  </div>
));
Command.displayName = "Command";

const CommandDialog = ({ children, open, onOpenChange, ...props }) => (
  <Dialog open={open} onOpenChange={onOpenChange} {...props}>
    <DialogContent className="overflow-hidden p-0 shadow-lg">
      <Command>{children}</Command>
    </DialogContent>
  </Dialog>
);

const CommandInput = forwardRef(({ className, ...props }, ref) => (
  <div className="flex items-center border-b px-3">
    <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
    <input ref={ref} className={cn("flex h-11 w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground", className)} {...props} />
  </div>
));
CommandInput.displayName = "CommandInput";

const CommandList = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("max-h-[300px] overflow-y-auto overflow-x-hidden", className)} {...props}>{children}</div>
));
CommandList.displayName = "CommandList";

const CommandEmpty = forwardRef(({ className, children, ...props }, ref) => (
  <div ref={ref} className={cn("py-6 text-center text-sm", className)} {...props}>{children}</div>
));
CommandEmpty.displayName = "CommandEmpty";

const CommandGroup = forwardRef(({ className, heading, children, ...props }, ref) => (
  <div ref={ref} className={cn("overflow-hidden p-1", className)} {...props}>
    {heading && <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{heading}</div>}
    {children}
  </div>
));
CommandGroup.displayName = "CommandGroup";

const CommandSeparator = forwardRef(({ className, ...props }, ref) => (
  <hr ref={ref} className={cn("-mx-1 h-px bg-border", className)} {...props} />
));
CommandSeparator.displayName = "CommandSeparator";

const CommandItem = forwardRef(({ className, children, onSelect, ...props }, ref) => (
  <div ref={ref} className={cn("relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm hover:bg-gray-100", className)} onClick={() => onSelect?.()} {...props}>
    {children}
  </div>
));
CommandItem.displayName = "CommandItem";

const CommandShortcut = ({ className, children, ...props }) => (
  <span className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)} {...props}>{children}</span>
);

export { Command, CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandSeparator, CommandItem, CommandShortcut };
