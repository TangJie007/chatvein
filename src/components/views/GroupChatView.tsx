import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listModels,
  openArtifactLocation,
  type LlmModelRecord,
  type RoleRecord,
} from "../../api";
import { avatarUrl } from "../../lib/rolesStore";
import { contextUsage } from "../../lib/tokens";
import { ChatPanel, type MemberAvatar } from "../chat/ChatPanel";
import { buildInsightArtifacts, buildInsightThread } from "../chat/insightData";
import { useChatSession } from "../chat/useChatSession";

const TONE_CLASS: Record<string, string> = {
  brand: "bg-brand-500",
  violet: "bg-violet-400",
  teal: "bg-teal-400",
  amber: "bg-amber-400",
  peach: "bg-peach-400",
};

type GroupChatViewProps = {
  /** 该群组独占的群对话。 */
  conversationId: string;
  /** 群成员（= 角色）：主成员作为发送角色，其绑定模型决定上下文窗口口径。 */
  members: RoleRecord[];
  /** 发送成功后刷新外层会话列表（左栏群对话的预览 / 时间）。 */
  onRefreshList?: () => void;
};

/** 群组聊天：与对话视图共用会话引擎，但面板是独立的 group 变体——
 *  不显示模型名、输入区上方没有用量条、没有技能，上下文用量放在气泡上方。 */
export function GroupChatView({
  conversationId,
  members,
  onRefreshList,
}: GroupChatViewProps) {
  const [models, setModels] = useState<LlmModelRecord[]>([]);
  const [insightOpen, setInsightOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void listModels()
      .then((rows) => {
        if (!cancelled) setModels(rows);
      })
      .catch(() => {
        /* backend may still be starting */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeRole = members.find((r) => r.primary) ?? members[0] ?? null;

  // 群成员 → 气泡头像 / @ 指派弹层共用的展示信息。
  const memberAvatars = useMemo<MemberAvatar[]>(
    () =>
      members.map((r) => ({
        id: r.id,
        name: r.name,
        colorClass: TONE_CLASS[r.tone] ?? "bg-brand-500",
        avatarUrl: avatarUrl(r.avatar) || undefined,
      })),
    [members]
  );

  const chat = useChatSession({
    conversationId,
    roleId: activeRole?.id ?? null,
    // 群对话由建群流程保证存在：不允许在群里临时建会话。
    allowCreate: false,
    // 群成员随每次发送透传 group_members：后端补注册 + 装配团队模式
    // （delegate_to_agent 分工），即使建群时注册失败这里也能兜底补上。
    groupMemberIds: members.map((r) => r.id),
    onRefreshList,
  });
  const {
    messages,
    workspace,
    selectedTurnId,
    sending,
    error,
    errorTone,
    errorAnchorId,
    pendingQuestion,
    liveSteps,
    restoreText,
    onRestored,
    cancel,
    send,
  } = chat;

  const boundModel = activeRole?.model_id
    ? models.find((m) => m.id === activeRole.model_id) ?? null
    : null;
  // 群组不展示模型名，但用量需要一个窗口口径：取发送角色绑定的模型，缺失则回落 128K。
  const { pct: contextPct, title: contextTitle } = contextUsage(
    messages,
    boundModel?.context_window_k ?? 128
  );

  const insightThread = useMemo(
    () => buildInsightThread(workspace, selectedTurnId),
    [selectedTurnId, workspace]
  );
  const artifacts = useMemo(() => buildInsightArtifacts(workspace), [workspace]);

  const handleRevealArtifact = useCallback(
    (path: string) => {
      void openArtifactLocation(conversationId, path).catch(() => {
        /* 打开失败静默忽略（路径越界 / 文件管理器异常） */
      });
    },
    [conversationId]
  );

  /** 占位气泡里的进度文案：优先显示本轮正在跑的那一步。 */
  const thinkingHint = useMemo(() => {
    for (let i = liveSteps.length - 1; i >= 0; i--) {
      const step = liveSteps[i];
      if (!step) continue;
      if (step.kind === "tool") return `正在调用 ${step.tool}…`;
      if (step.kind === "thought" && step.text.includes("推理中")) return step.text;
    }
    return null;
  }, [liveSteps]);

  return (
    <ChatPanel
      variant="group"
      conversationId={conversationId}
      messages={messages}
      insightOpen={insightOpen}
      onToggleInsight={() => setInsightOpen((v) => !v)}
      roleName={activeRole?.name}
      roleAvatar={activeRole?.avatar}
      contextPct={contextPct}
      contextTitle={contextTitle}
      sending={sending}
      error={error}
      errorTone={errorTone}
      errorAnchorId={errorAnchorId}
      workspaceDir={workspace?.workspace_dir}
      insightThread={insightThread}
      artifacts={artifacts}
      onRevealArtifact={handleRevealArtifact}
      selectedTurnId={selectedTurnId}
      onSelectMessage={(tid) => chat.setSelectedTurnId(tid)}
      live={
        sending && pendingQuestion ? { goal: pendingQuestion, steps: liveSteps } : null
      }
      thinkingHint={sending ? thinkingHint : null}
      onStop={() => cancel("stop")}
      onEditMessage={() => cancel("edit")}
      onRecallMessage={() => cancel("recall")}
      restoreText={restoreText}
      onRestored={onRestored}
      members={memberAvatars}
      mentionOptions={memberAvatars}
      onSend={(text, _skills, mentionIds) => {
        // @ 点名到的成员各答一轮；没人被点名时交给组长（默认角色）。
        void send(text, undefined, mentionIds);
      }}
    />
  );
}
