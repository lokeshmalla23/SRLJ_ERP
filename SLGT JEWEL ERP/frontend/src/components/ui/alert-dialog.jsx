import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const AlertDialog = ({ open, onOpenChange, children }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
);
const AlertDialogTrigger = ({ children, onClick }) => <span onClick={onClick} style={{ cursor: "pointer" }}>{children}</span>;
const AlertDialogPortal = ({ children }) => <>{children}</>;
const AlertDialogOverlay = forwardRef(({ className, ...props }, ref) => <div ref={ref} className={cn(className)} {...props} />);
AlertDialogOverlay.displayName = "AlertDialogOverlay";
const AlertDialogContent = forwardRef(({ className, children, ...props }, ref) => (
  <DialogContent ref={ref} className={cn(className)} {...props}>{children}</DialogContent>
));
AlertDialogContent.displayName = "AlertDialogContent";
const AlertDialogHeader = ({ className, children }) => <DialogHeader className={cn(className)}>{children}</DialogHeader>;
const AlertDialogFooter = ({ className, children }) => <DialogFooter className={cn(className)}>{children}</DialogFooter>;
const AlertDialogTitle = forwardRef(({ className, children, ...props }, ref) => (
  <DialogTitle ref={ref} className={cn(className)} {...props}>{children}</DialogTitle>
));
AlertDialogTitle.displayName = "AlertDialogTitle";
const AlertDialogDescription = forwardRef(({ className, children, ...props }, ref) => (
  <DialogDescription ref={ref} className={cn(className)} {...props}>{children}</DialogDescription>
));
AlertDialogDescription.displayName = "AlertDialogDescription";
const AlertDialogAction = forwardRef(({ className, children, ...props }, ref) => (
  <Button ref={ref} variant="default" className={cn(className)} {...props}>{children}</Button>
));
AlertDialogAction.displayName = "AlertDialogAction";
const AlertDialogCancel = forwardRef(({ className, children, ...props }, ref) => (
  <Button ref={ref} variant="outline" className={cn(className)} {...props}>{children}</Button>
));
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
  AlertDialog, AlertDialogPortal, AlertDialogOverlay, AlertDialogTrigger,
  AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
};
