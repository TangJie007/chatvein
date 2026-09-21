import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import {
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  forwardRef,
} from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

/** 右侧抽屉：复用 Dialog 的焦点陷阱与遮罩点击关闭，面板从右侧滑入。 */
export const Sheet = DialogPrimitive.Root;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export const SheetContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-ink-900/20",
        "data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out"
      )}
    />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed inset-y-0 right-0 z-50 flex h-full w-full max-w-[420px] flex-col",
        "bg-surface shadow-lift outline-none",
        "data-[state=open]:animate-sheet-in data-[state=closed]:animate-sheet-out",
        className
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 text-ink-400"
          aria-label="关闭"
        >
          <X className="size-4" strokeWidth={1.75} />
        </Button>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = "SheetContent";

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0 px-5 pb-4 pr-12 pt-5", className)} {...props} />;
}
