import { type HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "brand" | "ok" | "warn" | "danger";

const toneClass: Record<BadgeTone, string> = {
  neutral: "bg-tint text-ink-500",
  brand: "bg-brand-50 text-brand-700",
  ok: "bg-ok-50 text-ok-600",
  warn: "bg-warn-50 text-warn-600",
  danger: "bg-danger-50 text-danger-600",
};

export function Badge({
  className,
  tone = "neutral",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium",
        toneClass[tone],
        className
      )}
      {...props}
    />
  );
}
