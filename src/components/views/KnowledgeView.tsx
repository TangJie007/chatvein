import { BookOpen, Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useEmbedding } from "../embedding/EmbeddingProvider";
import { CenterHint } from "../layout/CenterHint";
import { Button } from "../ui/button";

export function KnowledgeView() {
  const { ensureReady, status, progress, initOpen, initError, dismissInit } =
    useEmbedding();

  // 进入知识库即确保工作区就绪：本地向量模型未装好时在本内容区
  // 弹出「工作区初始化」遮罩并等待下载完成（下载完成后自动消失）。
  useEffect(() => {
    void ensureReady();
  }, [ensureReady]);

  const downloading = !!status?.downloading;
  const pct = Math.round(Math.min(100, Math.max(0, progress ?? 0)));

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <CenterHint
        title="知识库"
        desc="为多 Agent 共享的检索增强知识来源在此管理。"
        icon={<BookOpen className="size-6" strokeWidth={1.75} />}
      />

      {/* 遮罩仅覆盖知识库内容区，不遮一级导航与窗口操作区 */}
      {initOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-lg bg-ink-900/30 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-lift">
            <h2 className="text-[16px] font-semibold text-ink-900">工作区初始化</h2>
            <p className="mt-1 text-[13px] leading-6 text-ink-400">
              本地向量模型首次使用需下载权重，下载完成后知识库与历史检索即可工作。
            </p>

            <div className="mt-2.5 flex flex-col gap-2.5">
              {downloading ? (
                <>
                  <div className="flex items-center gap-2">
                    <Loader2 className="size-3.5 animate-spin text-brand-600" strokeWidth={2} />
                    <span className="text-[12.5px] text-ink-700">正在下载模型权重…</span>
                    <span className="ml-auto font-mono text-[12px] font-medium text-ink-900">
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-page">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[10.5px] text-ink-400">
                    受网络影响可能较慢，可前往「模型管理」查看详情；下载在后台静默进行，完成后此窗口自动关闭。
                  </p>
                </>
              ) : initError ? (
                <>
                  <p className="rounded-xl bg-warn-50 px-3 py-2 text-[12px] leading-5 text-warn-600">
                    {initError}
                  </p>
                  <p className="text-[10.5px] text-ink-400">
                    下载失败，可关闭后重试，或到「模型管理」检查网络与镜像配置。
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    className="mt-1 self-end"
                    onClick={dismissInit}
                  >
                    关闭
                  </Button>
                </>
              ) : (
                <div className="flex items-center gap-2 py-1">
                  <Loader2 className="size-3.5 animate-spin text-brand-600" strokeWidth={2} />
                  <span className="text-[12.5px] text-ink-700">正在准备本地模型…</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
