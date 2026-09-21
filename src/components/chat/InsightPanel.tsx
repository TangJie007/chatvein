import { FileText, FolderOpen, Wrench } from "lucide-react";
import type { ConversationWorkspace } from "../../api";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";

type InsightPanelProps = {
  open: boolean;
  workspace?: ConversationWorkspace | null;
  meta?: {
    difficulty?: string;
    selectedTools?: string[];
    routeReason?: string;
  };
};

export function InsightPanel({ open, workspace, meta }: InsightPanelProps) {
  if (!open) return null;

  const artifacts = workspace?.artifacts ?? [];
  const toolCalls = workspace?.tool_calls ?? [];
  const paths = workspace?.paths ?? {};

  return (
    <aside className="flex w-[280px] shrink-0 flex-col bg-list">
      <header className="px-4 pb-3 pt-5">
        <h2 className="text-[13.5px] font-semibold text-ink-900">执行洞察</h2>
        <p className="mt-0.5 text-[11.5px] text-ink-400">
          工作区 · 工具 · 产物
        </p>
      </header>
      <Separator />
      <ScrollArea className="flex-1 px-4 py-3">
        <div className="flex flex-col gap-3">
          <section className="rounded-xl bg-surface px-3 py-3 shadow-soft">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-700">
              <FolderOpen className="size-3.5" strokeWidth={1.75} />
              会话空间
            </div>
            {workspace?.workspace_dir ? (
              <ul className="space-y-1 text-[11.5px] leading-4 text-ink-500">
                <li className="truncate" title={workspace.workspace_dir}>
                  目录 {workspace.workspace_dir}
                </li>
                {paths.output ? (
                  <li className="truncate" title={paths.output}>
                    产物 output/
                  </li>
                ) : null}
                {paths.runs ? (
                  <li className="truncate" title={paths.runs}>
                    沙箱 runs/
                  </li>
                ) : null}
                {paths.logs ? (
                  <li className="truncate" title={paths.logs}>
                    日志 logs/ · 记忆 {workspace.memory_count}
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="text-[12px] text-ink-400">发送消息后创建工作区</p>
            )}
            {meta?.difficulty ? (
              <p className="mt-2 text-[11.5px] text-ink-400">
                本轮难度 {meta.difficulty}
                {meta.routeReason ? ` · ${meta.routeReason}` : ""}
              </p>
            ) : null}
          </section>

          <section className="rounded-xl bg-surface px-3 py-3 shadow-soft">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-700">
              <Wrench className="size-3.5" strokeWidth={1.75} />
              工具
            </div>
            {meta?.selectedTools && meta.selectedTools.length > 0 ? (
              <p className="mb-2 text-[11.5px] text-ink-500">
                本轮选型：{meta.selectedTools.join(", ")}
              </p>
            ) : null}
            {toolCalls.length === 0 ? (
              <p className="text-[12px] text-ink-400">暂无工具调用记录</p>
            ) : (
              <ul className="space-y-2">
                {[...toolCalls].reverse().slice(0, 8).map((t) => (
                  <li key={t.id} className="text-[11.5px] leading-4 text-ink-600">
                    <span className="font-medium text-ink-800">{t.tool_name}</span>
                    {t.result_text ? (
                      <span className="mt-0.5 line-clamp-3 block text-ink-400">
                        {t.result_text}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl bg-surface px-3 py-3 shadow-soft">
            <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-medium text-ink-700">
              <FileText className="size-3.5" strokeWidth={1.75} />
              产物 output/
            </div>
            {artifacts.length === 0 ? (
              <p className="text-[12px] text-ink-400">尚无产物文件</p>
            ) : (
              <ul className="space-y-1.5">
                {artifacts.map((a) => (
                  <li
                    key={a.path}
                    className="truncate text-[11.5px] text-ink-600"
                    title={a.path}
                  >
                    {a.path}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
