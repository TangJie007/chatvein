import { Check } from "lucide-react";
import { cn } from "../../lib/cn";

export type PickerItem = {
  id: string;
  name: string;
  /** 次要说明（角色说明 / 会话预览）。 */
  desc?: string;
  /** 右侧小标签（如 主角色 / 条数）。 */
  meta?: string;
  initial?: string;
  colorClass?: string;
  avatarUrl?: string;
};

type PickerOptionListProps = {
  items: PickerItem[];
  picked: string[];
  onToggle: (id: string) => void;
  emptyText?: string;
  className?: string;
};

/** 通用多选列表（建群选成员 / 群组邀请成员共用），自身带滚动容器。 */
export function PickerOptionList({
  items,
  picked,
  onToggle,
  emptyText = "没有可添加的选项",
  className,
}: PickerOptionListProps) {
  return (
    <div
      className={cn(
        "max-h-[260px] min-h-[80px] overflow-y-auto rounded-xl bg-page p-1.5",
        className
      )}
    >
      {items.length === 0 ? (
        <p className="px-2 py-6 text-center text-[12.5px] text-ink-400">
          {emptyText}
        </p>
      ) : (
        items.map((item) => {
          const on = picked.includes(item.id);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors",
                "focus-visible:outline-2 focus-visible:outline-brand-600",
                on ? "bg-brand-50" : "hover:bg-tint/60"
              )}
            >
              {item.avatarUrl ? (
                <img
                  src={item.avatarUrl}
                  alt={item.name}
                  draggable={false}
                  className="size-6 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold text-white",
                    item.colorClass ?? "bg-brand-500"
                  )}
                >
                  {item.initial ?? item.name.slice(0, 1)}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-ink-900">
                  {item.name}
                </span>
                {item.desc ? (
                  <span className="block truncate text-[11.5px] text-ink-400">
                    {item.desc}
                  </span>
                ) : null}
              </span>
              {item.meta ? (
                <span className="shrink-0 rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
                  {item.meta}
                </span>
              ) : null}
              <span
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-md border transition-colors",
                  on
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-ink-200 bg-surface text-transparent"
                )}
              >
                <Check className="size-3" strokeWidth={2.5} />
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}
