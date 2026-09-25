import { Plus } from "lucide-react";
import type { LlmModelRecord, RoleRecord } from "../../../api";
import { cn } from "../../../lib/cn";
import { RoleAvatar } from "../../ui/avatar-picker";
import { modelLabel } from "./roleForm";
import { TONE } from "./tone";

/** 二级导航：角色列表侧栏（列表项 + 顶部计数 + 底部新建按钮）。 */
export function RoleListSidebar({
  roles,
  activeId,
  models,
  onSelect,
  onCreate,
}: {
  roles: RoleRecord[];
  activeId: string;
  models: LlmModelRecord[];
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <section className="flex w-[220px] shrink-0 flex-col bg-list select-none">
      <div className="shrink-0 px-3 pb-1.5 pt-3.5">
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-[11px] font-medium text-ink-400">
            角色 · {roles.length}
          </p>
          <button
            type="button"
            title="新建角色"
            onClick={onCreate}
            className="flex size-5 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-tint hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
        <div className="flex flex-col gap-1">
          {roles.map((r) => {
            const isActive = r.id === activeId;
            const tone = TONE[r.tone] || TONE.brand;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-1.5 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-brand-600",
                  isActive ? "bg-surface shadow-soft" : "hover:bg-tint/60"
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <RoleAvatar
                    name={r.avatar}
                    initial={r.initial}
                    toneClass={tone.avatar}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-[12.5px]",
                      isActive ? "font-medium text-ink-900" : "text-ink-500"
                    )}
                  >
                    {r.name}
                  </span>
                  {r.primary && (
                    <span className="shrink-0 rounded-full bg-brand-50 px-1.5 text-[9.5px] font-medium text-brand-700">
                      主
                    </span>
                  )}
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      r.enabled ? "bg-ok-500" : "bg-ink-300"
                    )}
                  />
                </span>
                <span className="truncate pl-[28px] text-[10px] text-ink-400">
                  {r.description || modelLabel(r.model_id, models)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="shrink-0 px-3 pb-3">
        <button
          type="button"
          onClick={onCreate}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-tint px-3 py-1.5 text-[12.5px] font-medium text-brand-700 shadow-soft transition-colors hover:bg-tint-deep focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          新建角色
        </button>
      </div>
    </section>
  );
}
