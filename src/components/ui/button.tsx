import { Slot } from "@radix-ui/react-slot";
import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "tint";
export type ButtonSize = "sm" | "md" | "icon";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
};

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-600 text-white shadow-soft hover:bg-brand-700 disabled:opacity-50",
  secondary:
    "bg-surface text-ink-700 shadow-soft hover:bg-tint disabled:opacity-50",
  ghost: "text-ink-500 hover:bg-tint hover:text-ink-700 disabled:opacity-50",
  danger: "bg-danger-600 text-white shadow-soft hover:bg-danger-500 disabled:opacity-50",
  tint: "bg-tint text-ink-700 shadow-soft hover:bg-tint-deep disabled:opacity-50",
};

const sizeClass: Record<ButtonSize, string> = {
  sm: "h-7 rounded-lg px-2.5 text-[12px]",
  md: "h-8 rounded-xl px-3 text-[12.5px]",
  icon: "size-8 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "ghost",
      size = "md",
      asChild = false,
      type = "button",
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        className={cn(
          "inline-flex items-center justify-center gap-1.5 font-medium transition-colors",
          "focus-visible:outline-2 focus-visible:outline-brand-600",
          "disabled:pointer-events-none",
          variantClass[variant],
          sizeClass[size],
          className
        )}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
