import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

const ResizablePanelGroup = ({ className, ...props }) => (
  <div className={cn("flex h-full w-full", className)} {...props} />
);

const ResizablePanel = ({ className, ...props }) => (
  <div className={cn("flex-1 overflow-auto", className)} {...props} />
);

const ResizableHandle = ({ withHandle, className, ...props }) => (
  <div
    className={cn("relative flex w-px items-center justify-center bg-border", className)}
    {...props}
  >
    {withHandle && (
      <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border bg-border">
        <GripVertical className="h-2.5 w-2.5" />
      </div>
    )}
  </div>
);

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
