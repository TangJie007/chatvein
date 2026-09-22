import dayjs from "dayjs";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import {
  getTrace,
  listTraces,
  type TraceStep,
  type TraceSummary,
  type TurnTrace,
} from "../../api";
import { TitleBar } from "../layout/TitleBar";
import { Badge, type BadgeTone } from "../ui/badge";
import { cn } from "../../lib/cn";
import { JsonBlock } from "./JsonBlock";

const STEP_LABEL: Record<string, string> = {
  understand: "理解",
  plan: "规划",
  select_tools: "筛选工具",
  simple: "直答",
  react: "ReAct",
  verify: "核对",
  route: "路由",
};

function stepLabel(name: string): string {
  const [base, index] = name.split("#");
  const text = STEP_LABEL[base ?? ""] ?? name;
  return index ? `${text} #${index}` : text;
}

function formatElapsed(ms: number | null | undefined): string {
  const value = ms ?? 0;
  if (value < 1000) return `${value} ms`;
  const seconds = value / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
}

function formatTokens(n: number): string {
  return n.toLocaleString("zh-CN");
}

function statusTone(status: string): BadgeTone {
  if (status === "error") return "danger";
  if (status === "offline") return "warn";
  if (status === "ok") return "ok";
  return "neutral";
}

function statusText(status: string): string {
  if (status === "ok") return "完成";
  if (status === "error") return "失败";
  if (status === "offline") return "离线";
  if (status === "running") return "进行中";
  if (status === "done") return "完成";
  return status;
}

function stepRows(steps: TraceStep[]): Array<{ step: TraceStep; depth: number }> {
  const ids = new Set(steps.map((step) => step.id));
  const children = new Map<string | null, TraceStep[]>();
  for (const step of steps) {
    const parent = step.parent_id && ids.has(step.parent_id) ? step.parent_id : null;
    const list = children.get(parent) ?? [];
    list.push(step);
    children.set(parent, list);
  }
  const rows: Array<{ step: TraceStep; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const step of children.get(parent) ?? []) {
      rows.push({ step, depth });
      walk(step.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item));
}

/** 拼出调试用的完整请求体（模型 + 调用参数 + messages）。 */
function requestPayload(step: TraceStep): unknown {
  if (!step.request && !step.invocation && !step.model) return null;
  return {
    model: step.model ?? null,
    ...(step.invocation && Object.keys(step.invocation).length > 0
      ? { invocation: step.invocation }
      : {}),
    ...(step.request ?? { messages: [] }),
  };
}

/** 拼出完整响应体。 */
function responsePayload(step: TraceStep): unknown {
  if (!step.response) return null;
  return step.response;
}

