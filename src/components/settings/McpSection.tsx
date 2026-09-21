import {
  ChevronRight,
  Database,
  FolderClosed,
  Globe,
  Layers,
  Plug,
  RefreshCw,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { mcpCatalog, type McpToolRecord } from "../../api";
import { cn } from "../../lib/cn";
import { Switch } from "../ui/switch";
import { McpToolsDrawer } from "./McpToolsDrawer";
import type { McpKind, McpServer } from "./prefs";
import { Card, CardAction, Note } from "./primitives";

const KIND_ICON: Record<McpKind, LucideIcon> = {
  db: Database,
  fs: FolderClosed,
  web: Globe,
  kb: Layers,
  custom: Plug,
};

const TRANSPORT_TONE: Record<string, string> = {
  本机进程: "bg-brand-50 text-brand-700",
  HTTP: "bg-teal-400/15 text-teal-600",
};

type McpSectionProps = {
  servers: McpServer[];
  onToggle: (id: string) => void;
};

export function McpSection({ servers, onToggle }: McpSectionProps) {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [catalog, setCatalog] = useState<McpToolRecord[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setCatalogError(null);
    try {
      const data = await mcpCatalog();
      setCatalog(data.tools);
    } catch (err) {
      setCatalogError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, [loadCatalog]);

  const selected = servers.find((s) => s.id === openId) ?? null;
  const selectedTools = catalog?.filter((tool) => tool.group === openId) ?? [];

  return (
    <Card
      title="协议服务"
      desc="随应用分发的模型上下文协议服务，开箱即用；关闭后工具不再注入上下文"
      icon={<Plug className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      action={
        <CardAction
          label={loading ? "扫描中…" : "重新扫描"}
          onClick={() => void loadCatalog()}
          disabled={loading}
          icon={RefreshCw}
        />
      }
    >
      <div className="flex flex-col pb-2">
        {servers.map((s) => {
          const Icon = KIND_ICON[s.kind];
          const toolCount = catalog
            ? catalog.filter((tool) => tool.group === s.id).length
            : s.tools;
          return (
            <div
              key={s.id}
              className="flex items-start gap-3 rounded-xl px-3.5 py-3 transition-colors hover:bg-tint/50"
            >
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={open && openId === s.id}
                onClick={() => {
                  if (closeTimer.current !== null) {
                    window.clearTimeout(closeTimer.current);
                    closeTimer.current = null;
                  }
                  setOpenId(s.id);
                  setOpen(true);
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
                    s.enabled ? "bg-tint text-brand-600" : "bg-page text-ink-400"
                  )}
                >
                  <Icon className="size-4" strokeWidth={1.75} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink-900">
                      {s.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-page px-1.5 py-px text-[10px] text-ink-500">
                      {toolCount} 个工具
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-1.5 py-px text-[10px] font-medium",
                        TRANSPORT_TONE[s.transport] ?? TRANSPORT_TONE["本机进程"]
                      )}
                    >
                      {s.transport}
                    </span>
                    {s.builtin && (
                      <span className="shrink-0 rounded-full bg-brand-50 px-1.5 py-px text-[10px] font-medium text-brand-700">
                        内置
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-4 text-ink-500">{s.desc}</p>
                  <div className="mt-1.5 flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-ink-400">
                      <Terminal className="size-3" strokeWidth={1.75} />
                    </span>
                    <code className="min-w-0 truncate rounded-md bg-tint/80 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-500">
                      {s.cmd}
                    </code>
                  </div>
                </div>

                <ChevronRight
                  className="mt-2 size-3.5 shrink-0 text-ink-400"
                  strokeWidth={1.75}
                />
              </button>

              <div className="flex shrink-0 flex-col items-end gap-1.5 pt-0.5">
                <span className="flex items-center gap-1 text-[10.5px]">
                  <span
                    className={cn(
                      "size-1.5 rounded-full",
                      s.enabled ? "bg-ok-500" : "bg-ink-300"
                    )}
                  />
                  <span className={s.enabled ? "text-ok-600" : "text-ink-400"}>
                    {s.enabled ? "运行中" : "已停止"}
                  </span>
                </span>
                <Switch checked={s.enabled} onCheckedChange={() => onToggle(s.id)} />
              </div>
            </div>
          );
        })}
      </div>

      <Note tone={servers.every((s) => !s.enabled) ? "warn" : "ok"}>
        {servers.every((s) => !s.enabled)
          ? "全部服务已停止，Agent 将只能使用纯文本推理，无法调用工具"
          : "启用状态保存在本机，重启后保持不变；点击服务可查看工具清单"}
      </Note>

      <McpToolsDrawer
        server={selected}
        open={open}
        tools={selectedTools}
        loading={loading && catalog === null}
        error={catalog ? null : catalogError}
        onOpenChange={(next) => {
          setOpen(next);
          if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
          }
          if (!next) {
            closeTimer.current = window.setTimeout(() => setOpenId(null), 200);
          }
        }}
        onRetry={() => void loadCatalog()}
      />
    </Card>
  );
}
