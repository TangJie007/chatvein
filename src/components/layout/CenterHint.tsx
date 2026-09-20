import { type ReactNode } from "react";
import { cn } from "../../lib/cn";

type CenterHintProps = {
  title: string;
  desc: string;
  icon?: ReactNode;
  alert?: boolean;
  className?: string;
};

export function CenterHint({ title, desc, icon, alert, className }: CenterHintProps) {
  return (
    <section
      className={cn(
        "flex min-w-0 flex-1 flex-col items-center justify-center bg-surface px-6 text-center",
        className
      )}
    >
      <span
        className={cn(
          "mb-4 flex size-14 items-center justify-center rounded-2xl text-[18px] shadow-soft",
          alert ? "bg-danger-50 text-danger-500" : "bg-tint text-brand-500"
        )}
      >
        {icon ?? (alert ? "!" : "•")}
      </span>
      <h1 className="text-[17px] font-semibold text-ink-900">{title}</h1>
      <p className="mt-1.5 max-w-xs text-[13px] leading-6 text-ink-400">{desc}</p>
    </section>
  );
}
