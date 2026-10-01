import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import type { RoleRecord } from "../../api";
import { cn } from "../../lib/cn";
import { RoleAvatar } from "../ui/avatar-picker";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { TONE } from "../views/roles/tone";

export type RolePickerDialogProps = {
  open: boolean;
  title?: string;
  description?: string;
  /** 可对话的角色列表（后端 /api/roles）。 */
  roles: RoleRecord[];
  /** 当前选中的角色 id（null 表示未显式绑定，跟随默认主角色）。 */
  value: string | null;
  confirmLabel?: string;
  /** 执行中：锁住按钮，避免重复提交。 */
  busy?: boolean;
  onConfirm: (roleId: string | null) => void;
  onCancel: () => void;
};

/** 角色选择弹窗：新建会话 / 切换当前会话角色时挑选一个角色对话。 */
export function RolePickerDialog({
  open,
  title = "选择对话角色",
  description = "这个会话将由选中的角色来回答，之后可在会话顶部随时切换。",
  roles,
  value,
  confirmLabel = "开始对话",
  busy = false,
  onConfirm,
  onCancel,
}: RolePickerDialogProps) {
  // 每次打开时用外部 value 复位本地选择，避免残留上一次的选择。
  const [selected, setSelected] = useState<string | null>(value);
  useEffect(() => {
    if (open) setSelected(value);
  }, [open, value]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="mt-3 max-h-[46vh] min-h-0 overflow-y-auto pr-1">
          {roles.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-ink-400">暂无可用角色</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {roles.map((role) => {
                const tone = TONE[role.tone] || TONE.brand;
                const active = role.id === selected;
                return (
                  <button
                    key={role.id}
                    type="button"
                    onClick={() => setSelected(role.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-brand-600",
                      active
                        ? "border-brand-500 bg-brand-50/60"
                        : "border-ink-200/70 hover:bg-tint/60"
                    )}
                  >
                    <RoleAvatar
                      name={role.avatar}
                      initial={role.initial}
                      toneClass={tone.avatar}
                      sizeClass="size-9 text-[13px]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-[13.5px] font-medium text-ink-900">
                          {role.name}
                        </span>
                        {role.primary ? (
                          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium", tone.chip)}>
                            主角色
                          </span>
                        ) : null}
                        {!role.model_id ? (
                          <span className="shrink-0 rounded-full bg-warn-50 px-2 py-0.5 text-[10.5px] font-medium text-warn-600">
                            未配置模型
                          </span>
                        ) : null}
                      </span>
                      {role.description ? (
                        <span className="mt-0.5 block truncate text-[12px] text-ink-400">
                          {role.description}
                        </span>
                      ) : null}
                    </span>
                    {active ? (
                      <Check className="size-4 shrink-0 text-brand-600" strokeWidth={2.5} />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button
            variant="primary"
            onClick={() => onConfirm(selected)}
            disabled={busy || roles.length === 0}
          >
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
