import { Wrench } from "lucide-react";
import type { McpToolRecord } from "../../api";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import type { McpServer } from "./prefs";

type McpToolsDrawerProps = {
  server: McpServer | null;
  open: boolean;
  tools: McpToolRecord[];
  loading: boolean;
  error: string | null;
  available?: boolean;
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
};

export function McpToolsDrawer({
  server,
  open,
  tools,
  loading,
  error,
  available = true,
  onOpenChange,
  onRetry,
}: McpToolsDrawerProps) {
  const status =
    !available ? "不可用" : server?.enabled ? "运行中" : "已停止";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {server && (
          <>
            <SheetHeader>
              <SheetTitle className="truncate text-[16px] font-semibold text-ink-900">
                {server.name}
              </SheetTitle>
              <SheetDescription className="mt-1 text-[12.5px] leading-5 text-ink-500">
                {server.desc}
              </SheetDescription>
              <p className="mt-2 text-[11px] text-ink-400">
                {server.transport}
                {server.builtin ? " · 内置" : ""}
                {" · "}
                {status}
                {!loading && !error ? ` · ${tools.length} 个工具` : ""}
              </p>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
              {loading && (
                <p className="px-1 py-6 text-center text-[12.5px] text-ink-400">
                  正在加载工具…
                </p>
              )}

              {!loading && error && (
                <div className="rounded-xl bg-page px-3.5 py-4">
                  <p className="text-[12.5px] font-medium text-ink-900">工具清单加载失败</p>
                  <p className="mt-1 text-[11.5px] leading-4 text-ink-500">{error}</p>
                  <Button variant="tint" size="sm" className="mt-3" onClick={onRetry}>
                    重试
                  </Button>
                </div>
              )}

              {!loading && !error && tools.length === 0 && (
                <p className="px-1 py-6 text-center text-[12.5px] leading-5 text-ink-400">
                  这个服务还没有可展示的工具。
                </p>
              )}

              {!loading && !error && tools.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {tools.map((tool) => (
                    <li key={tool.name} className="rounded-xl bg-page px-3.5 py-3">
                      <div className="flex items-center gap-1.5">
                        <Wrench className="size-3 shrink-0 text-brand-600" strokeWidth={1.75} />
                        <code className="min-w-0 truncate font-mono text-[12.5px] font-semibold text-ink-900">
                          {tool.name}
                        </code>
                      </div>
                      {tool.description && (
                        <p className="mt-1.5 text-[12px] leading-5 text-ink-500">
                          {tool.description}
                        </p>
                      )}
                      <ParamList tool={tool} />
                    </li>
                  ))}
                </ul>
              )}

              {available && server.enabled && (
                <p className="mt-3 px-1 text-[11.5px] leading-4 text-ink-400">
                  服务运行中，相关工具会注入到对话上下文。
                </p>
              )}
              {!available && (
                <p className="mt-3 px-1 text-[11.5px] leading-4 text-ink-400">
                  本机未就绪：内置开关只读，安装依赖并重新扫描后会自动变为运行中。
                </p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ParamList({ tool }: { tool: McpToolRecord }) {
  if (!tool.parameters) return null;
  if (tool.parameters.length === 0) {
    return <p className="mt-2 text-[11px] text-ink-400">无参数</p>;
  }
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {tool.parameters.map((param) => (
        <li key={param.name} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <code className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[11px] text-ink-700">
            {param.name}
          </code>
          <span className="text-[11px] text-ink-400">{param.type}</span>
          {param.required && (
            <span className="text-[11px] font-medium text-brand-700">必填</span>
          )}
          {param.default !== undefined && (
            <span className="text-[11px] text-ink-400">默认 {String(param.default)}</span>
          )}
          {param.description && (
            <span className="min-w-0 text-[11px] text-ink-500">{param.description}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
