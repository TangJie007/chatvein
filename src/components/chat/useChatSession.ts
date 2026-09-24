import { useCallback, useEffect, useRef, useState } from "react";
import {
  createConversation,
  deleteLastTurn,
  getConversation,
  getConversationWorkspace,
  getTrace,
  sendChat,
  type ChatMessageRecord,
  type ConversationWorkspace,
  type TurnTrace,
} from "../../api";
import { errorMessage } from "../../lib/errors";
import type { ChatMessage } from "./ChatPanel";
import type { ComposerSkill } from "./Composer";
import type { InsightStep } from "./InsightPanel";

/** 会话引擎：加载消息 / 流式发送 / 中止与撤回 / 在途追踪轮询。
 *
 * 对话视图与群组视图共用这一份逻辑，但各自有独立的实例与面板，
 * 因此群组特有的规则（不展示模型、没有技能）不会反过来影响对话视图。
 */

export type ChatSessionMeta = {
  difficulty?: string;
  selectedTools?: string[];
  routeReason?: string;
  toolPlan?: string;
};

export function toChatMessages(rows: ChatMessageRecord[]): ChatMessage[] {
  return rows.map((m) => ({
    id: String(m.id),
    role: m.role === "assistant" ? "agent" : m.role === "system" ? "system" : "user",
    content: m.content,
    turnId: m.turn_id ?? null,
    tokens: m.tokens ?? null,
    durationMs: m.duration_ms ?? null,
    actorId: m.actor_id ?? null,
  }));
}

