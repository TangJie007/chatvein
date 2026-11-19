import {
  ChevronLeft,
  Database,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import { Collapsible } from "../ui/collapsible";
import { Slider } from "../ui/slider";
import { Stat } from "../ui/stat";
import { Select } from "../ui/select";
import { Switch } from "../ui/switch";

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

  // 库级配置（单库模式，仅本地预览，尚未接入后端存储）
  const [kbName, setKbName] = useState(
    () => localStorage.getItem("chatvein.kb.name") || "我的知识库"
  );
  const [kbDesc, setKbDesc] = useState(
    () => localStorage.getItem("chatvein.kb.desc") || ""
  );
  const [kbEnabled, setKbEnabled] = useState(true);
  const [mode, setMode] = useState(
    () => localStorage.getItem("chatvein.kb.mode") || "向量 + 关键词混合"
  );
  const [topK, setTopK] = useState(
    () => Number(localStorage.getItem("chatvein.kb.topK")) || 8
  );
  const [threshold, setThreshold] = useState(
    () => Number(localStorage.getItem("chatvein.kb.threshold")) || 0.62
  );
  const [chunk, setChunk] = useState(
    () => Number(localStorage.getItem("chatvein.kb.chunk")) || 800
  );
  const [rerank, setRerank] = useState(
    () => localStorage.getItem("chatvein.kb.rerank") !== "0"
  );
  const [savedHint, setSavedHint] = useState(false);

  const searchTimer = useRef<number | undefined>(undefined);

  const totalChars = useMemo(
    () => docs.reduce((s, d) => s + (d.char_count || 0), 0),
    [docs]
  );

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
      const res = await searchKb(keyword, 8, rerank);
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

  // 保存提示 3 秒后自动消失
  useEffect(() => {
    if (!savedHint) return;
    const timer = window.setTimeout(() => setSavedHint(false), 3000);
    return () => window.clearTimeout(timer);
  }, [savedHint]);

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

  function saveConfig() {
    localStorage.setItem("chatvein.kb.name", kbName);
    localStorage.setItem("chatvein.kb.desc", kbDesc);
    localStorage.setItem("chatvein.kb.mode", mode);
    localStorage.setItem("chatvein.kb.topK", String(topK));
    localStorage.setItem("chatvein.kb.threshold", String(threshold));
    localStorage.setItem("chatvein.kb.chunk", String(chunk));
    localStorage.setItem("chatvein.kb.rerank", rerank ? "1" : "0");
    setSavedHint(true);
  }

  function resetConfig() {
    setKbName("我的知识库");
    setKbDesc("");
    setKbEnabled(true);
    setMode("向量 + 关键词混合");
    setTopK(8);
    setThreshold(0.62);
    setChunk(800);
    setRerank(true);
  }

  const showSearchMode = q.trim().length > 0;
  // hits 为 null 表示还没搜索过，此时按「无结果」展示。
  const list: ListItem[] = showSearchMode ? (hits ?? []) : docs.map(toListItem);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-page">
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* ---------- 左栏：笔记列表（单库，沿用全局无 border 规范） ---------- */}
        <aside className="flex w-[300px] shrink-0 flex-col bg-list">
          <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-ink-900">
              <Database className="size-4 text-brand-600" />
              {kbName}
            </h2>
            <Badge tone="neutral" className="tabular-nums">
              {showSearchMode ? `${list.length} 命中` : `${total} 篇`}
            </Badge>
          </div>

          <div className="flex flex-col gap-2 px-3 pb-3">
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
              <ul className="flex flex-col gap-1 px-3 pb-3">
                {list.map((item) => {
                  const active = selected?.id === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => void handleSelect(item)}
                        className={
                          "flex w-full flex-col items-stretch gap-1 rounded-xl px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-brand-600 " +
                          (active
                            ? "bg-surface shadow-soft"
                            : "hover:bg-tint/60")
                        }
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            title={item.indexed ? "已建向量索引" : "未建向量索引"}
                            className={`size-1.5 shrink-0 rounded-full ${
                              item.indexed ? "bg-brand-500" : "bg-ink-300"
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

        {/* ---------- 右栏：库概览 / 笔记详情 ---------- */}
        <main className="flex min-w-0 flex-1 flex-col bg-surface">
          {selected ? (
            /* 笔记详情 */
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-line/60 px-4 py-2">
                <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  <ChevronLeft className="size-3.5" />
                  返回库设置
                </Button>
                <div className="ml-auto flex shrink-0 gap-2">
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
              <ScrollArea className="min-h-0 flex-1">
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
                  </div>
                  <pre className="whitespace-pre-wrap break-words rounded-xl bg-surface px-4 py-3 text-[13px] leading-6 text-ink-800 shadow-soft">
                    {selected.content}
                  </pre>
                </div>
              </ScrollArea>
            </div>
          ) : (
            /* 库概览（对齐参考项目的库详情分区） */
            <div className="flex min-h-0 flex-1 flex-col">
              <header className="flex shrink-0 items-center gap-3 px-6 pt-4 pb-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-soft">
                  <Database className="size-4" />
                </span>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <h1 className="max-w-[260px] shrink-0 truncate text-[15px] font-semibold text-ink-900">
                    {kbName}
                  </h1>
                  <Badge tone={status?.vec_ready ? "ok" : "neutral"}>
                    {status?.vec_ready ? "向量就绪" : "仅关键词"}
                  </Badge>
                  <span className="shrink-0 text-[10.5px] text-ink-400">
                    已索引 {status?.indexed ?? 0}/{status?.count ?? 0}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleRebuild}
                    disabled={
                      rebuilding ||
                      !status?.vec_ready ||
                      (status?.count ?? 0) === 0
                    }
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
                    重新索引
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setImportOpen(true)}
                  >
                    <UploadIcon />
                    导入文件
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger-600 hover:bg-danger-600/10"
                    onClick={() => setConfirmClear(true)}
                    disabled={!status || (status?.count ?? 0) === 0}
                  >
                    <Trash2 className="size-3.5" />
                    清空
                  </Button>
                </div>
              </header>

              <ScrollArea className="min-h-0 flex-1">
                <div className="mx-auto flex max-w-[720px] flex-col gap-2 px-6 py-4">
                  {/* 概览 */}
                  <div className="flex gap-2">
                    <Stat value={total} label="文档" />
                    <Stat
                      value={`${status?.indexed ?? 0}/${status?.count ?? 0}`}
                      label="已索引"
                    />
                    <Stat value={totalChars.toLocaleString()} label="字符" />
                  </div>

                  {/* 基础设置 */}
                  <Collapsible
                    title="基础设置"
                    desc="名称、描述与启停状态"
                    defaultOpen
                  >
                    <div className="flex items-center gap-4 rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
                      <label className="shrink-0 text-[12.5px] font-medium text-ink-900">
                        库名称
                      </label>
                      <Input
                        value={kbName}
                        onChange={(e) => setKbName(e.target.value)}
                        className="flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-4 rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
                      <label className="shrink-0 text-[12.5px] font-medium text-ink-900">
                        用途描述
                      </label>
                      <Input
                        value={kbDesc}
                        onChange={(e) => setKbDesc(e.target.value)}
                        placeholder="帮助 Agent 判断该检索什么"
                        className="flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-4 rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">
                          启用检索
                        </p>
                        <p className="truncate text-[11px] text-ink-400">
                          停用后不参与任何对话检索
                        </p>
                      </div>
                      <Switch checked={kbEnabled} onCheckedChange={setKbEnabled} />
                    </div>
                  </Collapsible>

                  {/* 检索参数 */}
                  <Collapsible
                    title="检索参数"
                    desc="召回策略与切片方式"
                    badge={`topK ${topK}`}
                  >
                    <div className="flex items-center gap-4 rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
                      <label className="shrink-0 text-[12.5px] font-medium text-ink-900">
                        检索模式
                      </label>
                      <Select
                        value={mode}
                        onChange={setMode}
                        options={["向量 + 关键词混合", "纯向量", "纯关键词"]}
                      />
                    </div>
                    <Slider
                      label="召回条数 topK"
                      hint="最多注入上下文的切片数"
                      value={topK}
                      min={1}
                      max={20}
                      step={1}
                      onChange={setTopK}
                    />
                    <Slider
                      label="相似度阈值"
                      hint="低于该分值不注入"
                      value={threshold}
                      min={0}
                      max={1}
                      step={0.01}
                      onChange={setThreshold}
                    />
                    <Slider
                      label="切片大小"
                      hint="按字符切分"
                      value={chunk}
                      min={200}
                      max={2000}
                      step={100}
                      suffix=" 字"
                      onChange={setChunk}
                    />
                    <div className="flex items-center gap-4 rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
                      <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">
                          混合检索重排（Hybrid+RRF）
                        </p>
                        <p className="truncate text-[11px] text-ink-400">
                          向量+关键词双路召回并 RRF 融合，无需额外模型
                        </p>
                      </div>
                      <Switch checked={rerank} onCheckedChange={setRerank} />
                    </div>
                  </Collapsible>
                </div>
              </ScrollArea>

              {/* 底部固定操作条 */}
              <div className="flex shrink-0 items-center gap-3 bg-surface px-6 py-2.5">
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-400">
                  {savedHint
                    ? "已保存到本地（检索参数为预览，尚未接入后端）"
                    : `共 ${status?.count ?? 0} 篇 · 改动在下次索引后生效`}
                </span>
                <Button variant="secondary" size="sm" onClick={resetConfig}>
                  还原
                </Button>
                <Button variant="primary" size="sm" onClick={saveConfig}>
                  保存配置
                </Button>
              </div>
            </div>
          )}
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
