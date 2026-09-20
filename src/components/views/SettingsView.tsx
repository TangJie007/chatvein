import { Database, Plug, Settings2, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { dbBackup, dbInfo, dbVacuum, type DbInfo } from "../../api";
import { cn } from "../../lib/cn";
import { AppSection } from "../settings/AppSection";
import { McpSection } from "../settings/McpSection";
import { SqliteSection, formatBytes } from "../settings/SqliteSection";
import {
  hydrateMcpServers,
  loadPrefs,
  saveMcpState,
  savePrefs,
  type AppPrefs,
  type McpServer,
} from "../settings/prefs";

type SectionKey = "app" | "mcp" | "sqlite";

const SECTIONS: {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  hint: string;
}[] = [
  { key: "app", label: "应用设置", icon: Settings2, hint: "外观、启动与隐私" },
  { key: "mcp", label: "内置 MCP", icon: Plug, hint: "随应用分发的协议服务" },
  { key: "sqlite", label: "SQLite", icon: Database, hint: "本地库连接与维护" },
];

export function SettingsView() {
  const [section, setSection] = useState<SectionKey>("app");
  const [prefs, setPrefs] = useState<AppPrefs>(loadPrefs);
  const [servers, setServers] = useState<McpServer[]>(hydrateMcpServers);

  const [info, setInfo] = useState<DbInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const refreshDb = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await dbInfo());
    } catch (err) {
      setInfo(null);
      setBanner(`读取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshDb();
  }, [refreshDb]);

  const setPref = useCallback(
    <K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: value };
        savePrefs(next);
        return next;
      });
    },
    []
  );

  const toggleServer = useCallback((id: string) => {
    setServers((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s));
      saveMcpState(Object.fromEntries(next.map((s) => [s.id, s.enabled])));
      return next;
    });
  }, []);

  const handleVacuum = useCallback(async () => {
    setBusy(true);
    setBanner(null);
    try {
      setInfo(await dbVacuum());
      setBanner("已整理，空闲页已回收");
    } catch (err) {
      setBanner(`整理失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const handleBackup = useCallback(async () => {
    setBusy(true);
    setBanner(null);
    try {
      const result = await dbBackup();
      setBanner(`已备份到 ${result.backup_path}（${formatBytes(result.size_bytes)}）`);
    } catch (err) {
      setBanner(`备份失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  const copyPath = useCallback(async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.path);
      setBanner("路径已复制到剪贴板");
    } catch {
      setBanner("复制失败：当前环境不允许访问剪贴板");
    }
  }, [info]);

  const activeCount = servers.filter((s) => s.enabled).length;
  const toolCount = servers.reduce((n, s) => n + (s.enabled ? s.tools : 0), 0);
  const totalRows = info ? info.conversations + info.messages : 0;

  const meta = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];

  return (
    <>
      {/* 二级导航 */}
      <section className="flex w-[220px] shrink-0 flex-col bg-list select-none">
        <div className="shrink-0 px-3 pb-2 pt-3.5">
          <div className="flex items-center gap-2 px-1 pb-2">
            <Settings2 className="size-3.5 text-ink-400" strokeWidth={1.75} />
            <p className="text-[11px] font-medium text-ink-400">设置</p>
          </div>
          <div className="flex flex-col gap-1">
            {SECTIONS.map(({ key, label, icon: Icon, hint }) => {
              const active = section === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSection(key)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-1.5 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-brand-600",
                    active ? "bg-surface shadow-soft" : "hover:bg-tint/60"
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span className={active ? "text-brand-600" : "text-ink-400"}>
                      <Icon className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[12.5px]",
                        active ? "font-medium text-ink-900" : "text-ink-500"
                      )}
                    >
                      {label}
                    </span>
                  </span>
                  <span className="truncate pl-[23px] text-[10.5px] text-ink-400">
                    {hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 内容区 */}
      <section className="flex min-w-0 flex-1 flex-col bg-surface">
        <header className="flex items-center gap-3 px-6 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-ink-900">
              {meta.label}
            </h1>
            <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
              {SUBTITLE[section]({
                activeCount,
                total: servers.length,
                toolCount,
                info,
                totalRows,
              })}
            </p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="mx-auto flex max-w-[720px] flex-col gap-3">
            {section === "app" && (
              <AppSection prefs={prefs} onSet={setPref} dataDir={dirOf(info?.path)} />
            )}
            {section === "mcp" && (
              <McpSection servers={servers} onToggle={toggleServer} />
            )}
            {section === "sqlite" && (
              <SqliteSection
                info={info}
                busy={busy || loading}
                banner={banner}
                onRefresh={() => void refreshDb()}
                onVacuum={() => void handleVacuum()}
                onBackup={() => void handleBackup()}
                onCopyPath={() => void copyPath()}
              />
            )}
          </div>
        </div>
      </section>
    </>
  );
}

const SUBTITLE: Record<
  SectionKey,
  (ctx: {
    activeCount: number;
    total: number;
    toolCount: number;
    info: DbInfo | null;
    totalRows: number;
  }) => string
> = {
  app: () => "外观、启动行为与隐私 · 偏好即时生效 · 全部保存在本机",
  mcp: ({ activeCount, total, toolCount }) =>
    `${activeCount}/${total} 已启用 · ${toolCount} 个工具可用 · 数据全部存放在本机`,
  sqlite: ({ info, totalRows }) =>
    info
      ? `${totalRows.toLocaleString()} 行 · ${formatBytes(info.size_bytes)} · ${(
          info.journal_mode || "wal"
        ).toUpperCase()} 模式 · schema v${info.schema_version}`
      : "后端未连接，无法读取数据库概况",
};

function dirOf(path: string | undefined): string | null {
  if (!path) return null;
  const index = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return index > 0 ? path.slice(0, index) : path;
}
