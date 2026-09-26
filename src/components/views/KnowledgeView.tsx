import { Database, FileText, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearKb,
  deleteKbDoc,
  getKbDoc,
  getKbStatus,
  listKbDocs,
  rebuildKbIndex,
  searchKb,
  type KbDoc,
  type KbImportResult,
  type KbSearchHit,
  type KbStatus,
} from "../../api";
import { useEmbedding } from "../embedding/EmbeddingProvider";
import { KbDocEditor } from "../knowledge/KbDocEditor";
import { KbImportDialog } from "../knowledge/KbImportDialog";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { CenterHint } from "../layout/CenterHint";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";

type ListItem = {
  id: string;
  title: string;
  snippet: string;
  source: string;
  indexed: boolean;
  createdAt?: string;
  distance?: number | null;
};

function snippetOf(text: string, max = 90): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function toListItem(doc: KbDoc): ListItem {
  return {
    id: doc.id,
    title: doc.title,
    snippet: snippetOf(doc.content),
    source: doc.source,
    indexed: doc.indexed,
    createdAt: doc.created_at,
  };
}

function hitToListItem(hit: KbSearchHit): ListItem {
  return {
    id: hit.id,
    title: hit.title,
    snippet: snippetOf(hit.content),
    source: hit.source,
    indexed: hit.indexed,
    distance: hit.distance ?? null,
  };
}

