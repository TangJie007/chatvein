import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";

type InsightPanelProps = {
  open: boolean;
};

export function InsightPanel({ open }: InsightPanelProps) {
  if (!open) return null;

  return (
    <aside className="flex w-[280px] shrink-0 flex-col bg-list">
      <header className="px-4 pb-3 pt-5">
        <h2 className="text-[13.5px] font-semibold text-ink-900">执行洞察</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-400">
          ReAct 轨迹 / 工具调用 / 产物（占位）
        </p>
      </header>
      <Separator />
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="rounded-xl bg-surface px-3 py-3 text-[12.5px] leading-5 text-ink-500 shadow-soft">
          接入 Agent 运行时后，这里展示思考过程、工具调用与护栏结果。
        </div>
      </ScrollArea>
    </aside>
  );
}
