import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

// 可折叠分组：标题行本身即展开/收起开关。全局规范：零 border，分层靠背景色阶 + 柔和阴影。
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
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-1 text-left transition-colors hover:bg-tint/50 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="shrink-0 text-[12.5px] font-semibold text-ink-900">{title}</h2>
          {badge && (
            <span className="shrink-0 rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
              {badge}
            </span>
          )}
          {desc && (
            <p className="min-w-0 flex-1 truncate text-[11px] text-ink-400">{desc}</p>
          )}
        </div>
        <ChevronRight
          className={
            "size-3.5 shrink-0 text-ink-400 transition-transform " +
            (open ? "rotate-90" : "")
          }
        />
      </button>
      {open && <div className="mt-px flex flex-col gap-1 px-1 pb-1">{children}</div>}
    </div>
  );
}