/** 在途追踪 → 思考流节点：只取「思考结论 + 工具调用」，与完成后的展示口径一致。 */
export function toLiveSteps(trace: TurnTrace): InsightStep[] {
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

type UseChatSessionOptions = {
  conversationId: string | null;
  /** 请求用的角色 id；null 交给后端默认角色。 */
  roleId: string | null;
  /** 会话不存在时先建一个（对话视图）；群组的群对话由建群流程保证存在。 */
  allowCreate?: boolean;
  /** 会话被新建 / 后端换 id 时通知外层（对话视图据此改路由，群组据此回填群组）。 */
  onSelectConversation?: (id: string) => void;
  /** 发送成功后刷新外层列表（会话预览 / 群组左栏群对话预览）。 */
  onRefreshList?: () => void;
};

export function useChatSession({
  conversationId,
  roleId,
  allowCreate = false,
  onSelectConversation,
  onRefreshList,
}: UseChatSessionOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [workspace, setWorkspace] = useState<ConversationWorkspace | null>(null);
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [errorTone, setErrorTone] = useState<"danger" | "muted">("danger");
  /** 本轮异常挂在哪个气泡下面（提问气泡 id）；null 表示错误不挂载到具体气泡。 */
  const [errorAnchorId, setErrorAnchorId] = useState<string | null>(null);
  /** 本轮正在回答的问题原文：生成中把「思考流」锁定到这条问题上。 */
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  /** 在途轮次（会话 id + 前端生成的 turn_id）：据此轮询本轮追踪进度。 */
  const [liveTurn, setLiveTurn] = useState<{
    conversationId: string;
    turnId: string;
  } | null>(null);
  /** 在途轮次的思考流节点（追踪实时落库，轮询刷新）。 */
  const [liveSteps, setLiveSteps] = useState<InsightStep[]>([]);
  /** 编辑时回灌到输入框的原文（null 表示无需回灌）。 */
  const [restoreText, setRestoreText] = useState<string | null>(null);
  /** 会话级技能（Composer 受控）；群组不使用，保持空数组。 */
  const [skills, setSkills] = useState<ComposerSkill[]>([]);
  const [metaById, setMetaById] = useState<Record<string, ChatSessionMeta>>({});

  /** 当前在途请求的取消控制器；非 null 表示 Agent 正在生成。 */
  const abortRef = useRef<AbortController | null>(null);
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
  /** 本轮回复已就地回填到占位气泡，切换会话 id 时跳过整表重载（否则气泡会被替换成新组件）。 */
  const skipNextLoadRef = useRef<string | null>(null);
  /** 发送前主库已落库的最大消息 id；清理时只删 id 更大的本轮。 */
  const lastPersistedIdRef = useRef(0);

  const setError = useCallback(
    (message: string | null, tone: "danger" | "muted" = "danger") => {
      setErrorTone(tone);
      setErrorState(message);
      if (!message) setErrorAnchorId(null);
    },
    []
  );

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
    setSkills((data.conversation.skills ?? []).map((slug) => ({ slug, name: slug })));
    try {
      setWorkspace(await getConversationWorkspace(id));
    } catch {
      setWorkspace(null);
    }
  }, []);

  // 切换会话：清掉上一个会话残留的错误（含挂在提问气泡下的那条）。
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setWorkspace(null);
      setSkills([]);
      setError(null);
      return;
    }
    setError(null);
    // 首次发送会新建会话并切过来：回复已就地回填到占位气泡，
    // 再整表重载会把气泡换成新组件，这里直接跳过。
    if (skipNextLoadRef.current === conversationId) {
      skipNextLoadRef.current = null;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await loadConversation(conversationId);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, loadConversation, setError]);

  // 生成中轮询本轮追踪：后端每完成一步就落库，思考流因此能边跑边长。
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

  const send = useCallback(
    async (
      text: string,
      nextSkills?: ComposerSkill[],
      roleOverride?: string | null
    ) => {
      if (sending) return;
      setSending(true);
      setError(null);
      // 群组 @ 指派：roleOverride 覆盖本轮执行角色（其绑定模型即回复模型）。
      const effectiveRoleId = roleOverride ?? roleId;
      // 思考流立刻锁定到本轮问题：占位气泡此时还没有 turn_id，
      // 若不锁定，右侧洞察会继续显示上一轮轨迹，看起来像"没在思考"。
      setPendingQuestion(text);
      setSelectedTurnId(null);
      // 本轮 id 由前端生成：后端按它逐步落追踪，思考流可边等边轮询。
      const turnId = crypto.randomUUID().replace(/-/g, "");
      // 没有当前会话时先建一个（仅对话视图）：否则拿不到轮询追踪所需的 conversation_id。
      let activeConversationId = conversationId;
      if (!activeConversationId) {
        if (!allowCreate) {
          setSending(false);
          setPendingQuestion(null);
          setError("当前没有可发送的会话");
          return;
        }
        try {
          const created = await createConversation("");
          activeConversationId = created.id;
          // 新会话是空的：别让它触发的整表重载清掉下面插入的乐观气泡。
          skipNextLoadRef.current = created.id;
          onSelectConversation?.(created.id);
          onRefreshList?.();
        } catch (err) {
          setSending(false);
          setPendingQuestion(null);
          setError(errorMessage(err));
          return;
        }
      }
      setLiveTurn({ conversationId: activeConversationId, turnId });
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
        { id: optimisticId, role: "user", content: text, actorId: effectiveRoleId ?? null },
        {
          id: pendingId,
          role: "agent",
          content: "",
          streaming: true,
          actorId: effectiveRoleId ?? null,
        },
      ]);
      // Composer 把带 slug 的技能数组回传过来；这里只发 slug（后端按 slug 找到
      // 本机 <data>/skills/<slug>/SKILL.md 注入 role prompt）。用户看到的 chip 名字
      // 只是本地 UI，不进入 API 请求体。
      const slugs = nextSkills?.length ? nextSkills.map((s) => s.slug) : null;
      try {
        const result = await sendChat(
          text,
          activeConversationId,
          effectiveRoleId,
          slugs,
          turnId,
          controller.signal
        );
        // 兜底：后端换了会话（理论上不会），切过去时同样跳过整表重载。
        if (result.conversation_id !== activeConversationId) {
          skipNextLoadRef.current = result.conversation_id;
          onSelectConversation?.(result.conversation_id);
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
        onRefreshList?.();
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
    },
    [
      allowCreate,
      conversationId,
      onRefreshList,
      onSelectConversation,
      roleId,
      sending,
      setError,
    ]
  );

  /** 后端是同步落库，停止 HTTP 后仍可能稍后写入本轮。
   *  轮询删除时必须同时匹配「用户原文」+「id > 发送前 baseline」，
   *  否则本轮未落库时会误删上一轮历史（相同文案连发时仅靠原文也不够）。 */
  const cleanupInFlight = useRef(false);
  const cleanupLastTurn = useCallback(
    async (id: string, userContent: string, afterMessageId: number) => {
      if (cleanupInFlight.current) return;
      cleanupInFlight.current = true;
      try {
        for (let i = 0; i < 8; i++) {
          try {
            const res = await deleteLastTurn(id, { userContent, afterMessageId });
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
  const cancel = useCallback(
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
      if (conversationId && pending?.text) {
        void cleanupLastTurn(conversationId, pending.text, pending.afterMessageId);
      }
    },
    [cleanupLastTurn, conversationId, setError]
  );

  const onRestored = useCallback(() => setRestoreText(null), []);

  return {
    messages,
    workspace,
    selectedTurnId,
    setSelectedTurnId,
    sending,
    error,
    errorTone,
    errorAnchorId,
    pendingQuestion,
    liveSteps,
    restoreText,
    onRestored,
    skills,
    setSkills,
    meta: (conversationId && metaById[conversationId]) || {},
    /** 视图层自建的错误（新建 / 删除会话等）也走同一个展示通道。 */
    setError,
    /** 新建会话时后端工作区就绪后可直接回填，省一次重载。 */
    setWorkspace,
    send,
    cancel,
  };
}
