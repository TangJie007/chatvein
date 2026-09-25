import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createConversation,
  deleteConversation,
  getConversationWorkspace,
  listConversations,
  listModels,
  listRoles,
  openArtifactLocation,
  openConversationWorkspace,
  updateConversationSkills,
  type LlmModelRecord,
  type RoleRecord,
} from "../../api";
import { errorMessage } from "../../lib/errors";
import { contextUsage } from "../../lib/tokens";
import { openTraceWindow } from "../../lib/openTrace";
import { VIEW_PATH } from "../../types/view";
import { ChatPanel } from "../chat/ChatPanel";
import type { ComposerSkill } from "../chat/Composer";
import { buildInsightArtifacts, buildInsightThread } from "../chat/insightData";
import { SessionList, toSessionItem, type SessionItem } from "../chat/SessionList";
import { CreatingOverlay } from "../chat/CreatingOverlay";
import { useChatSession } from "../chat/useChatSession";
import { loadGroups } from "../../lib/groupsStore";
import { CREATE_MIN_MS, CREATE_STEPS, sleep } from "../../lib/creationSteps";
import { ConfirmDialog } from "../ui/confirm-dialog";

/** Survives ChatView remount so sticky newRequestId from App doesn't re-create. */
let lastHandledNewRequestId = 0;

type ChatViewProps = {
  newRequestId?: number;
  onConversationCount?: (n: number) => void;
};

/** 对话视图：会话列表 + 会话头 + 模型条 + 技能，消息收发走共享会话引擎。 */
export function ChatView({ newRequestId = 0, onConversationCount }: ChatViewProps) {
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
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [models, setModels] = useState<LlmModelRecord[]>([]);
  const [roleId, setRoleId] = useState<string | null>(null);
  /** 新建会话进行中的步骤下标；null 表示不在创建中（遮罩隐藏）。 */
  const [createStep, setCreateStep] = useState<number | null>(null);
  /** 待二次确认的删除目标。 */
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refreshList = useCallback(async () => {
    const rows = await listConversations(80);
    // 群组是独立的群对话，不属于普通会话列表：过滤掉群组已占用的会话。
    const groupConversationIds = new Set(
      loadGroups().flatMap((g) => (g.conversationId ? [g.conversationId] : []))
    );
    const visible = rows.filter((c) => !groupConversationIds.has(c.id));
    setSessions(visible.map(toSessionItem));
    onConversationCount?.(visible.length);
    return visible;
  }, [onConversationCount]);

  const refreshListRef = useRef(refreshList);
  refreshListRef.current = refreshList;

  const chat = useChatSession({
    conversationId: activeId,
    roleId,
    allowCreate: true,
    onSelectConversation: selectConversation,
    onRefreshList: () => {
      void refreshListRef.current();
    },
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
    skills,
    setSkills,
    meta,
    setError,
    setWorkspace,
    send,
    cancel,
  } = chat;

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
  }, [setError, setWorkspace]);

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
        setSkills([]);
        setError(null);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [newRequestId, selectConversation, createConversationWithProgress, setError, setSkills]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q)
    );
  }, [query, sessions]);

  const session = sessions.find((s) => s.id === activeId) ?? null;
  const activeRole =
    roles.find((role) => role.id === roleId) ??
    roles.find((role) => role.primary) ??
    null;
  const boundModel = activeRole?.model_id
    ? models.find((model) => model.id === activeRole.model_id) ?? null
    : null;
  const resolvedModelName = boundModel?.name ?? "（未配置模型）";
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
      setSkills(next);
      if (activeId) {
        void updateConversationSkills(
          activeId,
          next.map((s) => s.slug)
        ).catch((err: unknown) => {
          setError(errorMessage(err));
        });
      }
    },
    [activeId, setError, setSkills]
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
          meta={meta}
          onStop={() => cancel("stop")}
          onEditMessage={() => cancel("edit")}
          onRecallMessage={() => cancel("recall")}
          restoreText={restoreText}
          onRestored={onRestored}
          workspaceDir={workspace?.workspace_dir}
          conversationId={activeId}
          insightThread={insightThread}
          artifacts={artifacts}
          onRevealArtifact={handleRevealArtifact}
          selectedTurnId={selectedTurnId}
          onSelectMessage={(tid) => chat.setSelectedTurnId(tid)}
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
          onSend={(text, nextSkills) => {
            void send(text, nextSkills);
          }}
          skills={skills}
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
