import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/zh-cn";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createConversation,
  deleteConversation,
  deleteLastTurn,
  getConversation,
  getConversationWorkspace,
  getTrace,
  listConversations,
  listModels,
  listRoles,
  openArtifactLocation,
  openConversationWorkspace,
  sendChat,
  updateConversationSkills,
  type ConversationRecord,
  type ConversationWorkspace,
  type ChatMessageRecord,
  type LlmModelRecord,
  type RoleRecord,
  type TurnTrace,
} from "../../api";
import { ChatPanel, type ChatMessage } from "../chat/ChatPanel";
import type { ComposerSkill } from "../chat/Composer";
import {
  type InsightArtifact,
  type InsightStep,
  type InsightThreadItem,
} from "../chat/InsightPanel";
import { SessionList, type SessionItem } from "../chat/SessionList";
import { CreatingOverlay } from "../chat/CreatingOverlay";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { openTraceWindow } from "../../lib/openTrace";
import { VIEW_PATH } from "../../types/view";

dayjs.extend(relativeTime);
dayjs.locale("zh-cn");

/** Survives ChatView remount so sticky newRequestId from App doesn't re-create. */
let lastHandledNewRequestId = 0;

/**
 * 新建会话的初始化步骤。后续要加阶段（知识库索引 / 技能挂载 / 沙箱预热等）
 * 只往这里加文案，驱动逻辑按顺序推进即可。
 */
const CREATE_STEPS = ["创建会话", "初始化工作区", "准备就绪"] as const;
/** 创建请求通常几十毫秒就返回；至少展示 1s，避免加载提示一闪而过。 */
const CREATE_MIN_MS = 1000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const AVATAR_COLORS = [
  "bg-brand-500",
  "bg-violet-400",
  "bg-teal-400",
  "bg-peach-400",
  "bg-amber-400",
];

function toSessionItem(c: ConversationRecord): SessionItem {
  const title = c.title.trim() || "新会话";
  const idx =
    Math.abs(
      [...c.id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
    ) % AVATAR_COLORS.length;
  return {
    id: c.id,
    title,
    preview: c.last_message?.trim() || c.workspace_dir || "尚无消息",
    time: c.updated_at ? dayjs(c.updated_at).fromNow() : "",
    avatar: title.slice(0, 1).toUpperCase(),
    colorClass: AVATAR_COLORS[idx] ?? "bg-brand-600",
    tagLabel: c.message_count > 0 ? "进行中" : "空闲",
    tagTone: c.message_count > 0 ? "brand" : "ok",
  };
}

function artifactType(name: string): InsightArtifact["type"] {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "image";
  if (["csv", "tsv", "xlsx", "xls"].includes(ext)) return "table";
  return "file";
}

function artifactMeta(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(/\.0$/, "")} MB`;
}

function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    tokens += code > 0xff ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const k = tokens / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K`;
}

function toChatMessages(rows: ChatMessageRecord[]): ChatMessage[] {
  return rows.map((m) => ({
    id: String(m.id),
    role: m.role === "assistant" ? "agent" : m.role === "system" ? "system" : "user",
    content: m.content,
    turnId: m.turn_id ?? null,
    tokens: m.tokens ?? null,
    durationMs: m.duration_ms ?? null,
  }));
}

/** 抽取任意抛错上的可读文案（Tauri invoke 可能是 string，不是 Error）。 */
function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return String(err);
}

