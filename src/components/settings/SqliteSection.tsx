import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Eye,
  Gauge,
  HardDriveDownload,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  Table2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DbColumnInfo, DbInfo, DbTableDetail, DbTableSummary } from "../../api";
import { getDbTableDetail, listDbTables } from "../../api";
import { cn } from "../../lib/cn";
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

export function SqliteSection(props: SqliteSectionProps) {
  const { info, busy, banner } = props;
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
            onClick={props.onRefresh}
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
              <IconButton title="备份到同目录" onClick={props.onBackup} disabled={busy || !info}>
                <HardDriveDownload className="size-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton title="整理（VACUUM）" onClick={props.onVacuum} disabled={busy || !info}>
                <Gauge className="size-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton title="复制文件路径" onClick={props.onCopyPath} disabled={!info}>
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
        collapsible
        defaultOpen={false}
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
          <Button variant="secondary" size="sm" onClick={props.onRefresh} disabled={busy}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
            重新读取
          </Button>
        </div>
      </Card>

      {info && <TablesCard />}
    </>
  );
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/* -------------------------------------------------------------------------- */
/*  表浏览：表列表 + 字段定义 + 数据预览                                        */
/* -------------------------------------------------------------------------- */

const PAGE_SIZE = 20;

function TablesCard() {
  const [tables, setTables] = useState<DbTableSummary[]>([]);
  const [loadingTables, setLoadingTables] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<"data" | "schema">("data");
  const [detail, setDetail] = useState<DbTableDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [page, setPage] = useState(0);

  const loadTables = useCallback(async () => {
    setLoadingTables(true);
    setError(null);
    try {
      const data = await listDbTables();
      setTables(data);
      // 首次加载或当前选择不存在时，默认选中第一张表
      if (data.length) {
        setSelected((prev) => (prev && data.some((t) => t.name === prev) ? prev : data[0].name));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTables([]);
    } finally {
      setLoadingTables(false);
    }
  }, []);

  useEffect(() => {
    void loadTables();
  }, [loadTables]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    getDbTableDetail(selected, PAGE_SIZE, page * PAGE_SIZE)
      .then((d) => {
        if (cancelled) return;
        setDetail(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, page]);

  const totalPages = detail && detail.total != null
    ? Math.max(1, Math.ceil(detail.total / PAGE_SIZE))
    : 1;

  const columnCount = detail?.columns.length ?? 0;

  return (
    <Card
      title="表与数据"
      desc="浏览库中的表 / 视图；点开字段定义或前几行数据"
      icon={<Table2 className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      className="flex min-h-0 flex-1 flex-col"
      action={
        <CardAction
          label={loadingTables ? "加载中…" : "刷新"}
          onClick={() => void loadTables()}
          disabled={loadingTables}
          icon={loadingTables ? Loader2 : RefreshCw}
        />
      }
    >
      {error && (
        <div className="px-3.5 pb-2">
          <p className="rounded-xl bg-warn-50 px-3 py-2 text-[11.5px] text-warn-600">
            {error}
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 px-3.5 pb-3">
        {/* 表列表 */}
        <div className="flex w-[184px] min-h-0 shrink-0 flex-col rounded-xl bg-surface shadow-soft">
          <div className="flex items-center justify-between px-3 py-2 text-[10.5px] text-ink-400">
            <span>表 / 视图</span>
            <span>{tables.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {loadingTables && tables.length === 0 && (
              <div className="flex items-center justify-center px-2 py-6 text-[11px] text-ink-400">
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                加载中…
              </div>
            )}
            {!loadingTables && tables.length === 0 && (
              <div className="px-2 py-6 text-center text-[11px] text-ink-400">
                尚未加载
              </div>
            )}
            {tables.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  setSelected(t.name);
                  setPage(0);
                }}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors",
                  t.name === selected
                    ? "bg-tint text-brand-700"
                    : "text-ink-700 hover:bg-page"
                )}
              >
                {t.type === "view" ? (
                  <Layers className="size-3 shrink-0 text-ink-400" strokeWidth={1.75} />
                ) : (
                  <Table2 className="size-3 shrink-0 text-ink-400" strokeWidth={1.75} />
                )}
                <span className="min-w-0 flex-1 truncate font-mono">{t.name}</span>
                {t.row_count != null && (
                  <span className="shrink-0 text-[10px] text-ink-400">
                    {t.row_count.toLocaleString()}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 详情 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!selected && (
            <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-ink-400">
              <Eye className="mr-2 size-4" strokeWidth={1.75} />
              选择左侧的一张表
            </div>
          )}

          {selected && loadingDetail && (
            <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-ink-400">
              <Loader2 className="mr-2 size-4 animate-spin" strokeWidth={1.75} />
              加载表详情…
            </div>
          )}

          {selected && !loadingDetail && detail && (
            <DetailPanel
              detail={detail}
              tab={tab}
              setTab={setTab}
              page={page}
              setPage={setPage}
              totalPages={totalPages}
              pageSize={PAGE_SIZE}
              columnCount={columnCount}
            />
          )}

          {selected && !loadingDetail && !detail && (
            <div className="flex min-h-0 flex-1 items-center justify-center text-[12px] text-warn-600">
              表详情加载失败
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function DetailPanel({
  detail,
  tab,
  setTab,
  page,
  setPage,
  totalPages,
  pageSize,
  columnCount,
}: {
  detail: DbTableDetail;
  tab: "data" | "schema";
  setTab: (t: "data" | "schema") => void;
  page: number;
  setPage: (n: number) => void;
  totalPages: number;
  pageSize: number;
  columnCount: number;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl bg-surface p-2.5 shadow-soft">
      <div className="flex flex-wrap items-center gap-2 px-1 pb-2">
        <span className="rounded-lg bg-tint px-2 py-1 font-mono text-[12px] font-medium text-brand-700">
          {detail.name}
        </span>
        <span className="rounded-full bg-page px-1.5 py-px text-[10px] uppercase text-ink-500">
          {detail.type}
        </span>
        {detail.total != null && (
          <span className="rounded-full bg-page px-1.5 py-px text-[10px] text-ink-500">
            {detail.total.toLocaleString()} 行
          </span>
        )}
        <span className="rounded-full bg-page px-1.5 py-px text-[10px] text-ink-500">
          {columnCount} 列
        </span>

        <div className="ml-auto flex items-center gap-1">
          <TabButton
            active={tab === "data"}
            onClick={() => setTab("data")}
            label="数据"
            icon={Eye}
          />
          <TabButton
            active={tab === "schema"}
            onClick={() => setTab("schema")}
            label="字段"
            icon={KeyRound}
          />
          {detail.sql && (
            <IconButton
              title="复制建表 SQL"
              onClick={() => void navigator.clipboard.writeText(detail.sql)}
            >
              <Copy className="size-3.5" strokeWidth={1.75} />
            </IconButton>
          )}
        </div>
      </div>

      {tab === "schema" && <SchemaTable columns={detail.columns} sql={detail.sql} />}

      {tab === "data" && (
        <DataTable
          detail={detail}
          page={page}
          setPage={setPage}
          totalPages={totalPages}
          pageSize={pageSize}
        />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: typeof Eye;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors",
        active ? "bg-tint text-brand-700" : "text-ink-500 hover:bg-page"
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {label}
    </button>
  );
}

function SchemaTable({ columns, sql }: { columns: DbColumnInfo[]; sql?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl bg-page p-1.5">
      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-[10.5px] font-medium text-ink-400 shadow-soft">
        <span>列</span>
        <span>类型</span>
        <span>主键</span>
        <span>非空</span>
        <span>默认值</span>
      </div>
      {columns.map((c) => (
        <div
          key={`${c.cid}-${c.name}`}
          className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-[11.5px] shadow-soft"
        >
          <span className="truncate font-mono text-ink-900">{c.name}</span>
          <span className="font-mono text-[10.5px] text-ink-500">{c.type ?? "—"}</span>
          <span className={c.pk ? "text-brand-700" : "text-ink-400"}>
            {c.pk ? "PK" : "—"}
          </span>
          <span className={c.notnull ? "text-ok-600" : "text-ink-400"}>
            {c.notnull ? "YES" : "—"}
          </span>
          <span className="max-w-[120px] truncate font-mono text-[10.5px] text-ink-500">
            {c.default ?? "—"}
          </span>
        </div>
      ))}
      {sql && (
        <div className="rounded-lg bg-surface p-2.5 shadow-soft">
          <p className="mb-1 text-[10.5px] font-medium text-ink-400">建表 SQL</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-4 text-ink-700">
            {sql}
          </pre>
        </div>
      )}
    </div>
  );
}

function DataTable({
  detail,
  page,
  setPage,
  totalPages,
  pageSize,
}: {
  detail: DbTableDetail;
  page: number;
  setPage: (n: number) => void;
  totalPages: number;
  pageSize: number;
}) {
  if (detail.rows.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl bg-page text-[11.5px] text-ink-400">
        此表暂无数据
      </div>
    );
  }
  const start = detail.offset + 1;
  const end = detail.offset + detail.rows.length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-page shadow-soft">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-surface">
              <th className="px-2 py-1.5 text-left font-medium text-ink-400">#</th>
              {detail.columns.map((c) => (
                <th
                  key={`${c.cid}-${c.name}`}
                  title={c.type ?? undefined}
                  className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-ink-700"
                >
                  <span className="inline-flex items-center gap-1 font-mono">
                    {c.name}
                    {c.pk && (
                      <KeyRound className="size-2.5 text-brand-600" strokeWidth={2} />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {detail.rows.map((row, i) => (
              <tr
                key={i}
                className="border-t border-page/60 hover:bg-tint/40"
              >
                <td className="px-2 py-1.5 font-mono text-[10.5px] text-ink-400">
                  {start + i}
                </td>
                {detail.columns.map((c) => {
                  const v = row[c.name];
                  return (
                    <td
                      key={`${c.cid}-${c.name}`}
                      title={formatCell(v)}
                      className="max-w-[220px] truncate px-2 py-1.5 font-mono text-[10.5px] text-ink-700"
                    >
                      <CellValue value={v} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex shrink-0 items-center justify-between px-1 text-[10.5px] text-ink-400">
        <span>
          {end < start ? 0 : `${start}–${end} / ${detail.total ?? "?"}`}
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            title="上一页"
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page <= 0}
          >
            <ChevronLeft className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          <span className="font-mono text-ink-500">
            {page + 1} / {totalPages}
          </span>
          <IconButton
            title="下一页"
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
          >
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
          </IconButton>
          <span className="ml-2">每页 {pageSize}</span>
        </div>
      </div>
    </div>
  );
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-ink-400">NULL</span>;
  }
  if (typeof value === "boolean") {
    return <span className="text-brand-700">{value ? "true" : "false"}</span>;
  }
  if (typeof value === "number") {
    return <span>{String(value)}</span>;
  }
  const s = String(value);
  if (s.length > 160) return <span>{s.slice(0, 160)}…</span>;
  return <span>{s}</span>;
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
