import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../../lib/cn";

/** 可折叠面板：标题 + 徽标 + 描述，点击展开 / 收起内容。 */
export function Collapsible({
  title,
  desc,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  desc?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-page p-1 shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-tint/50 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="shrink-0 text-[12.5px] font-semibold text-ink-900">
            {title}
          </h2>
          {badge && (
            <span className="shrink-0 rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
              {badge}
            </span>
          )}
          {desc && (
            <p className="min-w-0 flex-1 truncate text-[11px] text-ink-400">
              {desc}
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 text-ink-400 transition-transform",
            open && "rotate-90"
          )}
        >
          <ChevronRight className="size-3.5" strokeWidth={1.75} />
        </span>
      </button>
      {open && <div className="mt-px flex flex-col gap-3 px-1 pb-1">{children}</div>}
    </div>
  );
}

/** 一行表单：左标签 + 提示，右侧控件。 */
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
    <div className="flex items-center gap-4 rounded-xl bg-surface px-4 py-3 transition-shadow hover:shadow-lift">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">{label}</p>
        {hint && <p className="truncate text-[11px] text-ink-400">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 数值滑块：label + 当前值徽标 + range。 */
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3 transition-shadow hover:shadow-lift">
      <div className="flex min-w-0 items-baseline gap-2">
        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">{label}</p>
        {hint && (
          <p className="min-w-0 flex-1 truncate text-[11px] text-ink-400">
            {hint}
          </p>
        )}
        <span className="shrink-0 rounded-lg bg-page px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700 shadow-soft">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-tint accent-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
      />
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(
        "min-w-0 rounded-xl bg-surface px-3 py-1 text-[12.5px] text-ink-900 placeholder-ink-400 shadow-soft transition-shadow focus:outline-none focus-visible:shadow-lift",
        compact ? "w-[240px]" : "w-full"
      )}
    />
  );
}

export function Textarea({
  value,
  onChange,
  rows = 6,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full min-w-0 resize-none rounded-xl bg-surface px-3 py-2 text-[12px] leading-5 text-ink-900 shadow-soft transition-shadow focus:outline-none focus-visible:shadow-lift"
      />
      {hint && (
        <p className="px-1 text-right text-[10.5px] text-ink-400">{hint}</p>
      )}
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl bg-surface py-1.5 pl-3 pr-7 text-[12.5px] text-ink-900 shadow-soft transition-shadow hover:shadow-lift focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400">
        <ChevronRight className="size-3.5 rotate-90" strokeWidth={1.75} />
      </span>
    </div>
  );
}