/** 在途追踪 → 思考流节点：只取「思考结论 + 工具调用」，与完成后的展示口径一致。 */
function toLiveSteps(trace: TurnTrace): InsightStep[] {
  const steps: InsightStep[] = [];
  if (trace.route_reason?.trim()) {
    steps.push({ kind: "thought", text: trace.route_reason.trim() });
  }
  if (trace.tool_plan_reason?.trim()) {
    steps.push({ kind: "thought", text: trace.tool_plan_reason.trim() });
  }
  for (const step of trace.steps ?? []) {
    if (step.kind === "llm") {
      // 离线兜底（没有模型）不是真实思考，不占思考流。
      if (step.status === "offline") continue;
      const model = step.model?.trim() || step.name || "模型";
      steps.push({
        kind: "thought",
        text:
          step.status === "running"
            ? `调用 ${model} 推理中…`
            : `调用 ${model} 完成`,
      });
      continue;
    }
    if (step.kind !== "tool") continue;
    const args =
      step.arguments == null
        ? ""
        : typeof step.arguments === "string"
          ? step.arguments
          : JSON.stringify(step.arguments);
    steps.push({
      kind: "tool",
      tool: step.name || "tool",
      args,
      status: step.status === "error" ? "blocked" : "ok",
      result:
        (step.result ?? "").trim() ||
        (step.status === "running" ? "执行中…" : (step.error ?? "").trim() || "已返回"),
    });
  }
  return steps;
}

/** Tauri HTTP：Rust 为 "Request canceled"；JS 乐观路径为 "Request cancelled"；浏览器为 AbortError。 */
function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  const msg = errorMessage(err).toLowerCase();
  return msg.includes("request canceled") || msg.includes("request cancelled");
}

type ChatViewProps = {
  newRequestId?: number;
  onConversationCount?: (n: number) => void;
};

