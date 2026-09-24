import { Plus, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { SESSION_CHIP, type SessionItem } from "../chat/SessionList";

export type GroupMemberItem = {
  id: string;
  name: string;
  /** 头像上的单字（无头像图时使用）。 */
  initial: string;
  colorClass: string;
  /** 群内身份，如 组长 / 成员。 */
  roleLabel: string;
  /** 角色头像图片 URL；为空则回落到 initial 色块。 */
  avatarUrl?: string;
};

export type GroupSummary = {
  id: string;
  name: string;
  colorClass: string;
  memberCount: number;
  sessionCount: number;
};

type GroupListProps = {
  groups: GroupSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDeleteGroup: (id: string) => void;
  members: GroupMemberItem[];
  onInvite: () => void;
  onRemoveMember: (id: string) => void;
  sessions: SessionItem[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  /** 把已有会话加进群组的共享会话。 */
  onAddSession: () => void;
  /** 从群组移出（不删除会话本身）。 */
  onRemoveSession: (id: string) => void;
};

/** 群组视图左栏：群组切换 + 成员列表 + 该群组的共享会话。 */
export function GroupList({
  groups,
  activeId,
  onSelect,
  onDeleteGroup,
  members,
  onInvite,
  onRemoveMember,
  sessions,
  activeSessionId,
  onSelectSession,
  onAddSession,
  onRemoveSession,
}: GroupListProps) {
  return (
    <section className="flex w-[220px] min-w-0 shrink-0 flex-col overflow-hidden bg-list select-none">
      {/* 群组切换：固定高度，不参与剩余空间分配 */}
      <div className="shrink-0 px-3 pt-4 pb-2">
        <p className="mb-2 px-1 text-[11px] font-medium text-ink-400">我的群组</p>
        <div className="flex flex-col gap-0.5">
          {groups.length === 0 ? (
            <p className="px-2 py-1 text-[12px] text-ink-400">暂无群组</p>
          ) : (
            groups.map((g) => {
              const active = g.id === activeId;
              return (
                <div
                  key={g.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(g.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(g.id);
                    }
                  }}
                  className={cn(
                    "group flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-brand-600",
                    active ? "bg-surface shadow-soft" : "hover:bg-tint/60"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-lg text-[11px] font-semibold text-white",
                      g.colorClass
                    )}
                  >
                    {g.name.slice(0, 1)}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[12.5px]",
                      active ? "font-medium text-ink-900" : "text-ink-500"
                    )}
                  >
                    {g.name}
                  </span>
                  <button
                    type="button"
                    title="删除群组"
                    aria-label={`删除群组 ${g.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteGroup(g.id);
                    }}
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-md text-ink-300 transition-opacity hover:bg-danger-50 hover:text-danger-600",
                      "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                      "focus-visible:outline-2 focus-visible:outline-brand-600"
                    )}
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 成员 + 共享会话（可滚动） */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3">
        <div className="mb-2 flex items-center gap-1.5 px-1">
          <p className="text-[11px] font-medium text-ink-400">成员</p>
          <span className="rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
            {members.length}
          </span>
          <button
            type="button"
            onClick={onInvite}
            title="添加成员"
            aria-label="添加成员"
            className="ml-auto flex size-5 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-tint hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        <div className="flex flex-col gap-0.5 pb-2">
          {members.length === 0 ? (
            <p className="px-2 py-1 text-[12px] text-ink-400">还没有成员</p>
          ) : (
            members.map((m) => (
              <div
                key={m.id}
                className="group flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-tint/50"
              >
                {m.avatarUrl ? (
                  <img
                    src={m.avatarUrl}
                    alt={m.name}
                    draggable={false}
                    className="size-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white",
                      m.colorClass
                    )}
                  >
                    {m.initial}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-700">
                  {m.name}
                </span>
                <span className="shrink-0 rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
                  {m.roleLabel}
                </span>
                <button
                  type="button"
                  title="移出群组"
                  aria-label={`将 ${m.name} 移出群组`}
                  onClick={() => onRemoveMember(m.id)}
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-ink-300 opacity-0 transition-opacity hover:bg-danger-50 hover:text-danger-600 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="mb-2 mt-2 flex items-center gap-1.5 px-1">
          <p className="text-[11px] font-medium text-ink-400">共享会话</p>
          <span className="rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
            {sessions.length}
          </span>
          <button
            type="button"
            onClick={onAddSession}
            title="添加共享会话"
            aria-label="添加共享会话"
            className="ml-auto flex size-5 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-tint hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Plus className="size-3.5" strokeWidth={2} />
          </button>
        </div>
        <div className="flex flex-col pb-4">
          {sessions.length === 0 ? (
            <p className="px-2 py-1 text-[12px] text-ink-400">还没有共享会话</p>
          ) : (
            sessions.map((s) => {
              const active = s.id === activeSessionId;
              return (
                <div
                  key={s.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSession(s.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectSession(s.id);
                    }
                  }}
                  className={cn(
                    "group mb-1 flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-2xl px-3 py-2.5 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-brand-600",
                    active ? "bg-surface shadow-soft" : "hover:bg-tint/60"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-900">
                      {s.title}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                        SESSION_CHIP[s.tagTone ?? "neutral"]
                      )}
                    >
                      {s.tagLabel}
                    </span>
                    <button
                      type="button"
                      title="从群组移出"
                      aria-label={`将 ${s.title} 移出群组`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSession(s.id);
                      }}
                      className="flex size-5 shrink-0 items-center justify-center rounded-md text-ink-300 opacity-0 transition-opacity hover:bg-danger-50 hover:text-danger-600 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand-600"
                    >
                      <X className="size-3" strokeWidth={2} />
                    </button>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-400">
                      {s.preview}
                    </span>
                    <span className="shrink-0 text-[10.5px] text-ink-400">
                      {s.time}
                    </span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
