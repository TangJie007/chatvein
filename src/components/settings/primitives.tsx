import { ChevronRight, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

/** 设置页基础件：与 ModelsView 的卡片语言保持一致（背景色阶 + 柔和阴影，无 border）。 */

export function Card({
  title,
  desc,
  icon,
  action,
  collapsible = false,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  desc?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /** 头部可点击展开 / 收起内容。 */
  collapsible?: boolean;
  /** collapsible 为 true 时的初始展开状态。 */
  defaultOpen?: boolean;
  /** 附加到卡片根节点的类名（如纵向撑满布局）。 */
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const header = (
    <>
      {icon && (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface shadow-soft">
          {icon}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[13px] font-semibold text-ink-900">{title}</h2>
        {desc && <p className="mt-0.5 text-[11.5px] leading-4 text-ink-400">{desc}</p>}
      </div>
    </>
  );
  return (
    <div className={cn("rounded-2xl bg-page p-1.5 shadow-soft", className)}>
      <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            title={open ? "收起" : "展开"}
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left transition-colors hover:bg-tint/40 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <ChevronRight
              className={cn(
                "size-3.5 shrink-0 text-ink-400 transition-transform",
                open && "rotate-90"
              )}
              strokeWidth={1.75}
            />
            {header}
          </button>
        ) : (
          header
        )}
        {action}
      </div>
      {(!collapsible || open) && children}
    </div>
  );
}

export function CardAction({
  label,
  onClick,
  disabled,
  icon,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  const Icon = icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-brand-700 transition-colors hover:bg-tint focus-visible:outline-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-50"
    >
      {Icon && <Icon className="size-3.5" strokeWidth={1.75} />}
      {label}
    </button>
  );
}

export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl px-3 py-1.5 transition-colors hover:bg-tint/50">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">{label}</p>
        {hint && <p className="truncate text-[11px] text-ink-400">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  className?: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "appearance-none rounded-xl bg-surface py-1.5 pl-3 pr-7 text-[12.5px] text-ink-900 shadow-soft transition-shadow hover:shadow-lift focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600",
          className
        )}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronRight
        className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 rotate-90 text-ink-400"
        strokeWidth={1.75}
      />
    </div>
  );
}

export function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="flex size-7 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-surface hover:text-brand-600 hover:shadow-soft focus-visible:outline-2 focus-visible:outline-brand-600 disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-xl bg-surface px-3 py-2.5 shadow-soft">
      <p className="text-[10.5px] text-ink-400">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-[13px] font-semibold",
          tone === "ok" ? "text-ok-600" : tone === "warn" ? "text-warn-600" : "text-ink-900"
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function Note({
  tone = "ok",
  children,
  action,
}: {
  tone?: "ok" | "warn" | "muted";
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-3 mb-3 flex items-center gap-2 rounded-xl px-3 py-2",
        tone === "ok" ? "bg-surface shadow-soft" : "bg-page"
      )}
    >
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          tone === "ok" ? "bg-ok-500" : tone === "warn" ? "bg-warn-500" : "bg-ink-300"
        )}
      />
      <span className="min-w-0 flex-1 text-[11.5px] leading-4 text-ink-500">{children}</span>
      {action}
    </div>
  );
}
