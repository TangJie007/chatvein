import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

export type PickerItem = {
  id: string;
  name: string;
  /** 次要说明（角色说明 / 会话预览）。 */
  desc?: string;
  /** 右侧小标签（如 组长 / 时间）。 */
  meta?: string;
  initial?: string;
  colorClass?: string;
  avatarUrl?: string;
};

type GroupPickerDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  items: PickerItem[];
  confirmLabel?: string;
  emptyText?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (ids: string[]) => void;
};

/** 群组内的通用多选弹窗：邀请成员 / 添加共享会话共用。 */
export function GroupPickerDialog({
  open,
  title,
  description,
  items,
  confirmLabel = "添加",
  emptyText = "没有可添加的选项",
  onOpenChange,
  onConfirm,
}: GroupPickerDialogProps) {
  const [picked, setPicked] = useState<string[]>([]);

  // 每次打开都从空选择开始，避免上一次的勾选串到下一次。
  useEffect(() => {
    if (open) setPicked([]);
  }, [open]);

  const toggle = (id: string) => {
    setPicked((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="max-h-[320px] min-h-[80px] overflow-y-auto rounded-xl bg-page p-1.5">
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
                  onClick={() => toggle(item.id)}
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

        <div className="mt-4 flex items-center justify-end gap-2">
          <span className="mr-auto text-[12px] text-ink-400">
            已选 {picked.length} 项
          </span>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            disabled={picked.length === 0}
            onClick={() => {
              onConfirm(picked);
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