export function KnowledgeView() {
  const { initOpen, initError, dismissInit, progress } = useEmbedding();

  const [status, setStatus] = useState<KbStatus | null>(null);
  const [docs, setDocs] = useState<KbDoc[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<ListItem[] | null>(null);
  const [selected, setSelected] = useState<KbDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 弹窗状态
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<KbDoc | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<KbDoc | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const searchTimer = useRef<number | undefined>(undefined);

  const loadStatus = useCallback(async () => {
    try {
      const s = await getKbStatus();
      setStatus(s);
      return s;
    } catch {
      setStatus(null);
      return null;
    }
  }, []);

  const loadDocs = useCallback(async (keyword: string) => {
    try {
      setLoading(true);
      const res = await listKbDocs({ q: keyword, limit: 100 });
      setDocs(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const runSearch = useCallback(async (keyword: string) => {
    try {
      setSearching(true);
      const res = await searchKb(keyword, 8);
      setHits(res.items.map(hitToListItem));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "检索失败");
    } finally {
      setSearching(false);
    }
  }, []);

  // 首屏加载
  useEffect(() => {
    void loadStatus();
    void loadDocs("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 错误提示 4 秒后自动消失
  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // 搜索框防抖：空 = 浏览列表；非空 = 语义检索
  useEffect(() => {
    window.clearTimeout(searchTimer.current);
    const keyword = q.trim();
    if (!keyword) {
      setHits(null);
      void loadDocs("");
      return;
    }
    searchTimer.current = window.setTimeout(() => {
      void runSearch(keyword);
    }, 260);
    return () => window.clearTimeout(searchTimer.current);
  }, [q, loadDocs, runSearch]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadStatus(), loadDocs(q.trim())]);
    if (!q.trim()) setHits(null);
  }, [loadStatus, loadDocs, q]);

  async function handleSelect(item: ListItem) {
    // 列表项已含全文；检索命中补拉完整元数据
    if (hits && item.distance !== undefined) {
      try {
        setSelected(await getKbDoc(item.id));
      } catch {
        setSelected(null);
      }
      return;
    }
    const found = docs.find((d) => d.id === item.id) ?? null;
    setSelected(found);
  }

  function openCreate() {
    setEditingDoc(null);
    setEditorOpen(true);
  }

  function openEdit(doc: KbDoc) {
    setEditingDoc(doc);
    setEditorOpen(true);
  }

  async function handleSaved(saved: KbDoc) {
    await refreshAll();
    if (!q.trim()) setSelected(saved);
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    const id = confirmDelete.id;
    setConfirmDelete(null);
    try {
      await deleteKbDoc(id);
      if (selected?.id === id) setSelected(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handleClear() {
    setConfirmClear(false);
    try {
      await clearKb();
      setSelected(null);
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "清空失败");
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    try {
      await rebuildKbIndex();
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "重建失败");
    } finally {
      setRebuilding(false);
    }
  }

  function handleImported(_result: KbImportResult) {
    void refreshAll();
  }

  const showSearchMode = q.trim().length > 0;
  const list: ListItem[] = showSearchMode
    ? (hits ?? [])
    : docs.map(toListItem);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-page">
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* ---------- 左栏：文档列表 ---------- */}
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface/40">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink-900">
              <Database className="size-4 text-brand-600" />
              知识库
            </h2>
            <Badge tone="neutral" className="tabular-nums">
              {showSearchMode ? `${list.length} 命中` : `${total} 篇`}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 border-b border-line px-3 py-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索笔记（语义 / 关键词）"
                className="pl-8"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                className="flex-1"
                onClick={openCreate}
              >
                <FileText className="size-3.5" />
                新建笔记
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                onClick={() => setImportOpen(true)}
              >
                <UploadIcon />
                导入文件
              </Button>
            </div>
            {status && !status.vec_ready && status.count > 0 ? (
              <p className="text-[10.5px] text-ink-400">
                向量模型未就绪，当前仅支持关键词检索。
              </p>
            ) : null}
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {searching ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-400">
                <Loader2 className="size-3.5 animate-spin" />
                检索中…
              </div>
            ) : loading && !docs.length && !hits ? (
              <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-ink-400">
                <Loader2 className="size-3.5 animate-spin" />
                加载中…
              </div>
            ) : list.length === 0 ? (
              <div className="px-4 py-10 text-center text-[12px] text-ink-400">
                {showSearchMode ? "没有匹配的笔记" : "知识库还是空的，先新建一篇吧"}
              </div>
            ) : (
              <ul className="flex flex-col">
                {list.map((item) => {
                  const active = selected?.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void handleSelect(item)}
                        className={`flex w-full flex-col items-stretch gap-1 border-b border-line/60 px-3 py-2.5 text-left transition-colors ${
                          active
                            ? "bg-brand-500/10"
                            : "hover:bg-surface"
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            title={item.indexed ? "已建向量索引" : "未建向量索引"}
                            className={`size-1.5 shrink-0 rounded-full ${
                              item.indexed ? "bg-emerald-500" : "bg-ink-300"
                            }`}
                          />
                          <span className="truncate text-[13px] font-medium text-ink-900">
                            {item.title}
                          </span>
                          {item.distance !== null && item.distance !== undefined ? (
                            <span className="ml-auto shrink-0 text-[10px] text-ink-400">
                              {item.distance.toFixed(3)}
                            </span>
                          ) : null}
                        </span>
                        <span className="truncate pl-2.5 text-[11.5px] text-ink-500">
                          {item.snippet}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </aside>

        {/* ---------- 右栏：详情 / 空态 ---------- */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
              <StatusBadge status={status} />
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleRebuild}
                disabled={rebuilding || !status?.vec_ready || status.count === 0}
                title={
                  !status?.vec_ready
                    ? "向量模型就绪后才能重建索引"
                    : "重建全部文档的向量索引"
                }
              >
                {rebuilding ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                重建索引
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-danger-600 hover:bg-danger-600/10"
                onClick={() => setConfirmClear(true)}
                disabled={!status || status.count === 0}
              >
                <Trash2 className="size-3.5" />
                清空
              </Button>
            </div>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            {selected ? (
              <div className="flex flex-col gap-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="break-words text-[16px] font-semibold text-ink-900">
                      {selected.title}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-400">
                      {selected.source ? (
                        <Badge tone="neutral">{selected.source}</Badge>
                      ) : null}
                      <span className="tabular-nums">
                        {selected.char_count.toLocaleString()} 字符
                      </span>
                      {selected.created_at ? (
                        <span>
                          {new Date(selected.created_at).toLocaleString()}
                        </span>
                      ) : null}
                      <Badge tone={selected.indexed ? "ok" : "neutral"}>
                        {selected.indexed ? "已建向量索引" : "未建向量索引"}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => openEdit(selected)}
                    >
                      编辑
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger-600 hover:bg-danger-600/10"
                      onClick={() => setConfirmDelete(selected)}
                    >
                      删除
                    </Button>
                  </div>
                </div>
                <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface px-4 py-3 text-[13px] leading-6 text-ink-800 shadow-soft">
                  {selected.content}
                </pre>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
                <CenterHint
                  icon={<FileText className="size-6" />}
                  title={
                    showSearchMode
                      ? "没有选中的笔记"
                      : total === 0
                        ? "知识库还是空的"
                        : "从左侧选择一篇笔记"
                  }
                  desc={
                    total === 0
                      ? "新建一篇笔记，或在导入文件后，Agent 对话里就能随时检索到这些内容。"
                      : "点击左侧列表查看笔记详情、编辑或删除。"
                  }
                />
                {total === 0 ? (
                  <div className="flex gap-2">
                    <Button variant="primary" size="sm" onClick={openCreate}>
                      <FileText className="size-3.5" />
                      新建笔记
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setImportOpen(true)}
                    >
                      导入文件
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </ScrollArea>
        </main>
      </div>

      {/* 向量模型初始化遮罩（保留原占位页行为） */}
      {initOpen ? (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-page/95 backdrop-blur-sm">
          <Loader2 className="size-5 animate-spin text-brand-600" />
          <p className="text-[13px] font-medium text-ink-800">
            正在准备本地向量模型…
          </p>
          <p className="text-[11.5px] text-ink-500">
            首次使用需下载模型（约 {progress ? Math.round(progress) : 0}%）
          </p>
          {initError ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => dismissInit()}
            >
              关闭
            </Button>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="absolute right-4 top-16 z-40 max-w-sm rounded-xl border border-danger-200 bg-surface px-3 py-2 text-[12px] text-danger-600 shadow-lift">
          {error}
        </div>
      ) : null}

      {/* 弹窗 */}
      <KbDocEditor
        open={editorOpen}
        doc={editingDoc}
        vecReady={status?.vec_ready ?? false}
        onClose={() => setEditorOpen(false)}
        onSaved={handleSaved}
      />
      <KbImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title="删除这篇笔记？"
        description="删除后无法恢复，向量索引也会一并移除。"
        confirmLabel="删除"
        tone="danger"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void handleDelete()}
      />
      <ConfirmDialog
        open={confirmClear}
        title="清空整个知识库？"
        description="将删除全部笔记与向量索引，此操作不可恢复。"
        confirmLabel="清空"
        tone="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void handleClear()}
      />
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      className="size-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function StatusBadge({ status }: { status: KbStatus | null }) {
  if (!status) {
    return <span>状态未知</span>;
  }
  return (
    <span className="flex items-center gap-2">
      <span className="tabular-nums">
        已索引 {status.indexed}/{status.count}
      </span>
      <Badge
        tone={status.vec_ready ? "ok" : "neutral"}
        title={
          status.vec_ready
            ? `向量检索可用（${status.model}，${status.dim} 维）`
            : "向量模型未就绪，仅关键词检索"
        }
      >
        {status.vec_ready ? "向量就绪" : "仅关键词"}
      </Badge>
    </span>
  );
}
