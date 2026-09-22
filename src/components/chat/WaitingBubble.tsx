import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

/** 等待最终回复时的吐槽文案（共 10 条，约 6s 随机轮换）。 */
const WAITING_LINES = [
  "疯狂喝咖啡中…",
  "我的小脑袋快要撑不住了…",
  "正在跟工具们开会，稍等一下…",
  "脑回路打结中，解结ing…",
  "翻箱倒柜找答案，请勿打扰…",
  "代码沙箱里跑圈圈，我在外面加油…",
  "认真思考中，不是在发呆（大概）…",
  "正在把复杂问题拆成小块…",
  "工具调用排队中，请保持耐心…",
  "马上就好，再给我一口咖啡的时间…",
] as const;

const ROTATE_MS = 6000;

function pickLine(exclude?: string): string {
  const pool =
    exclude != null
      ? WAITING_LINES.filter((line) => line !== exclude)
      : [...WAITING_LINES];
  if (pool.length === 0) return WAITING_LINES[0];
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] ?? WAITING_LINES[0];
}

/** 机器人等待最终结果：转圈 + 随机吐槽。 */
export function WaitingBubble() {
  const [line, setLine] = useState(() => pickLine());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLine((prev) => pickLine(prev));
    }, ROTATE_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="flex items-center gap-2.5 text-[13px] leading-5 text-ink-500"
      role="status"
      aria-live="polite"
      aria-label="正在生成回复"
    >
      <Loader2
        className="size-4 shrink-0 animate-spin text-brand-600"
        strokeWidth={2}
        aria-hidden
      />
      <span key={line} className="animate-[view-in_0.18s_ease-out]">
        {line}
      </span>
    </div>
  );
}