export function ChatView({
  newRequestId = 0,
  onConversationCount,
}: ChatViewProps) {
  const navigate = useNavigate();
  const { conversationId: routeConversationId } = useParams<{
    conversationId?: string;
  }>();
  const activeId = routeConversationId ?? null;
  const routeIdRef = useRef(routeConversationId);
  routeIdRef.current = routeConversationId;
  const selectConversation = useCallback(
    (id: string | null, replace = false) => {
      navigate(id ? `${VIEW_PATH.chat}/${id}` : VIEW_PATH.chat, { replace });
    },
    [navigate]
  );
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [query, setQuery] = useState("");
  const [insightOpen, setInsightOpen] = useState(true);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workspace, setWorkspace] = useState<ConversationWorkspace | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [errorTone, setErrorTone] = useState<"danger" | "muted">("danger");
  /** 本轮异常挂在哪个气泡下面（提问气泡 id）；null 表示错误不挂载到具体气泡。 */
  const [errorAnchorId, setErrorAnchorId] = useState<string | null>(null);
  const setError = useCallback((message: string | null, tone: "danger" | "muted" = "danger") => {
    setErrorTone(tone);
    setErrorState(message);
    if (!message) setErrorAnchorId(null);
  }, []);
  /** 当前在途请求的取消控制器；非 null 表示 Agent 正在生成。 */
  const abortRef = useRef<AbortController | null>(null);
  /** 本轮正在回答的问题原文：生成中把「思考流」锁定到这条问题上。 */
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  /** 在途轮次（会话 id + 前端生成的 turn_id）：据此轮询本轮追踪进度。 */
  const [liveTurn, setLiveTurn] = useState<{
    conversationId: string;
    turnId: string;
  } | null>(null);
  /** 在途轮次的思考流节点（追踪实时落库，轮询刷新）。 */
  const [liveSteps, setLiveSteps] = useState<InsightStep[]>([]);
  /** 本轮回复已就地回填到占位气泡，切换会话 id 时跳过整表重载（否则气泡会被替换成新组件）。 */
  const skipNextLoadRef = useRef<string | null>(null);
  /** 新建会话进行中的步骤下标；null 表示不在创建中（遮罩隐藏）。 */
  const [createStep, setCreateStep] = useState<number | null>(null);
  /** 待二次确认的删除目标。 */
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** 发送前主库已落库的最大消息 id；清理时只删 id 更大的本轮。 */
  const lastPersistedIdRef = useRef(0);
  /** 本次 abort 的意图：catch 里用来决定要不要展示「已取消」提示。 */
  const cancelModeRef = useRef<"stop" | "edit" | "recall" | null>(null);
  /** 本轮乐观插入的用户 / 助手气泡 id 与原文，便于停止 / 撤回时精确移除。 */
  const pendingRef = useRef<{
    userId: string;
    agentId: string;
    text: string;
    /** 发送前主库最大消息 id；清理只删比它新的。 */
    afterMessageId: number;
  } | null>(null);
  /** 编辑时回灌到输入框的原文（null 表示无需回灌）。 */
  const [restoreText, setRestoreText] = useState<string | null>(null);
  /** 当前会话级技能（Composer 受控）：勾选 / 移除即持久化，切换会话随 loadConversation 刷新。 */
  const [composerSkills, setComposerSkills] = useState<ComposerSkill[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [models, setModels] = useState<LlmModelRecord[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [metaById, setMetaById] = useState<
    Record<
      string,
      {
        difficulty?: string;
        selectedTools?: string[];
        routeReason?: string;
        toolPlan?: string;
      }
    >
  >({});

  const refreshList = useCallback(async () => {
    const rows = await listConversations(80);
    setSessions(rows.map(toSessionItem));
    onConversationCount?.(rows.length);
    return rows;
  }, [onConversationCount]);

  const refreshListRef = useRef(refreshList);
  refreshListRef.current = refreshList;

  const loadConversation = useCallback(async (id: string) => {
    const data = await getConversation(id);
    const msgs = toChatMessages(data.messages);
    setMessages(msgs);
    const maxId = data.messages.reduce(
      (max, m) => Math.max(max, typeof m.id === "number" ? m.id : Number(m.id) || 0),
      0
    );
    lastPersistedIdRef.current = maxId;
    const lastAgent = [...msgs].reverse().find((m) => m.role === "agent" && m.turnId);
    setSelectedTurnId(lastAgent?.turnId ?? null);
    setComposerSkills((data.conversation.skills ?? []).map((slug) => ({ slug, name: slug })));
    try {
      setWorkspace(await getConversationWorkspace(id));
    } catch {
      setWorkspace(null);
    }
  }, []);

  /**
   * 新建会话：按 CREATE_STEPS 推进遮罩，且每一步都有最短展示时长
   * （创建本身通常 <100ms，不兜一下就是一闪而过）。失败时返回 null 并把错误交给 setError。
   */
  const creatingRef = useRef(false);
  const createConversationWithProgress = useCallback(async () => {
    // 连点「新建」时只跑一次：否则两个会话一起建，遮罩也会被前一个收尾提前关掉。
    if (creatingRef.current) return null;
    creatingRef.current = true;
    setCreateStep(0);
    try {
      // 不再等待本地向量模型：会话创建不再弹出「工作区初始化」下载弹框，
      // 模型就绪状态在模型管理 / 知识库中可见，下载在后台静默进行。
      const [created] = await Promise.all([
        createConversation(""),
        sleep(CREATE_MIN_MS),
      ]);
      setCreateStep(1);
      // 工作区目录 / 会话库初始化：等后端真正就绪，也给后续初始化步骤留好位置。
      const [ws] = await Promise.all([
        getConversationWorkspace(created.id).catch(() => null),
        sleep(280),
      ]);
      if (ws) setWorkspace(ws);
      setCreateStep(2);
      await sleep(220);
      setCreateStep(CREATE_STEPS.length);
      await sleep(240);
      return created;
    } catch (err) {
      setError(errorMessage(err));
      return null;
    } finally {
      creatingRef.current = false;
      setCreateStep(null);
    }
  }, [setError]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listRoles(), listModels()])
      .then(([roleRows, modelRows]) => {
        if (cancelled) return;
        setRoles(roleRows);
        setModels(modelRows);
        setRoleId((prev) => {
          if (prev && roleRows.some((role) => role.id === prev)) return prev;
          return roleRows.find((role) => role.primary)?.id ?? roleRows[0]?.id ?? null;
        });
      })
      .catch(() => {
        /* backend may still be starting */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await refreshList();
        if (cancelled) return;
        if (!routeIdRef.current && rows.length > 0) {
          selectConversation(rows[0]!.id, true);
        }
      } catch {
        /* backend may still be starting */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList, selectConversation]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setWorkspace(null);
      setComposerSkills([]);
      setError(null);
      return;
    }
    // 切换会话：清掉上一个会话残留的错误（含挂在提问气泡下的那条）。
    setError(null);
    // 首次发送会新建会话并切过来：回复已就地回填到占位气泡，
    // 再整表重载会把气泡换成新组件，这里直接跳过。
    if (skipNextLoadRef.current === activeId) {
      skipNextLoadRef.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await loadConversation(activeId);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId, loadConversation, setError]);

  useEffect(() => {
    // App keeps newRequestId sticky; remounting ChatView (leave/return 对话)
    // must not treat the same id as another create request.
    if (!newRequestId || newRequestId === lastHandledNewRequestId) return;
    let cancelled = false;
    // StrictMode 会立刻清理再执行一次；推迟到清理之后再请求，避免点一次建两个。
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled || newRequestId === lastHandledNewRequestId) return;
        lastHandledNewRequestId = newRequestId;
        // 走带初始化进度的创建流程（至少 1s 的加载提示，成功后才切过去）。
        const created = await createConversationWithProgress();
        if (cancelled || !created) return;
        await refreshListRef.current();
        if (cancelled) return;
        selectConversation(created.id);
        setMessages([]);
        setComposerSkills([]);
        setMetaById((prev) => ({ ...prev, [created.id]: {} }));
        setError(null);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [newRequestId, selectConversation, createConversationWithProgress]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q)
    );
  }, [query, sessions]);

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const lastMeta = (activeId && metaById[activeId]) || {};
  const activeRole = roles.find((role) => role.id === roleId) ?? roles.find((role) => role.primary) ?? null;
  const boundModel = activeRole?.model_id
    ? models.find((model) => model.id === activeRole.model_id) ?? null
    : null;
  const resolvedModelName = boundModel?.name ?? "（未配置模型）";
  const contextTotal = Math.max(1, (boundModel?.context_window_k ?? 128) * 1000);
  const contextUsed = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  const contextPct = Math.min(100, Math.round((contextUsed / contextTotal) * 100));
  const contextTitle = `上下文已用 ${contextPct}% · ${formatTokenCount(contextUsed)} / ${formatTokenCount(contextTotal)} tokens`;

  const insightThread = useMemo<InsightThreadItem[]>(() => {
    const turnId = selectedTurnId;
    const reasoning = turnId ? workspace?.reasoning?.[turnId] : undefined;
    const steps: Extract<InsightThreadItem, { role: "trace" }>["trace"]["steps"] = [];
    if (reasoning?.route_reason) {
      steps.push({ kind: "thought", text: reasoning.route_reason });
    }
    if (reasoning?.tool_plan) {
      steps.push({ kind: "thought", text: reasoning.tool_plan });
    }
    for (const call of (workspace?.tool_calls ?? []).filter((tc) => tc.turn_id === turnId)) {
      const blocked = call.status === "blocked" || call.status === "denied";
      steps.push({
        kind: "tool",
        tool: call.tool_name,
        args: call.arguments_json?.trim() || "{}",
        status: blocked ? "blocked" : "ok",
        result: call.result_text.trim() || (blocked ? "已拦截" : "已返回"),
      });
    }
    if (steps.length === 0) return [];
    const goal =
      reasoning?.route_reason ||
      steps.find((s) => s.kind === "thought")?.text ||
      "完成本轮请求";
    return [{ role: "trace", trace: { goal, steps } }];
  }, [selectedTurnId, workspace]);

  const artifacts = useMemo<InsightArtifact[]>(() => {
    return (workspace?.artifacts ?? []).map((item) => ({
      type: artifactType(item.name),
      name: item.name,
      meta: artifactMeta(item.size_bytes),
      time: item.modified_at ? dayjs(item.modified_at).format("HH:mm") : "",
      path: item.path || undefined,
    }));
  }, [workspace?.artifacts]);

  const handleRevealArtifact = useCallback(
    (path: string) => {
      if (!activeId) return;
      void openArtifactLocation(activeId, path).catch(() => {
        /* 打开失败静默忽略（路径越界 / 文件管理器异常） */
      });
    },
    [activeId]
  );

  /** Composer 勾选 / 移除技能时：更新本地状态并即时持久化到当前会话（会话级生效）。 */
  const handleSkillsChange = useCallback(
    (next: ComposerSkill[]) => {
      setComposerSkills(next);
      if (activeId) {
        void updateConversationSkills(
          activeId,
          next.map((s) => s.slug)
        ).catch((err: unknown) => {
          setError(errorMessage(err));
        });
      }
    },
    [activeId, setError]
  );

  /** 生成中轮询本轮追踪：后端每完成一步就落库，思考流因此能边跑边长。 */
  useEffect(() => {
    if (!liveTurn) return;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      try {
        const trace = await getTrace(liveTurn.conversationId, liveTurn.turnId);
        if (!cancelled) setLiveSteps(toLiveSteps(trace));
      } catch {
        // 追踪还没落第一条（或会话刚建）：忽略，下个周期再取。
      }
      if (!cancelled) timer = window.setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setLiveSteps([]);
    };
  }, [liveTurn]);

  const handleSend = async (
    text: string,
    skills?: { slug: string; name: string }[]
  ) => {
    if (sending) return;
    setSending(true);
    setError(null);
    // 思考流立刻锁定到本轮问题：占位气泡此时还没有 turn_id，
    // 若不锁定，右侧洞察会继续显示上一轮轨迹，看起来像"没在思考"。
    setPendingQuestion(text);
    setSelectedTurnId(null);
    // 本轮 id 由前端生成：后端按它逐步落追踪，思考流可边等边轮询。
    const turnId = crypto.randomUUID().replace(/-/g, "");
    // 没有当前会话时先建一个：否则拿不到轮询追踪所需的 conversation_id。
    let conversationId = activeId;
    if (!conversationId) {
      try {
        const created = await createConversation("");
        conversationId = created.id;
        // 新会话是空的：别让它触发的整表重载清掉下面插入的乐观气泡。
        skipNextLoadRef.current = created.id;
        selectConversation(created.id);
        void refreshListRef.current();
      } catch (err) {
        setSending(false);
        setPendingQuestion(null);
        setError(errorMessage(err));
        return;
      }
    }
    setLiveTurn({ conversationId, turnId });
    const optimisticId = crypto.randomUUID();
    const pendingId = crypto.randomUUID();
    pendingRef.current = {
      userId: optimisticId,
      agentId: pendingId,
      text,
      afterMessageId: lastPersistedIdRef.current,
    };
    const controller = new AbortController();
    abortRef.current = controller;
    setMessages((prev) => [
      ...prev,
      { id: optimisticId, role: "user", content: text },
      { id: pendingId, role: "agent", content: "", streaming: true },
    ]);
  // Composer 把带 slug 的技能数组回传过来；这里只发 slug（后端按 slug 找到
  // 本机 <data>/skills/<slug>/SKILL.md 注入 role prompt）。用户看到的 chip 名字
  // 只是本地 UI，不进入 API 请求体。
    try {
      const result = await sendChat(
        text,
        conversationId,
        roleId,
        skills?.map((s) => s.slug) ?? null,
        turnId,
        controller.signal
      );
      // 兜底：后端换了会话（理论上不会），切过去时同样跳过整表重载。
      if (result.conversation_id !== conversationId) {
        skipNextLoadRef.current = result.conversation_id;
        // 新会话技能集由本次请求写入，重载被跳过时这里补上，保持 chip 与后端一致。
        if (skills?.length) setComposerSkills(skills);
        selectConversation(result.conversation_id);
      }
      setMetaById((prev) => ({
        ...prev,
        [result.conversation_id]: {
          difficulty: result.difficulty,
          selectedTools: result.selected_tools,
          routeReason: result.route_reason,
          toolPlan: result.tool_plan_reason,
        },
      }));
      if (result.workspace) setWorkspace(result.workspace);
      setSelectedTurnId(result.turn_id);
      // 结果写回那一个占位气泡：id（React key）不变，只换内容，
      // 避免整表重载把气泡换成新组件（视觉上像"整块跳变"）。
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? {
                ...m,
                content: result.reply,
                streaming: false,
                turnId: result.turn_id,
                tokens: result.tokens ?? null,
                durationMs: result.duration_ms ?? null,
              }
            : m
        )
      );
      // 本轮已落库：抬高清理基线，之后撤回 / 停止只删这条之后的记录。
      lastPersistedIdRef.current = Math.max(
        lastPersistedIdRef.current,
        Number(result.assistant_message?.id) || 0,
        Number(result.user_message?.id) || 0
      );
      await refreshList();
    } catch (err) {
      // Rust 抛 string "Request canceled"（非 Error）；以 signal / 文案双保险，绝不能落到红字。
      if (controller.signal.aborted || isAbortError(err)) {
        const mode = cancelModeRef.current;
        cancelModeRef.current = null;
        if (mode === "stop" || mode == null) {
          setError("已取消本次生成", "muted");
        }
        return;
      }
      // 保留提问气泡（错误挂在它下面），只移除那个空的助手气泡。
      setMessages((prev) => prev.filter((m) => m.id !== pendingId));
      setError(errorMessage(err));
      setErrorAnchorId(optimisticId);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setSending(false);
      setPendingQuestion(null);
      // 本轮结束：停掉追踪轮询，思考流交回已完成轮次的轨迹。
      setLiveTurn(null);
    }
  };

  /** 后端是同步落库，停止 HTTP 后仍可能稍后写入本轮。
   *  轮询删除时必须同时匹配「用户原文」+「id > 发送前 baseline」，
   *  否则本轮未落库时会误删上一轮历史（相同文案连发时仅靠原文也不够）。 */
  const cleanupInFlight = useRef(false);
  const cleanupLastTurn = useCallback(
    async (conversationId: string, userContent: string, afterMessageId: number) => {
      if (cleanupInFlight.current) return;
      cleanupInFlight.current = true;
      try {
        for (let i = 0; i < 8; i++) {
          try {
            const res = await deleteLastTurn(conversationId, {
              userContent,
              afterMessageId,
            });
            if (res.deleted > 0) return;
          } catch {
            /* 会话可能已被切换或删除，忽略 */
          }
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      } finally {
        cleanupInFlight.current = false;
      }
    },
    []
  );

  /** 主动停止 / 编辑 / 撤回：中止在途请求并清理气泡。 */
  const cancelCurrent = useCallback(
    (mode: "stop" | "edit" | "recall") => {
      cancelModeRef.current = mode;
      const controller = abortRef.current;
      if (controller) controller.abort();
      abortRef.current = null;
      const pending = pendingRef.current;
      setMessages((prev) =>
        pending
          ? prev.filter((m) => m.id !== pending.userId && m.id !== pending.agentId)
          : prev
      );
      pendingRef.current = null;
      setSending(false);
      // 停止 / 撤回：立刻停掉本轮追踪轮询。
      setLiveTurn(null);
      // 气泡已被移除，错误不能再挂在原提问上，否则提示会消失。
      setErrorAnchorId(null);
      // 停止：立刻给中性提示；编辑 / 撤回不额外打扰。
      if (mode === "stop") setError("已取消本次生成", "muted");
      else setError(null);
      if (mode === "edit" && pending) setRestoreText(pending.text);
      // 只清理本轮；无 pending 时不要动历史。
      if (activeId && pending?.text) {
        void cleanupLastTurn(activeId, pending.text, pending.afterMessageId);
      }
    },
    [activeId, cleanupLastTurn, setError]
  );

  /** 占位气泡里的进度文案：优先显示本轮正在跑的那一步，让等待看起来"在做事"。 */
  const thinkingHint = useMemo(() => {
    for (let i = liveSteps.length - 1; i >= 0; i--) {
      const step = liveSteps[i];
      if (!step) continue;
      if (step.kind === "tool") return `正在调用 ${step.tool}…`;
      if (step.kind === "thought" && step.text.includes("推理中")) return step.text;
    }
    return null;
  }, [liveSteps]);

  /** 点删除：只打开二次确认，真正删除等用户确认。 */
  const requestDelete = useCallback(
    (id: string) => {
      const target = sessions.find((s) => s.id === id);
      setPendingDelete({ id, title: target?.title ?? "该会话" });
    },
    [sessions]
  );

  const confirmDelete = useCallback(async () => {
    const target = pendingDelete;
    if (!target || deleting) return;
    setDeleting(true);
    try {
      await deleteConversation(target.id);
      const rows = await refreshList();
      if (activeId === target.id) {
        const next = rows[0]?.id ?? null;
        selectConversation(next);
        if (!next) {
          setMessages([]);
          setWorkspace(null);
          setSelectedTurnId(null);
        }
      }
      setError(null);
      setPendingDelete(null);
    } catch (err) {
      // 关掉弹窗，让后端错误显示在会话区（否则被弹窗挡住看不见）。
      setPendingDelete(null);
      setError(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  }, [activeId, deleting, pendingDelete, refreshList, selectConversation, setError]);

  return (
    <>
      <SessionList
        sessions={filtered}
        activeId={activeId}
        onSelect={(id) => selectConversation(id)}
        onDelete={requestDelete}
        query={query}
        onQueryChange={setQuery}
      />
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <ChatPanel
          session={session}
          messages={messages}
          insightOpen={insightOpen}
          onToggleInsight={() => setInsightOpen((v) => !v)}
          modelName={resolvedModelName}
          modelId={boundModel?.model_id ?? ""}
          roleName={activeRole?.name}
          roleAvatar={activeRole?.avatar}
          contextPct={contextPct}
          contextTitle={contextTitle}
          sending={sending}
          error={error}
          errorTone={errorTone}
          errorAnchorId={errorAnchorId}
          meta={lastMeta}
          onStop={() => cancelCurrent("stop")}
          onEditMessage={() => cancelCurrent("edit")}
          onRecallMessage={() => cancelCurrent("recall")}
          restoreText={restoreText}
          onRestored={() => setRestoreText(null)}
          workspaceDir={workspace?.workspace_dir}
          conversationId={activeId}
          insightThread={insightThread}
          artifacts={artifacts}
          onRevealArtifact={handleRevealArtifact}
          selectedTurnId={selectedTurnId}
          onSelectMessage={(tid) => setSelectedTurnId(tid)}
          live={
            sending && pendingQuestion
              ? { goal: pendingQuestion, steps: liveSteps }
              : null
          }
          thinkingHint={sending ? thinkingHint : null}
          onOpenWorkspace={() => {
            if (!activeId) return;
            void openConversationWorkspace(activeId).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
          onOpenTrace={() => {
            if (!activeId) return;
            void openTraceWindow(activeId, selectedTurnId).catch((err: unknown) => {
              setError(err instanceof Error ? err.message : String(err));
            });
          }}
          onSend={(text, skills) => {
            void handleSend(text, skills);
          }}
          skills={composerSkills}
          onSkillsChange={handleSkillsChange}
          residentSkills={activeRole?.resident_skills ?? []}
        />
        {/* 新建会话：工作区初始化的分阶段进度（至少展示 1s） */}
        {createStep !== null ? (
          <CreatingOverlay steps={CREATE_STEPS} active={createStep} />
        ) : null}
      </div>
      {/* 删除会话：应用内二次确认，替代 window.confirm */}
      <ConfirmDialog
        open={!!pendingDelete}
        title="删除会话"
        description={
          pendingDelete
            ? `确定删除「${pendingDelete.title}」？该会话的消息与工作区文件会一并清除，且无法恢复。`
            : undefined
        }
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        busy={deleting}
        onConfirm={() => {
          void confirmDelete();
        }}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </>
  );
}
