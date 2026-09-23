import { Check, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";

export type CreatingOverlayProps = {
  /** 初始化步骤文案；后续要加步骤（知识库索引 / 技能挂载 / 沙箱预热）只往这里加。 */
  steps: readonly string[];
  /** 进行中的步骤下标；>= steps.length 表示全部完成（显示创建成功）。 */
  active: number;
};

/** 新建会话的初始化遮罩：分阶段展示进度，避免创建一闪而过、用户不知道发生了什么。 */
export function CreatingOverlay({ steps, active }: CreatingOverlayProps) {
  const done = active >= steps.length;
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-surface/70 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
    >
      <div className="w-[300px] rounded-2xl bg-surface p-5 shadow-lift">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "flex size-5 items-center justify-center rounded-full",
              done ? "bg-ok-50 text-ok-600" : "text-brand-600"
            )}
          >
            {done ? (
              <Check className="size-3.5" strokeWidth={2.5} />
            ) : (
              <Loader2 className="size-4 animate-spin" strokeWidth={2} />
            )}
          </span>
          <p className="text-[14px] font-semibold text-ink-900">
            {done ? "创建成功" : "正在初始化工作区"}
          </p>
        </div>
        <ul className="mt-3.5 flex flex-col gap-2.5">
          {steps.map((label, i) => {
            const finished = done || i < active;
            const current = !done && i === active;
            return (
              <li key={label} className="flex items-center gap-2 text-[12.5px]">
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-full",
                    finished ? "text-ok-600" : current ? "text-brand-600" : "text-ink-300"
                  )}
                >
                  {finished ? (
                    <Check className="size-3" strokeWidth={2.5} />
                  ) : current ? (
                    <Loader2 className="size-3 animate-spin" strokeWidth={2.5} />
                  ) : (
                    <span className="size-1.5 rounded-full bg-ink-200" />
                  )}
                </span>
                <span
                  className={cn(
                    finished
                      ? "text-ink-500"
                      : current
                        ? "font-medium text-ink-900"
                        : "text-ink-400"
                  )}
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
