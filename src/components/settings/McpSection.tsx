import {
  AppWindow,
  ChevronRight,
  Database,
  FileText,
  FolderClosed,
  Globe,
  Layers,
  MapPin,
  Plug,
  RefreshCw,
  ScanText,
  SquareTerminal,
  Terminal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { mcpCatalog, type McpCatalog, type McpToolRecord } from "../../api";
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
  code: Terminal,
  shell: SquareTerminal,
  browser: AppWindow,
  geo: MapPin,
  ocr: ScanText,
  doc: FileText,
  custom: Plug,
};

const TRANSPORT_TONE: Record<string, string> = {
  本机进程: "bg-brand-50 text-brand-700",
  HTTP: "bg-teal-400/15 text-teal-600",
};

type McpSectionProps = {
  servers: McpServer[];
};

/** 本机是否具备该内置服务（探测类看 runtime；其余默认可用；自定义 HTTP 占位不可用）。 */
function isAvailable(
  id: string,
  runtime: McpCatalog["runtime"] | null,
  groups: Record<string, string[]> | null
): boolean {
  if (id === "mcp-http") return false;
  if (id === "mcp-bash") return runtime?.bash.available === true;
  if (id === "mcp-powershell") return runtime?.powershell.available === true;
  if (id === "mcp-browser") {
    // 以探测为准；分组已注册则更可信（避免 toolCount 误判）
    if (runtime?.browser?.available === true) return true;
    if (groups && id in groups) return true;
    return false;
  }
  return true;
}

function unavailableLabel(id: string, runtime: McpCatalog["runtime"] | null): string {
  if (id === "mcp-http") return "尚未接入";
  if (id === "mcp-bash") {
    if (runtime && !runtime.bash.available) {
      return typeof runtime.bash.message === "string" && runtime.bash.message.includes("降级")
        ? "MinGit 不可用，已降级"
        : "未检测到 Git Bash";
    }
  }
  if (id === "mcp-powershell" && runtime && !runtime.powershell.available) {
    return "未检测到 PowerShell";
  }
  if (id === "mcp-browser") {
    const probe = runtime?.browser;
    if (probe && probe.available === false) {
      const detail =
        (typeof probe.message === "string" && probe.message) ||
        (typeof probe.error === "string" && probe.error) ||
        "";
      if (detail.includes("CHATVEIN_USE_BROWSER_TOOL")) return "已关闭浏览器工具";
      if (detail.includes("playwright") || detail.includes("未找到") || detail.includes("未安装")) {
        return "未安装 Playwright 浏览器";
      }
      return "浏览器不可用";
    }
    return "未安装 Playwright 浏览器";
  }
  return "不可用";
}

export function McpSection({ servers }: McpSectionProps) {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [catalog, setCatalog] = useState<McpToolRecord[] | null>(null);
  const [groups, setGroups] = useState<Record<string, string[]> | null>(null);
  const [runtime, setRuntime] = useState<McpCatalog["runtime"] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setCatalogError(null);
    try {
      const data = await mcpCatalog();
      setCatalog(data.tools);
      setGroups(data.groups ?? null);
      setRuntime(data.runtime ?? null);
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
  const selectedAvailable = selected ? isAvailable(selected.id, runtime, groups) : true;

  return (
    <Card
      title="协议服务"
      desc="随应用分发的模型上下文协议服务；状态由本机环境自动决定，开关仅作展示"
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
          const available = isAvailable(s.id, runtime, groups);
          const running = available;
          const statusLabel = running ? "运行中" : unavailableLabel(s.id, runtime);

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
                    running ? "bg-tint text-brand-600" : "bg-page text-ink-400"
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
                      running ? "bg-ok-500" : "bg-ink-300"
                    )}
                  />
                  <span className={running ? "text-ok-600" : "text-ink-400"}>
                    {statusLabel}
                  </span>
                </span>
                {/* 内置 MCP：开关只读，与运行状态对齐，不接受用户切换 */}
                <Switch checked={running} disabled aria-readonly />
              </div>
            </div>
          );
        })}
      </div>

      <Note tone="ok">
        内置服务随本机环境自动启停，开关仅表示状态；点击条目可查看工具清单
      </Note>

      <McpToolsDrawer
        server={
          selected
            ? { ...selected, enabled: selectedAvailable }
            : null
        }
        open={open}
        tools={selectedTools}
        loading={loading && catalog === null}
        error={catalog ? null : catalogError}
        available={selectedAvailable}
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
