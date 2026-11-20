import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import { HttpError } from "../../api/client";
import type { ChatMessageRecord, TurnTrace } from "../../api";
import { toChatMessages, toLiveSteps, useChatSession } from "./useChatSession";

vi.mock("../../api", async () => {
  // 单测环境没有可读流：默认让流式直接抛「不支持」，覆盖 sendChat 回落路径。
  class StreamUnsupportedError extends Error {
    constructor() {
      super("test: no readable stream");
      this.name = "StreamUnsupportedError";
    }
  }
  // 真实错误类：`useChatSession` 用 `instanceof HttpError` 判分支（见 4.3），
  // 这里要是自己捏一个类，判断永远为假、用例会跑偏。
  const { HttpError } = await vi.importActual<typeof import("../../api/client")>(
    "../../api/client"
  );
  return {
    HttpError,
    StreamUnsupportedError,
    cancelChat: vi.fn().mockResolvedValue({ turn_id: "t", accepted: true }),
    createConversation: vi.fn(),
    deleteLastTurn: vi.fn(),
    getConversation: vi.fn(),
    getConversationWorkspace: vi.fn(),
    getTrace: vi.fn(),
    listResumable: vi.fn().mockResolvedValue({ turns: [] }),
    resumeTurn: vi.fn(),
    sendChat: vi.fn(),
    sendChatStream: vi.fn(() => Promise.reject(new StreamUnsupportedError())),
  };
});

/** 最小的成功回复：sendChat 成功路径用到的字段都在这里。 */
function chatReply(overrides: Record<string, unknown> = {}) {
  return {
    reply: "hi there",
    difficulty: "easy",
    selected_tools: ["read_file"],
    route: "hard",
    turn_id: "tr-1",
    tokens: 5,
    duration_ms: 300,
    conversation_id: "c1",
    user_message: { id: 1 },
    assistant_message: { id: 2 },
    ...overrides,
  };
}

describe("toChatMessages（数据库消息 → 气泡）", () => {
  it("映射角色并把 turn / token / 耗时 / 执行者元数据带过来", () => {
    const rows = [
      { id: 1, conversation_id: "c1", role: "user", content: "hi", used_llm: false, route: null, created_at: "t", turn_id: null, tokens: null, duration_ms: null, actor_id: null },
      { id: 2, conversation_id: "c1", role: "assistant", content: "yo", used_llm: true, route: "hard", created_at: "t", turn_id: "tr-1", tokens: 12, duration_ms: 340, actor_id: "r1" },
      { id: 3, conversation_id: "c1", role: "system", content: "sys", used_llm: false, route: null, created_at: "t", turn_id: null, tokens: null, duration_ms: null, actor_id: null },
    ] satisfies ChatMessageRecord[];
    const msgs = toChatMessages(rows);
    expect(msgs.map((m) => m.role)).toEqual(["user", "agent", "system"]);
    expect(msgs[1]).toMatchObject({
      id: "2",
      content: "yo",
      turnId: "tr-1",
      tokens: 12,
      durationMs: 340,
      actorId: "r1",
    });
  });
});

describe("toLiveSteps（在途追踪 → 思考流节点）", () => {
  it("产出路由/计划思考、LLM 状态与工具调用；离线兜底不占思考流", () => {
    const trace = {
      route_reason: "走硬流程",
      tool_plan_reason: "先读文件再执行",
      steps: [
        { id: "s1", parent_id: null, kind: "llm", name: "deepseek", status: "running", model: "deepseek-v3" },
        { id: "s2", parent_id: null, kind: "llm", name: "offline", status: "offline", model: null },
        { id: "s3", parent_id: null, kind: "tool", name: "read_file", status: "ok", arguments: { path: "/a" }, result: "contents" },
        { id: "s4", parent_id: null, kind: "tool", name: "bash", status: "running", arguments: { cmd: "ls" }, result: "" },
      ],
    } as unknown as TurnTrace;
    const steps = toLiveSteps(trace);
    expect(steps.map((s) => s.kind)).toEqual(["thought", "thought", "thought", "tool", "tool"]);
    expect(steps[2]).toMatchObject({ kind: "thought", text: "调用 deepseek-v3 推理中…" });
    // offline LLM 被跳过；工具调用带上参数、状态与结果
    expect(steps[3]).toMatchObject({
      kind: "tool",
      tool: "read_file",
      args: '{"path":"/a"}',
      status: "ok",
      result: "contents",
    });
    // 执行中的工具：状态按"未出错"显示，结果占位为"执行中…"
    expect(steps[4]).toMatchObject({ tool: "bash", status: "ok", result: "执行中…" });
  });
});

