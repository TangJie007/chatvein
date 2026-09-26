import { type ReactNode } from "react";

// 统计小卡：数值 + 标签，用于库详情顶部概览（文档 / 已索引 / 字符 / 引用角色）。
export function Stat({
  value,
  label,
  tone = "text-ink-900",
}: {
  value: ReactNode;
  label: string;
  tone?: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-xl bg-surface px-3 py-2 shadow-soft">
      <span className={"font-mono text-[15px] font-semibold leading-6 " + tone}>
        {value}
      </span>
      <span className="truncate text-[10.5px] text-ink-400">{label}</span>
    </div>
  );
}
