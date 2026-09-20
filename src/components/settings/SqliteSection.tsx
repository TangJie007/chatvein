import {
  Copy,
  Database,
  Gauge,
  HardDriveDownload,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { cn } from "../../lib/cn";
import type { DbInfo } from "../../api";
import { Button } from "../ui/button";
import { Card, CardAction, IconButton, Note, Stat } from "./primitives";

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 MB";
  const mb = bytes / 1024 / 1024;
  if (mb < 0.1) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${mb.toFixed(1)} MB`;
}

type SqliteSectionProps = {
  info: DbInfo | null;
  busy: boolean;
  banner: string | null;
  onRefresh: () => void;
  onVacuum: () => void;
  onBackup: () => void;
  onCopyPath: () => void;
};

export function SqliteSection({
  info,
  busy,
  banner,
  onRefresh,
  onVacuum,
  onBackup,
  onCopyPath,
}: SqliteSectionProps) {
  const rows = info ? info.conversations + info.messages : 0;
  const usedRatio = info?.page_count
    ? Math.max(
        0,
        Math.min(100, ((info.page_count - info.free_pages) / info.page_count) * 100)
      )
    : 0;

  return (
    <>
      <Card
        title="数据库文件"
        desc="会话、消息与执行轨迹都落在同一个库；整理会重建文件并回收空闲页"
        icon={<Database className="size-3.5 text-brand-600" strokeWidth={1.75} />}
        action={
          <CardAction
            label={busy ? "处理中…" : "刷新"}
            onClick={onRefresh}
            disabled={busy}
            icon={busy ? Loader2 : RefreshCw}
          />
        }
      >
        <div className="flex flex-col pb-2">
          <div className="flex items-center gap-3 rounded-xl px-3.5 py-3 transition-colors hover:bg-tint/50">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-tint text-brand-600">
              <Database className="size-4" strokeWidth={1.75} />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-mono text-[12.5px] font-medium text-ink-900">
                  {info ? fileNameOf(info.path) : "chatvein.db"}
                </span>
                <span className="shrink-0 rounded-full bg-page px-1.5 py-px text-[10px] text-ink-500">
                  {(info?.journal_mode ?? "wal").toUpperCase()}
                </span>
                {info && !info.exists && (
                  <span className="shrink-0 rounded-full bg-warn-50 px-1.5 py-px text-[10px] font-medium text-warn-600">
                    文件缺失
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-[11.5px] text-ink-500">
                {info
                  ? `会话 ${info.conversations.toLocaleString()} · 消息 ${info.messages.toLocaleString()}`
                  : "正在读取后端…"}
              </p>
              <p className="mt-1 truncate font-mono text-[10.5px] text-ink-400">
                {info?.path ?? "—"}
              </p>
            </div>

            <div className="flex w-[168px] shrink-0 flex-col gap-1.5">
              <div className="flex items-baseline justify-between text-[10.5px]">
                <span className="text-ink-400">{rows.toLocaleString()} 行</span>
                <span className="font-medium text-ink-700">
                  {info ? formatBytes(info.size_bytes) : "—"}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-page">
                <span
                  className="block h-full rounded-full bg-brand-500 transition-all"
                  style={{ width: `${usedRatio}%` }}
                />
              </div>
              <p className="truncate text-[10px] text-ink-400">
                已用页 {usedRatio.toFixed(0)}%
                {info ? ` · 空闲 ${info.free_pages.toLocaleString()} 页` : ""}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <IconButton title="备份到同目录" onClick={onBackup} disabled={busy || !info}>
                <HardDriveDownload className="size-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton title="整理（VACUUM）" onClick={onVacuum} disabled={busy || !info}>
                <Gauge className="size-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton title="复制文件路径" onClick={onCopyPath} disabled={!info}>
                <Copy className="size-3.5" strokeWidth={1.75} />
              </IconButton>
            </div>
          </div>
        </div>

        {banner && (
          <div className="px-3.5 pb-2">
            <p
              className={cn(
                "rounded-xl px-3 py-2 text-[11.5px] leading-4",
                banner.startsWith("失败")
                  ? "bg-warn-50 text-warn-600"
                  : "bg-ok-50 text-ok-600"
              )}
            >
              {banner}
            </p>
          </div>
        )}
      </Card>

      <Card
        title="运行时"
        desc="连接层与向量的实时状态"
        icon={<RefreshCw className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      >
        <div className="grid grid-cols-2 gap-2 px-3.5 pb-3 lg:grid-cols-4">
          <Stat label="引擎版本" value={info?.sqlite_version ?? "—"} />
          <Stat
            label="日志模式"
            value={(info?.journal_mode ?? "—").toUpperCase()}
            tone={info?.journal_mode === "wal" ? "ok" : undefined}
          />
          <Stat label="schema" value={info ? `v${info.schema_version}` : "—"} />
          <Stat
            label="向量扩展"
            value={
              info?.vector_extension.loaded
                ? (info.vector_extension.version ?? "已加载")
                : "不可用"
            }
            tone={info?.vector_extension.loaded ? "ok" : "warn"}
          />
        </div>
        <Note tone={info?.vector_extension.loaded ? "ok" : "warn"}>
          {info?.vector_extension.loaded
            ? "sqlite-vec 已加载，向量与业务数据同库、同事务、同备份"
            : (info?.vector_extension.error ?? "sqlite-vec 未加载，知识库检索将不可用")}
        </Note>
        <div className="px-3.5 pb-3">
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={busy}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            重新读取
          </Button>
        </div>
      </Card>
    </>
  );
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}
