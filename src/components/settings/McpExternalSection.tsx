import { AlertTriangle, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  reconnectMcpServer,
  updateMcpServer,
  type McpApprovalMode,
  type McpExternalServer,
  type McpServerPayload,
  type McpTransport,
} from "../../api";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Card, CardAction, IconButton, Note, Select } from "./primitives";

const TRANSPORTS: readonly McpTransport[] = ["stdio", "sse", "http"];
const APPROVALS: readonly McpApprovalMode[] = ["ask", "auto"];

const STATE_TONE: Record<string, { dot: string; text: string; label: string }> = {
  connected: { dot: "bg-ok-500", text: "text-ok-600", label: "已连接" },
  connecting: { dot: "bg-warn-500", text: "text-warn-600", label: "连接中" },
  error: { dot: "bg-danger-500", text: "text-danger-600", label: "连接失败" },
  idle: { dot: "bg-ink-300", text: "text-ink-400", label: "未连接" },
  closed: { dot: "bg-ink-300", text: "text-ink-400", label: "已断开" },
  missing: { dot: "bg-ink-300", text: "text-ink-400", label: "配置缺失" },
};

type Draft = {
  id: string;
  name: string;
  transport: McpTransport;
  command: string;
  url: string;
  timeout: string;
  approval: McpApprovalMode;
  allowTools: string;
  envText: string;
  headerText: string;
  enabled: boolean;
  secretsChanged: boolean;
};

function emptyDraft(): Draft {
  return {
    id: "",
    name: "",
    transport: "stdio",
    command: "",
    url: "",
    timeout: "30",
    approval: "ask",
    allowTools: "",
    envText: "",
    headerText: "",
    enabled: true,
    secretsChanged: false,
  };
}

function draftOf(server: McpExternalServer): Draft {
  return {
    id: server.id,
    name: server.name,
    transport: server.transport,
    command: server.command,
    url: server.url,
    timeout: String(server.timeout_s),
    approval: server.approval_mode,
    allowTools: server.allow_tools.join(", "),
    envText: "",
    headerText: "",
    enabled: server.enabled,
    secretsChanged: false,
  };
}

/** ``KEY=VALUE`` 每行一条；空文本返回 ``null``（= 不动已存凭据）。 */
function parsePairs(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const out: Record<string, string> = {};
  for (const line of trimmed.split(/\r?\n/)) {
    const item = line.trim();
    if (!item) continue;
    const eq = item.indexOf("=");
    if (eq <= 0) continue;
    out[item.slice(0, eq).trim()] = item.slice(eq + 1).trim();
  }
  return out;
}

