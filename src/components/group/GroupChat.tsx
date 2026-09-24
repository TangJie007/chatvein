import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { GroupMemberItem } from "./GroupList";

type GroupChatProps = {
  name: string;
  colorClass: string;
  members: GroupMemberItem[];
  /** 加载 / 操作失败时的提示，展示在群组信息条下方。 */
  error?: string | null;
  children: ReactNode;
};

/** 群组视图右栏：顶部一条群组信息 + 下方对话框（由 children 提供）。 */
export function GroupChat({ name, colorClass, members, error, children }: GroupChatProps) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      {/* 群组信息条：固定高度，不参与剩余空间分配 */}
      <div className="flex shrink-0 items-center gap-2 px-6 pt-4 pb-1">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold text-white",
            colorClass
          )}
        >
          {name.slice(0, 1)}
        </span>
        <span className="truncate text-[13px] font-medium text-ink-900">{name}</span>
        <span className="flex items-center -space-x-1.5">
          {members.slice(0, 5).map((m) =>
            m.avatarUrl ? (
              <img
                key={m.id}
                src={m.avatarUrl}
                alt={m.name}
                title={`${m.name} · ${m.roleLabel}`}
                draggable={false}
                className="size-5 rounded-full object-cover ring-2 ring-surface"
              />
            ) : (
              <span
                key={m.id}
                title={`${m.name} · ${m.roleLabel}`}
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[9.5px] font-semibold text-white ring-2 ring-surface",
                  m.colorClass
                )}
              >
                {m.initial}
              </span>
            )
          )}
        </span>
        <span className="shrink-0 text-[11.5px] text-ink-400">
          {members.length} 名成员 · 群对话
        </span>
      </div>

      {error ? (
        <p className="mx-6 mt-1.5 shrink-0 rounded-xl bg-danger-50 px-3 py-2 text-[12.5px] text-danger-600">
          {error}
        </p>
      ) : null}

      {/* 对话框本体：flex-1 + min-h-0 保证输入框留在可视区内 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </section>
  );
}