describe("useChatSession（发送 / 撤回 / 清理基线）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getConversation).mockResolvedValue({
      conversation: { id: "c1", title: "t", skills: [] },
      messages: [],
    } as never);
    vi.mocked(api.getConversationWorkspace).mockResolvedValue({} as never);
    vi.mocked(api.getTrace).mockResolvedValue({
      route_reason: "",
      tool_plan_reason: "",
      steps: [],
    } as never);
    // 默认回落到 sendChat（单测无真流）；单个用例可覆盖成「流式可用」。
    vi.mocked(api.sendChatStream).mockImplementation(() =>
      Promise.reject(new api.StreamUnsupportedError())
    );
  });

  it("流式：token 增量追加到占位气泡，done 事件回填权威消息", async () => {
    vi.mocked(api.sendChatStream).mockImplementation(
      (_text, _conv, _role, _skills, _turn, _signal, _append, _group, onEvent) => {
        onEvent?.({ event: "token", data: { text: "你" } });
        onEvent?.({ event: "token", data: { text: "好" } });
        onEvent?.({ event: "done", data: chatReply({ reply: "你好" }) });
        return Promise.resolve();
      }
    );

    const { result } = renderHook(() =>
      useChatSession({ conversationId: "c1", roleId: null })
    );
    await settleInitialLoad();

    await act(async () => {
      await result.current.send("hello");
    });

    expect(api.sendChat).not.toHaveBeenCalled();
    expect(api.sendChatStream).toHaveBeenCalledTimes(1);
    const agent = result.current.messages.find((m) => m.role === "agent");
    expect(agent?.content).toBe("你好");
    expect(result.current.sending).toBe(false);
  });

  /** 等初始会话加载的异步落定（getConversation → getConversationWorkspace 链），
   *  避免它的 setMessages([]) 在乐观气泡插入之后执行而把它们清空。 */
  async function settleInitialLoad() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("发送：乐观气泡插入 → 回复写回占位 → 基线抬高到本轮落库 id", async () => {
    vi.mocked(api.sendChat).mockResolvedValue(chatReply() as never);

    const { result } = renderHook(() =>
      useChatSession({ conversationId: "c1", roleId: null })
    );
    await settleInitialLoad();

    await act(async () => {
      await result.current.send("hello");
    });

    // 请求参数：文本、会话、默认角色、技能 null、前端生成 turn_id、信号、落用户消息、群成员 null
    const [, convId, roleId, slugs, turnId, , appendUser, groupMembers] =
      vi.mocked(api.sendChat).mock.calls[0] as unknown[];
    expect(convId).toBe("c1");
    expect(roleId).toBeNull();
    expect(slugs).toBeNull();
    expect(typeof turnId).toBe("string");
    expect(appendUser).toBe(true);
    expect(groupMembers).toBeNull();

    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(result.current.messages[1]).toMatchObject({
      role: "agent",
      content: "hi there",
      streaming: false,
      turnId: "tr-1",
      tokens: 5,
      durationMs: 300,
    });
    expect(result.current.sending).toBe(false);
    expect(result.current.selectedTurnId).toBe("tr-1");
  });

  it("发送：无会话时先建一个再发（allowCreate），并通知外层切换", async () => {
    vi.mocked(api.createConversation).mockResolvedValue({ id: "c9" } as never);
    vi.mocked(api.sendChat).mockResolvedValue(
      chatReply({ conversation_id: "c9" }) as never
    );
    const onSelect = vi.fn();
    const onRefresh = vi.fn();

    const { result } = renderHook(() =>
      useChatSession({
        conversationId: null,
        roleId: null,
        allowCreate: true,
        onSelectConversation: onSelect,
        onRefreshList: onRefresh,
      })
    );
    await settleInitialLoad();

    await act(async () => {
      await result.current.send("hello");
    });

    expect(api.createConversation).toHaveBeenCalledWith("", null);
    expect(onSelect).toHaveBeenCalledWith("c9");
    expect(vi.mocked(api.sendChat).mock.calls[0]![1]).toBe("c9");
    expect(result.current.messages).toHaveLength(2);
  });

  it("撤回：中止在途请求、摘掉乐观气泡，并按发送前基线清理本轮", async () => {
    let resolveChat: (value: unknown) => void = () => {};
    vi.mocked(api.sendChat).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveChat = resolve as (value: unknown) => void;
        }) as ReturnType<typeof api.sendChat>
    );
    vi.mocked(api.deleteLastTurn).mockResolvedValue({ deleted: 1 } as never);

    const { result } = renderHook(() =>
      useChatSession({ conversationId: "c1", roleId: null })
    );
    await settleInitialLoad();

    act(() => {
      void result.current.send("hello");
    });
    // 请求挂起期间，乐观气泡已经插入
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.sending).toBe(true);

    act(() => {
      result.current.cancel("recall");
    });

    // 气泡被摘掉，错误通道清空
    expect(result.current.messages).toHaveLength(0);
    expect(result.current.sending).toBe(false);
    expect(result.current.error).toBeNull();
    // 清理基线：只删「原文匹配 + id 大于发送前最大消息 id」的本轮
    expect(api.deleteLastTurn).toHaveBeenCalledWith("c1", {
      userContent: "hello",
      afterMessageId: 0,
    });
    // 真·取消：把本轮 turn_id 报给后端，否则后端会把剩余步骤全部跑完
    const [notifiedTurnId] = vi.mocked(api.cancelChat).mock.calls[0] as [string];
    expect(typeof notifiedTurnId).toBe("string");
    expect(notifiedTurnId.length).toBeGreaterThan(0);

    // 收尾：让挂起的请求结束（已被 abort，最终走已取消分支）
    await act(async () => {
      resolveChat(chatReply());
    });
    expect(result.current.sending).toBe(false);
  });

  it("中断不是用户发起时：摘掉思考中的空气泡，并报真实原因而非「已取消」", async () => {
    // 客户端超时 / 连接断开：signal 未被 abort，不属于用户取消
    vi.mocked(api.sendChat).mockRejectedValue(new DOMException("boom", "AbortError"));

    const { result } = renderHook(() =>
      useChatSession({ conversationId: "c1", roleId: null })
    );
    await settleInitialLoad();

    await act(async () => {
      await result.current.send("帮我把这张图扣一下");
    });

    // 只剩提问气泡：占位的助手气泡不能永远停在「思考中」
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: "user" });
    expect(result.current.sending).toBe(false);
    expect(result.current.error).toBe("本轮生成已中断，未收到结果");
  });

  it("重试：先摘掉失败轮的提问气泡，同一句不会在界面上出现两次", async () => {
    vi.mocked(api.sendChat).mockReset();
    vi.mocked(api.sendChat).mockRejectedValueOnce(
      new HttpError(429, "模型触发限流", {
        code: "MODEL_RATE_LIMIT",
        retryable: true,
        stage: "model",
      })
    );

    const { result } = renderHook(() =>
      useChatSession({ conversationId: "c1", roleId: null })
    );
    await settleInitialLoad();

    await act(async () => {
      await result.current.send("重试这一句");
    });
    // 失败轮：提问气泡留下（错误挂在它下面），错误码推导出「再试一次」
    expect(result.current.errorAction).toBe("retry");
    expect(result.current.messages.filter((m) => m.role === "user")).toHaveLength(1);

    vi.mocked(api.sendChat).mockResolvedValueOnce(chatReply() as never);
    await act(async () => {
      await result.current.retryLastFailure();
    });

    const users = result.current.messages.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]?.content).toBe("重试这一句");
    expect(result.current.error).toBeNull();
  });
});