export function McpExternalSection() {
  const [servers, setServers] = useState<McpExternalServer[]>([]);
  const [sdkReady, setSdkReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listMcpServers();
      setServers(data.servers);
      setSdkReady(data.available.sdk);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const applyOne = useCallback((next: McpExternalServer) => {
    setServers((prev) => {
      const exists = prev.some((item) => item.id === next.id);
      return exists ? prev.map((item) => (item.id === next.id ? next : item)) : [...prev, next];
    });
  }, []);

  const toggle = useCallback(
    async (server: McpExternalServer, enabled: boolean) => {
      setBusyId(server.id);
      setError(null);
      try {
        applyOne(await updateMcpServer(server.id, { enabled }));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusyId(null);
      }
    },
    [applyOne]
  );

  const reconnect = useCallback(
    async (server: McpExternalServer) => {
      setBusyId(server.id);
      setError(null);
      try {
        applyOne(await reconnectMcpServer(server.id));
        setExpanded(server.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await load();
      } finally {
        setBusyId(null);
      }
    },
    [applyOne, load]
  );

  const remove = useCallback(async (server: McpExternalServer) => {
    if (!window.confirm(`删除外部服务「${server.name}」？它的工具会立刻从角色里消失。`)) return;
    setBusyId(server.id);
    setError(null);
    try {
      await deleteMcpServer(server.id);
      setServers((prev) => prev.filter((item) => item.id !== server.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const submit = useCallback(async () => {
    if (!editing) return;
    setSaving(true);
    setFormError(null);
    const payload: McpServerPayload = {
      name: editing.name.trim(),
      transport: editing.transport,
      command: editing.transport === "stdio" ? editing.command.trim() : "",
      url: editing.transport === "stdio" ? "" : editing.url.trim(),
      approval_mode: editing.approval,
      enabled: editing.enabled,
      timeout_s: Number(editing.timeout) || 30,
      allow_tools: editing.allowTools
        .split(/[,，\s]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    };
    if (editing.secretsChanged) {
      payload.env = parsePairs(editing.envText) ?? {};
      payload.headers = parsePairs(editing.headerText) ?? {};
    }
    try {
      const saved = editing.id
        ? await updateMcpServer(editing.id, payload)
        : await createMcpServer(payload);
      applyOne(saved);
      setEditing(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [applyOne, editing]);

  const activeCount = useMemo(
    () => servers.filter((server) => server.status.state === "connected").length,
    [servers]
  );

  return (
    <Card
      title="外部 MCP 服务"
      desc={`自己填的 stdio / SSE / HTTP 服务，连上后工具进入 mcp-ext::<名称> 分组（已连接 ${activeCount} 个）`}
      icon={<Plus className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      action={
        <div className="flex items-center gap-1">
          <CardAction
            label={loading ? "刷新中…" : "刷新"}
            onClick={() => void load()}
            disabled={loading}
            icon={RefreshCw}
          />
          <CardAction
            label="添加"
            onClick={() => {
              setFormError(null);
              setEditing(emptyDraft());
            }}
            disabled={!sdkReady}
            icon={Plus}
          />
        </div>
      }
    >
      <div className="flex flex-col pb-2">
        {!sdkReady && (
          <Note tone="warn">
            后端没有安装 MCP SDK（<code className="font-mono">pip install mcp</code>），外部服务不会加载。
          </Note>
        )}

        {servers.length === 0 && (
          <div className="mx-3 mb-2 rounded-xl bg-surface px-3.5 py-3 shadow-soft">
            <p className="text-[12.5px] font-medium text-ink-900">还没有外部服务</p>
            <p className="mt-1 text-[11.5px] leading-4 text-ink-500">
              点右上角「添加」，填启动命令（如{" "}
              <code className="font-mono">
                npx -y @modelcontextprotocol/server-filesystem D:\docs
              </code>
              ）或 SSE 地址。连上后它的工具会出现在角色可选工具里。
            </p>
          </div>
        )}

        {servers.map((server) => {
          const tone = STATE_TONE[server.status.state] ?? STATE_TONE.idle;
          const busy = busyId === server.id;
          const detail = server.transport === "stdio" ? server.command : server.url;
          return (
            <div
              key={server.id}
              className="rounded-xl px-3.5 py-3 transition-colors hover:bg-tint/50"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => (prev === server.id ? null : server.id))
                      }
                      className="max-w-full truncate text-[13px] font-semibold text-ink-900 hover:text-brand-700"
                      title={server.status.error ?? "查看工具"}
                    >
                      {server.name}
                    </button>
                    <span className="shrink-0 rounded-full bg-page px-1.5 py-px text-[10px] text-ink-500">
                      {server.tools.length} 个工具
                    </span>
                    <span className="shrink-0 rounded-full bg-teal-400/15 px-1.5 py-px text-[10px] font-medium text-teal-600">
                      {server.transport.toUpperCase()}
                    </span>
                    <span className="shrink-0 rounded-full bg-page px-1.5 py-px text-[10px] text-ink-500">
                      {server.approval_mode === "ask" ? "每次确认" : "自动执行"}
                    </span>
                  </div>

                  <code className="mt-1.5 block min-w-0 truncate rounded-md bg-tint/80 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-500">
                    {detail || "（未配置地址）"}
                  </code>

                  <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px]">
                    <span className={cn("size-1.5 rounded-full", tone.dot)} />
                    <span className={tone.text}>
                      {busy ? "处理中…" : tone.label}
                      {server.status.state === "connected" &&
                        ` · ${server.status.tool_count} 个工具`}
                    </span>
                  </div>

                  {server.status.error && (
                    <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-danger-50/60 px-2 py-1.5 text-[11px] leading-4 text-danger-600">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" strokeWidth={1.75} />
                      <span className="min-w-0 break-words">{server.status.error}</span>
                    </div>
                  )}

                  {expanded === server.id && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {server.tools.length === 0 && (
                        <span className="text-[11px] text-ink-400">
                          尚未发现工具，点「重连」拉取
                        </span>
                      )}
                      {server.tools.map((tool) => (
                        <span
                          key={tool.name}
                          title={tool.description || tool.name}
                          className={cn(
                            "rounded-md px-1.5 py-0.5 font-mono text-[10.5px]",
                            tool.enabled
                              ? "bg-brand-50 text-brand-700"
                              : "bg-page text-ink-400 line-through"
                          )}
                        >
                          {tool.name}
                        </span>
                      ))}
                      {server.env_keys.length > 0 && (
                        <span className="text-[10.5px] text-ink-400">
                          已存凭据：{server.env_keys.join(", ")}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Switch
                    checked={server.enabled}
                    disabled={busy}
                    onCheckedChange={(next) => void toggle(server, next)}
                    aria-label="启用"
                  />
                  <IconButton
                    title="重连并刷新工具"
                    onClick={() => void reconnect(server)}
                    disabled={busy || !server.enabled}
                  >
                    <RefreshCw
                      className={cn("size-3.5", busy && "animate-spin")}
                      strokeWidth={1.75}
                    />
                  </IconButton>
                  <IconButton
                    title="编辑"
                    onClick={() => {
                      setFormError(null);
                      setEditing(draftOf(server));
                    }}
                  >
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </IconButton>
                  <IconButton title="删除" onClick={() => void remove(server)} disabled={busy}>
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </IconButton>
                </div>
              </div>
            </div>
          );
        })}

        {error && (
          <Note
            tone="warn"
            action={
              <Button size="sm" onClick={() => void load()}>
                重试
              </Button>
            }
          >
            {error}
          </Note>
        )}
      </div>

      <Note tone="muted">
        命令类服务由本机进程拉起，退出应用时一并结束；远程地址只允许 http / https。
        凭据（环境变量 / 请求头）加密保存在本机，界面只显示键名。
      </Note>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "编辑外部服务" : "添加外部服务"}</DialogTitle>
            <DialogDescription>
              保存后会立即尝试连接；连不上不影响其它功能，修好再点重连即可。
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="flex flex-col gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-[11.5px] text-ink-500">名称</span>
                <Input
                  value={editing.name}
                  placeholder="如 filesystem"
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </label>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-ink-500">传输</span>
                  <Select
                    value={editing.transport}
                    options={TRANSPORTS}
                    className="w-full"
                    onChange={(value) =>
                      setEditing({ ...editing, transport: value as McpTransport })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-ink-500">审批</span>
                  <Select
                    value={editing.approval}
                    options={APPROVALS}
                    className="w-full"
                    onChange={(value) =>
                      setEditing({ ...editing, approval: value as McpApprovalMode })
                    }
                  />
                </label>
              </div>

              {editing.transport === "stdio" ? (
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-ink-500">启动命令</span>
                  <Input
                    value={editing.command}
                    placeholder="npx -y @modelcontextprotocol/server-filesystem D:\docs"
                    onChange={(e) => setEditing({ ...editing, command: e.target.value })}
                  />
                </label>
              ) : (
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-ink-500">地址</span>
                  <Input
                    value={editing.url}
                    placeholder={
                      editing.transport === "sse"
                        ? "http://127.0.0.1:3000/sse"
                        : "http://127.0.0.1:3000/mcp"
                    }
                    onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                  />
                </label>
              )}

              <div className="grid grid-cols-2 gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-ink-500">超时（秒）</span>
                  <Input
                    value={editing.timeout}
                    inputMode="numeric"
                    onChange={(e) => setEditing({ ...editing, timeout: e.target.value })}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-ink-500">工具白名单（留空=全部）</span>
                  <Input
                    value={editing.allowTools}
                    placeholder="read_file, list_dir"
                    onChange={(e) => setEditing({ ...editing, allowTools: e.target.value })}
                  />
                </label>
              </div>

              <div className="rounded-xl bg-surface px-3 py-2.5 shadow-soft">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11.5px] text-ink-500">凭据（每行 KEY=VALUE）</span>
                  <button
                    type="button"
                    className="shrink-0 text-[11px] text-brand-700 hover:underline"
                    onClick={() =>
                      setEditing({ ...editing, secretsChanged: true, envText: "", headerText: "" })
                    }
                  >
                    {editing.secretsChanged ? "清空待保存凭据" : "清空已存凭据"}
                  </button>
                </div>
                {editing.id && !editing.secretsChanged && (
                  <p className="mt-1 text-[10.5px] leading-4 text-ink-400">
                    留空表示保留已保存的凭据
                  </p>
                )}
                <Input
                  value={editing.envText}
                  className="mt-1.5 font-mono text-[11.5px]"
                  placeholder="环境变量，如 GITHUB_TOKEN=ghp_xxx"
                  onChange={(e) =>
                    setEditing({ ...editing, secretsChanged: true, envText: e.target.value })
                  }
                />
                <Input
                  value={editing.headerText}
                  className="mt-1.5 font-mono text-[11.5px]"
                  placeholder="请求头（仅远程），如 Authorization=Bearer xxx"
                  onChange={(e) =>
                    setEditing({ ...editing, secretsChanged: true, headerText: e.target.value })
                  }
                />
              </div>

              {formError && (
                <p className="rounded-lg bg-danger-50/60 px-2 py-1.5 text-[11.5px] leading-4 text-danger-600">
                  {formError}
                </p>
              )}

              <div className="mt-1 flex items-center justify-end gap-2">
                {saving && <Loader2 className="size-3.5 animate-spin text-ink-400" />}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditing(null)}
                  disabled={saving}
                >
                  取消
                </Button>
                <Button variant="primary" size="sm" onClick={() => void submit()} disabled={saving}>
                  {saving ? "保存中…" : "保存"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