function StepDetail({ step }: { step: TraceStep }) {
  const selected = stringList(step.detail?.selected_tools);
  const candidates = stringList(step.detail?.candidate_tools);
  const picked = new Set(selected);
  const requestJson = requestPayload(step);
  const responseJson = responsePayload(step);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold text-ink-900">{stepLabel(step.name)}</h2>
        <Badge tone={statusTone(step.status)}>{statusText(step.status)}</Badge>
        {step.model ? <span className="text-[12px] text-ink-400">{step.model}</span> : null}
        {step.elapsed_ms != null ? (
          <span className="text-[12px] text-ink-400">{formatElapsed(step.elapsed_ms)}</span>
        ) : null}
        {step.usage ? (
          <span className="text-[12px] text-ink-500">
            输入 {formatTokens(step.usage.input_tokens)} · 输出{" "}
            {formatTokens(step.usage.output_tokens)} · 合计{" "}
            {formatTokens(step.usage.total_tokens)}
            {step.usage.cached_tokens
              ? ` · 缓存 ${formatTokens(step.usage.cached_tokens)}`
              : ""}
            {step.usage.reasoning_tokens
              ? ` · 推理 ${formatTokens(step.usage.reasoning_tokens)}`
              : ""}
            {step.usage.context_pct != null ? ` · 上下文 ${step.usage.context_pct}%` : ""}
          </span>
        ) : null}
      </div>

      {step.error ? (
        <p className="rounded-xl bg-danger-50 px-3 py-2 text-[12.5px] text-danger-600">
          {step.error_detail?.status_code ? `HTTP ${step.error_detail.status_code} ` : ""}
          {step.error}
          {step.error_detail?.request_id ? ` · ${step.error_detail.request_id}` : ""}
        </p>
      ) : null}

      {step.kind === "route" ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-ink-500">路由 detail</h3>
          <JsonBlock value={step.detail ?? {}} />
        </section>
      ) : null}

      {step.kind === "tools" ? (
        <section className="flex flex-col gap-3">
          <p className="text-[13px] leading-6 text-ink-700">
            {String(step.detail?.reason || "未记录筛选理由")}
          </p>
          <div>
            <div className="mb-1.5 text-[11px] font-medium text-ink-400">
              候选 {candidates.length} · 选中 {selected.length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(candidates.length ? candidates : selected).map((name) => (
                <Badge key={name} tone={picked.has(name) ? "brand" : "neutral"}>
                  {name}
                </Badge>
              ))}
              {candidates.length === 0 && selected.length === 0 ? (
                <span className="text-[12px] text-ink-400">没有工具</span>
              ) : null}
            </div>
          </div>
          <h3 className="text-[12px] font-medium text-ink-500">detail JSON</h3>
          <JsonBlock value={step.detail ?? {}} maxHeight={280} />
        </section>
      ) : null}

      {requestJson != null ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-ink-500">Request（完整 JSON）</h3>
          <JsonBlock value={requestJson} maxHeight={560} />
        </section>
      ) : null}

      {responseJson != null ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-ink-500">Response（完整 JSON）</h3>
          <JsonBlock value={responseJson} maxHeight={420} />
        </section>
      ) : null}

      {step.kind === "tool" ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-ink-500">参数 JSON</h3>
          <JsonBlock value={step.arguments ?? null} emptyLabel="（无参数）" />
          <h3 className="text-[12px] font-medium text-ink-500">返回 JSON</h3>
          <JsonBlock value={step.result ?? null} emptyLabel="（空返回）" maxHeight={420} />
        </section>
      ) : null}

      {step.error_detail && Object.keys(step.error_detail).length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12px] font-medium text-ink-500">错误详情 JSON</h3>
          <JsonBlock value={step.error_detail} maxHeight={240} />
        </section>
      ) : null}
    </div>
  );
}

