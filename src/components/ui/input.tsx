import { type InputHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-9 w-full rounded-xl bg-tint/80 px-3 text-[13px] text-ink-900",
        "placeholder:text-ink-400",
        "transition-colors focus:bg-surface focus:shadow-soft focus:outline-none",
        "focus-visible:outline-2 focus-visible:outline-brand-600",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";
