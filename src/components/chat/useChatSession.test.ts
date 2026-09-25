import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../../api";
import type { ChatMessageRecord, TurnTrace } from "../../api";
import { toChatMessages, toLiveSteps, useChatSession } from "./useChatSession";

vi.mock("../../api", () => ({
  createConversation: vi.fn(),
  deleteLastTurn: vi.fn(),
  getConversation: vi.fn(),
  getConversationWorkspace: vi.fn(),
  getTrace: vi.fn(),
  sendChat: vi.fn(),
}));

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

    expect(api.createConversation).toHaveBeenCalledWith("");
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

    // 收尾：让挂起的请求结束（已被 abort，最终走已取消分支）
    await act(async () => {
      resolveChat(chatReply());
    });
    expect(result.current.sending).toBe(false);
  });
});
