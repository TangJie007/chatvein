import { Brain, Check, Eraser, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  consolidateMemories,
  createMemory,
  deleteMemory,
  getMemoryStatus,
  listMemories,
  updateMemory,
  type MemoryKind,
  type MemoryRecord,
  type MemoryStatusSummary,
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
import { Card, CardAction, IconButton, Note, Select, Stat } from "./primitives";

const KINDS: readonly MemoryKind[] = ["fact", "preference", "identity", "project", "other"];
const KIND_LABEL: Record<MemoryKind, string> = {
  fact: "事实",
  preference: "偏好",
  identity: "身份",
  project: "项目",
  other: "其他",
};
const SCOPE_LABEL: Record<string, string> = {
  global: "全局",
  role: "角色",
  conversation: "会话",
};

type Filter = "all" | "pending" | "active";

type Draft = {
  id: string;
  content: string;
  kind: MemoryKind;
};

function emptyDraft(): Draft {
  return { id: "", content: "", kind: "fact" };
}

/**
 * 长期记忆管理：查看 / 确认 / 编辑 / 删除抽取出来的记忆。
 *
 * 默认策略是「候选制」：抽取结果进 pending，用户确认后才进入对话上下文——
 * 记忆一旦注入就是每轮的 system prompt，误记一条会长期污染回答，所以要显式确认。
 */
export function MemorySection() {
  const [rows, setRows] = useState<MemoryRecord[]>([]);
  const [status, setStatus] = useState<MemoryStatusSummary | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: Filter) => {
    setLoading(true);
    setError(null);
    try {
      const [list, summary] = await Promise.all([
        listMemories({ status: next === "all" ? undefined : next, limit: 200 }),
        getMemoryStatus(),
      ]);
      setRows(list.memories);
      setStatus(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const changeFilter = useCallback((next: Filter) => setFilter(next), []);

  const refresh = useCallback(async () => {
    setBanner(null);
    await load(filter);
  }, [filter, load]);

  const confirmOne = useCallback(
    async (row: MemoryRecord) => {
      setBusyId(row.id);
      try {
        await updateMemory(row.id, { status: "active" });
        setBanner("已确认，本条会进入之后的对话上下文");
        await load(filter);
      } catch (err) {
        setBanner(`确认失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyId(null);
      }
    },
    [filter, load]
  );

  const removeOne = useCallback(
    async (row: MemoryRecord) => {
      setBusyId(row.id);
      try {
        await deleteMemory(row.id);
        setBanner("已删除");
        await load(filter);
      } catch (err) {
        setBanner(`删除失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusyId(null);
      }
    },
    [filter, load]
  );

  const consolidate = useCallback(async () => {
    setBusyId("__all__");
    setBanner(null);
    try {
      const result = await consolidateMemories();
      setBanner(`已整理：合并 ${result.merged} 条重复，清理 ${result.purged} 条过期`);
      await load(filter);
    } catch (err) {
      setBanner(`整理失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(null);
    }
  }, [filter, load]);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const content = draft.content.trim();
    if (!content) {
      setBanner("内容不能为空");
      return;
    }
    setSaving(true);
    try {
      if (draft.id) await updateMemory(draft.id, { content, kind: draft.kind });
      else await createMemory({ content, kind: draft.kind, status: "active" });
      setDraft(null);
      setBanner(draft.id ? "已保存修改" : "已新增并生效");
      await load(filter);
    } catch (err) {
      setBanner(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [draft, filter, load]);

  return (
    <Card
      title="长期记忆"
      desc="Agent 自动抽取你的偏好与长期事实；默认作为候选保存，确认后才会注入对话"
      icon={<Brain className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      action={
        <>
          <CardAction
            label="整理"
            icon={Eraser}
            onClick={() => void consolidate()}
            disabled={busyId === "__all__"}
          />
          <CardAction label="新增" icon={Plus} onClick={() => setDraft(emptyDraft())} />
          <IconButton title="刷新" onClick={() => void refresh()}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </>
      }
    >
      {status && (
        <div className="mx-3 mb-2 grid grid-cols-3 gap-2">
          <Stat label="已生效" value={`${status.active} 条`} tone="ok" />
          <Stat
            label="待确认"
            value={`${status.pending} 条`}
            tone={status.pending > 0 ? "warn" : undefined}
          />
          <Stat label="合计" value={`${status.total} 条`} />
        </div>
      )}

      {status && !status.enabled && (
        <Note tone="warn">
          记忆功能已被环境变量 <code className="mx-1">CHATVEIN_MEMORY=0</code> 关闭：不再抽取，也不会注入。
        </Note>
      )}
      {status && status.enabled && !status.auto_accept && (
        <Note tone="muted">
          当前为「候选制」：新抽取的记忆需要你点确认才会生效；每 {status.every_turns} 轮抽取一次。
        </Note>
      )}
      {status && status.enabled && status.auto_accept && (
        <Note tone="ok">已开启自动确认：新抽取的记忆会立即进入对话上下文。</Note>
      )}
      {banner && <Note tone="ok">{banner}</Note>}
      {error && <Note tone="warn">读取失败：{error}</Note>}

      <div className="mx-3 mb-2 flex items-center gap-1">
        {(
          [
            ["all", "全部"],
            ["pending", "待确认"],
            ["active", "已生效"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => changeFilter(key)}
            className={cn(
              "rounded-lg px-2.5 py-1 text-[11.5px] transition-colors focus-visible:outline-2 focus-visible:outline-brand-600",
              filter === key ? "bg-surface font-medium text-ink-900 shadow-soft" : "text-ink-500 hover:bg-tint/60"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-3">
        {loading ? (
          <p className="flex items-center gap-2 px-2 py-4 text-[11.5px] text-ink-400">
            <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
            读取中…
          </p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-4 text-[11.5px] leading-5 text-ink-400">
            还没有记忆。正常对话几轮后，Agent 会把你的稳定偏好与长期事实抽出来放在这里；
            也可以点右上角「新增」手动写一条。
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <li
                key={row.id}
                className="group flex items-start gap-2.5 rounded-xl bg-surface px-3 py-2.5 transition-shadow hover:shadow-soft"
              >
                <span className="mt-0.5 shrink-0 rounded-md bg-tint px-1.5 py-0.5 text-[10.5px] font-medium text-brand-700">
                  {KIND_LABEL[row.kind] ?? "其他"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] leading-5 text-ink-900">{row.content}</p>
                  <p className="mt-0.5 flex items-center gap-2 text-[10.5px] text-ink-400">
                    <span>{SCOPE_LABEL[row.scope] ?? row.scope}</span>
                    <span>置信 {Math.round(row.confidence * 100)}%</span>
                    {row.status === "pending" && <span className="text-warn-600">待确认</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                  {row.status === "pending" && (
                    <IconButton
                      title="确认生效"
                      onClick={() => void confirmOne(row)}
                      disabled={busyId === row.id}
                    >
                      <Check className="size-3.5 text-ok-600" strokeWidth={1.75} />
                    </IconButton>
                  )}
                  <IconButton
                    title="编辑"
                    onClick={() =>
                      setDraft({ id: row.id, content: row.content, kind: row.kind })
                    }
                    disabled={busyId === row.id}
                  >
                    <Pencil className="size-3.5" strokeWidth={1.75} />
                  </IconButton>
                  <IconButton
                    title="删除"
                    onClick={() => void removeOne(row)}
                    disabled={busyId === row.id}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </IconButton>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "编辑记忆" : "新增记忆"}</DialogTitle>
            <DialogDescription>
              用第三人称写一句可独立成立的陈述，例如「用户偏好中文回答，先给结论」。
            </DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="flex flex-col gap-3">
              <textarea
                value={draft.content}
                onChange={(event) =>
                  setDraft((prev) => (prev ? { ...prev, content: event.target.value } : prev))
                }
                rows={4}
                maxLength={300}
                placeholder="用户偏好……"
                className="w-full resize-none rounded-xl bg-page px-3 py-2 text-[12.5px] leading-5 text-ink-900 shadow-soft outline-none focus-visible:outline-2 focus-visible:outline-brand-600"
              />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[11.5px] text-ink-500">
                  <span>类型</span>
                  <Select
                    value={KIND_LABEL[draft.kind]}
                    onChange={(label) => {
                      const kind = KINDS.find((item) => KIND_LABEL[item] === label) ?? "fact";
                      setDraft((prev) => (prev ? { ...prev, kind } : prev));
                    }}
                    options={KINDS.map((item) => KIND_LABEL[item])}
                  />
                </div>
                <Button onClick={() => void saveDraft()} disabled={saving}>
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