export function TraceWindow({
  conversationId,
  turnId,
}: {
  conversationId: string;
  turnId: string | null;
}) {
  const [summaries, setSummaries] = useState<TraceSummary[]>([]);
  const [activeTurn, setActiveTurn] = useState<string | null>(turnId);
  const [trace, setTrace] = useState<TurnTrace | null>(null);
  const [stepId, setStepId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!conversationId) {
      setSummaries([]);
      setTrace(null);
      return;
    }
    let cancelled = false;
    if (reloadKey === 0) setLoading(true);
    setError(null);
    void listTraces(conversationId)
      .then((rows) => {
        if (cancelled) return;
        setSummaries(rows);
        const requested = turnId && rows.some((row) => row.turn_id === turnId) ? turnId : null;
        setHint(turnId && !requested ? "这一轮还没有追踪，已打开最近一轮。" : null);
        setActiveTurn((current) => {
          if (current && rows.some((row) => row.turn_id === current)) return current;
          return requested ?? rows[0]?.turn_id ?? null;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, turnId, reloadKey]);

  useEffect(() => {
    if (!conversationId || !activeTurn) {
      setTrace(null);
      setStepId(null);
      return;
    }
    let cancelled = false;
    void getTrace(conversationId, activeTurn)
      .then((detail) => {
        if (cancelled) return;
        setTrace(detail);
        setStepId((current) => {
          if (current && detail.steps.some((step) => step.id === current)) return current;
          const preferred =
            [...detail.steps].reverse().find((step) => step.kind === "llm") ?? detail.steps[0];
          return preferred?.id ?? null;
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, activeTurn, reloadKey]);

  useEffect(() => {
    const live =
      trace?.status === "running" || summaries.some((item) => item.status === "running");
    if (!live) return;
    const timer = window.setInterval(() => setReloadKey((n) => n + 1), 1500);
    return () => window.clearInterval(timer);
  }, [trace?.status, summaries]);

  const step = trace?.steps.find((item) => item.id === stepId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
      <aside className="flex w-[220px] shrink-0 flex-col overflow-hidden rounded-lg bg-surface">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="text-[12px] font-medium text-ink-500">轮次</span>
          <button
            type="button"
            onClick={() => setReloadKey((n) => n + 1)}
            className="rounded-md px-1.5 py-0.5 text-[12px] text-ink-400 hover:bg-tint hover:text-ink-700"
          >
            刷新
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
          {summaries.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] leading-5 text-ink-400">
              {loading ? "正在读取…" : "还没有追踪。发送一条消息后再打开。"}
            </p>
          ) : (
            summaries.map((item) => (
              <button
                key={item.turn_id}
                type="button"
                onClick={() => {
                  setHint(null);
                  setActiveTurn(item.turn_id);
                }}
                className={cn(
                  "mb-1 w-full rounded-xl px-2.5 py-2 text-left",
                  item.turn_id === activeTurn ? "bg-brand-50" : "hover:bg-tint"
                )}
              >
                <div className="truncate text-[12.5px] text-ink-800">{item.input || "（空）"}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-400">
                  <span>{item.status === "running" ? "进行中" : item.difficulty || "—"}</span>
                  <span>·</span>
                  <span>{formatTokens(item.totals.total_tokens)} tok</span>
                  <span className="ml-auto">
                    {item.created_at ? dayjs(item.created_at).format("HH:mm:ss") : ""}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface">
        {hint ? <p className="px-4 pt-3 text-[12px] text-ink-400">{hint}</p> : null}
        {error ? <p className="px-4 pt-3 text-[12.5px] text-danger-600">{error}</p> : null}
        {!trace ? (
          <p className="px-4 py-8 text-[13px] text-ink-400">
            {conversationId ? "选择一轮查看图是怎么走的。" : "从对话里点击追踪打开。"}
          </p>
        ) : (
          <>
            <div className="border-b border-ink-200/70 px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-500">
                <Badge tone={trace.status === "running" ? "warn" : "brand"}>
                  {trace.status === "running" ? "进行中" : trace.difficulty || "—"}
                </Badge>
                <span>{formatElapsed(trace.elapsed_ms)}</span>
                <span>输入 {formatTokens(trace.totals.input_tokens)}</span>
                <span>输出 {formatTokens(trace.totals.output_tokens)}</span>
                <span>合计 {formatTokens(trace.totals.total_tokens)}</span>
                {trace.totals.cached_tokens ? (
                  <span>缓存 {formatTokens(trace.totals.cached_tokens)}</span>
                ) : null}
                {trace.totals.reasoning_tokens ? (
                  <span>推理 {formatTokens(trace.totals.reasoning_tokens)}</span>
                ) : null}
                <span>LLM {trace.totals.llm_calls}</span>
                <span>工具 {trace.totals.tool_calls}</span>
                {trace.totals.llm_ms ? <span>模型 {formatElapsed(trace.totals.llm_ms)}</span> : null}
                {trace.totals.tool_ms ? <span>工具耗时 {formatElapsed(trace.totals.tool_ms)}</span> : null}
              </div>
              {trace.role_name || trace.model_name || trace.config_name || trace.context_window ? (
                <p className="mt-1 text-[12px] text-ink-400">
                  {[trace.role_name, trace.config_name || trace.model_name].filter(Boolean).join(" · ")}
                  {trace.context_window ? ` · 窗口 ${formatTokens(trace.context_window)}` : ""}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {trace.path.map((node, index) => (
                  <span key={node.id} className="flex items-center gap-1.5">
                    {index > 0 ? <span className="text-ink-300">→</span> : null}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[12px]",
                        node.taken ? "bg-brand-600 text-white" : "bg-tint text-ink-300"
                      )}
                    >
                      {node.label}
                    </span>
                  </span>
                ))}
              </div>
              {trace.rewritten ? (
                <p className="mt-2 truncate text-[12px] text-ink-400">改写 {trace.rewritten}</p>
              ) : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-3">
              {trace.steps.length === 0 ? (
                <p className="px-1 py-6 text-[13px] text-ink-400">这一轮没有步骤。</p>
              ) : (
                <ol className="flex flex-col">
                  {stepRows(trace.steps).map(({ step: item, depth }, index, rows) => {
                    const total = Math.max(trace.elapsed_ms, 1);
                    const start = Math.max(0, item.start_ms ?? 0);
                    const width = Math.max(
                      2,
                      Math.min(100, ((item.elapsed_ms ?? 0) / total) * 100)
                    );
                    const left = Math.min(100 - width, (start / total) * 100);
                    return (
                      <li key={item.id} className="flex gap-3" style={{ paddingLeft: depth * 16 }}>
                        <div className="flex w-4 flex-col items-center">
                          <span
                            className={cn(
                              "mt-3 size-2.5 rounded-full",
                              item.id === stepId ? "bg-brand-600" : "bg-ink-300"
                            )}
                          />
                          {index < rows.length - 1 ? <span className="w-px flex-1 bg-ink-200" /> : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => setStepId(item.id)}
                          className={cn(
                            "mb-1.5 min-w-0 flex-1 rounded-xl px-3 py-2 text-left",
                            item.id === stepId ? "bg-brand-50" : "hover:bg-tint"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-ink-900">
                              {stepLabel(item.name)}
                            </span>
                            <Badge tone={statusTone(item.status)}>{statusText(item.status)}</Badge>
                            <span className="ml-auto text-[11px] text-ink-400">
                              {item.kind === "llm" && item.usage
                                ? `${formatTokens(item.usage.input_tokens)} → ${formatTokens(item.usage.output_tokens)}`
                                : item.elapsed_ms != null
                                  ? formatElapsed(item.elapsed_ms)
                                  : item.kind}
                            </span>
                          </div>
                          {item.elapsed_ms != null ? (
                            <span className="mt-1.5 block h-1.5 rounded-full bg-tint">
                              <span
                                className="block h-full rounded-full bg-brand-500"
                                style={{ marginLeft: `${left}%`, width: `${width}%` }}
                              />
                            </span>
                          ) : null}
                          {item.model ? (
                            <div className="mt-0.5 truncate text-[11.5px] text-ink-400">{item.model}</div>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        )}
      </section>

      <aside className="flex w-[520px] shrink-0 flex-col overflow-hidden rounded-lg bg-panel">
        {step ? (
          <StepDetail step={step} />
        ) : (
          <p className="px-4 py-8 text-[13px] text-ink-400">
            点中间的步骤查看完整 Request / Response JSON。
          </p>
        )}
      </aside>
    </div>
  );
}

export function TraceShell({
  conversationId,
  turnId,
}: {
  conversationId: string;
  turnId: string | null;
}) {
  const [conversation, setConversation] = useState(conversationId);
  const [turn, setTurn] = useState(turnId);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let alive = true;
    void listen<{ conversationId: string; turnId: string | null }>("trace-navigate", (event) => {
      setConversation(event.payload.conversationId);
      setTurn(event.payload.turnId);
    })
      .then((fn) => {
        if (alive) unlisten = fn;
        else fn();
      })
      .catch(() => {
        /* 浏览器里直接打开页面时没有 Tauri 事件 */
      });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen min-h-[620px] min-w-[960px] flex-col overflow-hidden bg-page font-sans text-ink-900 antialiased select-text">
      <TitleBar title="追踪" />
      <TraceWindow conversationId={conversation} turnId={turn} />
    </div>
  );
}
