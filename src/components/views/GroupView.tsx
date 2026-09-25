import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createConversation,
  deleteConversation,
  getConversationWorkspace,
  listConversations,
  listRoles,
  registerGroupMembers,
  type ConversationRecord,
  type RoleRecord,
  type RoleTone,
} from "../../api";
import {
  loadGroups,
  makeGroup,
  saveGroups,
  type ChatGroup,
} from "../../lib/groupsStore";
import { errorMessage } from "../../lib/errors";
import { avatarUrl } from "../../lib/rolesStore";
import { CREATE_MIN_MS, CREATE_STEPS, sleep } from "../../lib/creationSteps";
import { CreatingOverlay } from "../chat/CreatingOverlay";
import { GroupChat } from "../group/GroupChat";
import { GroupList, type GroupMemberItem, type GroupSummary } from "../group/GroupList";
import { PickerOptionList, type PickerItem } from "../group/PickerOptionList";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { toSessionItem, type SessionItem } from "../chat/SessionList";
import { GroupChatView } from "./GroupChatView";

const TONE_CLASS: Record<RoleTone, string> = {
  brand: "bg-brand-500",
  violet: "bg-violet-400",
  teal: "bg-teal-400",
  amber: "bg-amber-400",
  peach: "bg-peach-400",
};

/** App 的「新建群组」计数是 sticky 的：重进群组视图不该再弹一次创建框。 */
let lastHandledNewGroupId = 0;

type GroupViewProps = {
  newGroupRequestId?: number;
  onGroupCount?: (n: number) => void;
};

export function GroupView({ newGroupRequestId = 0, onGroupCount }: GroupViewProps) {
  const [groups, setGroups] = useState<ChatGroup[]>(loadGroups);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 建群弹窗：名称 + 成员一次选完。 */
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /** 建群初始化进行中的步骤下标；null 表示不在创建中（遮罩隐藏）。 */
  const [createStep, setCreateStep] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(
    null
  );

  // 群组本地持久化：后端暂无群组表，任何改动即时落盘。
  useEffect(() => {
    saveGroups(groups);
  }, [groups]);

  useEffect(() => {
    onGroupCount?.(groups.length);
  }, [groups.length, onGroupCount]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [roleRows, convRows] = await Promise.all([
        listRoles(),
        listConversations(80),
      ]);
      setRoles(roleRows);
      setConversations(convRows);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 群组被删光 / 首次建好时，保证有一个选中项。
  useEffect(() => {
    if (!activeGroupId && groups.length > 0) setActiveGroupId(groups[0]!.id);
  }, [activeGroupId, groups]);

  const openCreate = useCallback(() => {
    setNewName(`新群组 ${groups.length + 1}`);
    // 默认把主角色带上，省得每次都从头勾。
    setNewMembers(roles.filter((r) => r.primary).map((r) => r.id));
    setCreateError(null);
    setCreateOpen(true);
  }, [groups.length, roles]);

  useEffect(() => {
    if (!newGroupRequestId || newGroupRequestId === lastHandledNewGroupId) return;
    lastHandledNewGroupId = newGroupRequestId;
    openCreate();
  }, [newGroupRequestId, openCreate]);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null;

  const patchGroup = useCallback(
    (groupId: string, patch: (g: ChatGroup) => ChatGroup) => {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? patch(g) : g)));
    },
    []
  );

  /** 只刷新会话列表（发完一条消息后更新左栏群对话的预览 / 时间）。 */
  const refreshConversations = useCallback(async () => {
    try {
      setConversations(await listConversations(80));
    } catch {
      /* 列表刷新失败不打断聊天，下一轮再刷 */
    }
  }, []);

  // 群组即群对话：群对话缺失时（建群失败、会话被删）补建一条，避免右栏无对象可聊。
  const creatingConvRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeGroup || activeGroup.conversationId) return;
    if (creatingConvRef.current === activeGroup.id) return;
    creatingConvRef.current = activeGroup.id;
    void (async () => {
      try {
        const conv = await createConversation(activeGroup.name);
        setConversations((prev) => [conv, ...prev]);
        patchGroup(activeGroup.id, (g) => ({ ...g, conversationId: conv.id }));
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        creatingConvRef.current = null;
      }
    })();
  }, [activeGroup, patchGroup]);

  const summaries = useMemo<GroupSummary[]>(() => {
    const byId = new Map(conversations.map((c) => [c.id, c]));
    return groups.map((g) => {
      const conv = g.conversationId ? byId.get(g.conversationId) : undefined;
      const item: SessionItem | null = conv ? toSessionItem(conv) : null;
      return {
        id: g.id,
        name: g.name,
        colorClass: g.color,
        preview: item?.preview ?? "尚无消息",
        time: item?.time ?? "",
        memberCount: g.memberIds.length,
      };
    });
  }, [groups, conversations]);

  /** 群成员对应的角色实体：既是右侧头像堆叠的数据源，也是群对话的发送角色来源。 */
  const memberRoles = useMemo<RoleRecord[]>(() => {
    if (!activeGroup) return [];
    return activeGroup.memberIds
      .map((id) => roles.find((r) => r.id === id))
      .filter((r): r is RoleRecord => !!r);
  }, [activeGroup, roles]);

  const members = useMemo<GroupMemberItem[]>(
    () =>
      memberRoles.map((r) => ({
        id: r.id,
        name: r.name,
        initial: r.initial || r.name.slice(0, 1),
        colorClass: TONE_CLASS[r.tone] ?? "bg-brand-500",
        roleLabel: r.primary ? "组长" : "成员",
        avatarUrl: avatarUrl(r.avatar) || undefined,
      })),
    [memberRoles]
  );

  const memberOptions = useMemo<PickerItem[]>(
    () =>
      roles.map((r) => ({
        id: r.id,
        name: r.name,
        meta: r.primary ? "主角色" : "角色",
        initial: r.initial || r.name.slice(0, 1),
        colorClass: TONE_CLASS[r.tone] ?? "bg-brand-500",
        avatarUrl: avatarUrl(r.avatar) || undefined,
      })),
    [roles]
  );

  const creatingRef = useRef(false);
  const handleCreateGroup = useCallback(async () => {
    const name = newName.trim();
    // 连点「创建」时只跑一次：否则两个群一起建，遮罩也会被前一个收尾提前关掉。
    if (!name || creating || creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    // 关掉弹窗，改由全屏遮罩展示初始化进度（与创建工作区一致）。
    setCreateOpen(false);
    setCreateStep(0);
    try {
      // 群组即群对话：建群的同时开好这条群对话，并初始化工作区。
      const [conv] = await Promise.all([
        createConversation(name),
        sleep(CREATE_MIN_MS),
      ]);
      setCreateStep(1);
      // 工作区目录 / 会话库初始化：等后端真正就绪。
      // 群成员注册到后端 chat_groups 表（团队模式花名册 / 跨设备恢复依赖它）；
      // 失败不阻断建群，发送时随消息透传 group_members 会兜底补注册。
      await Promise.all([
        registerGroupMembers(conv.id, newMembers).catch(() => {}),
        getConversationWorkspace(conv.id).catch(() => null),
        sleep(280),
      ]);
      setCreateStep(2);
      await sleep(220);
      setCreateStep(CREATE_STEPS.length);
      await sleep(240);
      const group: ChatGroup = {
        ...makeGroup(name, groups.length),
        memberIds: newMembers,
        conversationId: conv.id,
      };
      setConversations((prev) => [conv, ...prev]);
      setGroups((prev) => [...prev, group]);
      setActiveGroupId(group.id);
    } catch (err) {
      // 失败时重新打开弹窗，保留输入与错误提示。
      setCreateOpen(true);
      setCreateError(errorMessage(err));
    } finally {
      creatingRef.current = false;
      setCreating(false);
      setCreateStep(null);
    }
  }, [creating, groups.length, newMembers, newName]);

  /** 群组即群对话：删群连带删掉那条群对话，避免留下无主的会话。 */
  const confirmDeleteGroup = useCallback(async () => {
    if (!pendingDelete) return;
    const target = groups.find((g) => g.id === pendingDelete.id);
    if (target?.conversationId) {
      try {
        await deleteConversation(target.conversationId);
      } catch {
        /* 会话已不存在时忽略，群组照样移除 */
      }
    }
    setGroups((prev) => prev.filter((g) => g.id !== pendingDelete.id));
    if (activeGroupId === pendingDelete.id) setActiveGroupId(null);
    setPendingDelete(null);
  }, [activeGroupId, groups, pendingDelete]);

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <GroupList
        groups={summaries}
        activeId={activeGroup?.id ?? null}
        onSelect={setActiveGroupId}
        onDeleteGroup={(id) => {
          const g = groups.find((x) => x.id === id);
          setPendingDelete({ id, name: g?.name ?? "该群组" });
        }}
      />

      {activeGroup ? (
        <GroupChat
          name={activeGroup.name}
          colorClass={activeGroup.color}
          members={members}
          error={error}
        >
          {activeGroup.conversationId ? (
            <GroupChatView
              conversationId={activeGroup.conversationId}
              members={memberRoles}
              onRefreshList={() => {
                void refreshConversations();
              }}
            />
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-surface">
              <p className="text-[13px] text-ink-400">正在创建群对话…</p>
            </div>
          )}
        </GroupChat>
      ) : (
        <section className="flex min-h-0 min-w-0 flex-1 items-center justify-center bg-surface">
          <p className="text-[13px] text-ink-400">
            {loading ? "正在加载群组…" : "暂无群组，点左上角「新建群组」创建一个"}
          </p>
        </section>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (!open) setCreateOpen(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建群组</DialogTitle>
            <DialogDescription>
              一个群组就是一条群对话，成员在这里一次选好。
            </DialogDescription>
          </DialogHeader>

          <Input
            value={newName}
            autoFocus
            placeholder="群组名称"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreateGroup();
            }}
          />

          <div className="mt-3">
            <p className="mb-1.5 px-1 text-[11px] font-medium text-ink-400">
              成员（已选 {newMembers.length} 个角色）
            </p>
            <PickerOptionList
              items={memberOptions}
              picked={newMembers}
              onToggle={(id) =>
                setNewMembers((prev) =>
                  prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
                )
              }
              emptyText="还没有可添加的角色，请先在「角色」里创建"
            />
          </div>

          {createError ? (
            <p className="mt-2 rounded-xl bg-danger-50 px-3 py-2 text-[12.5px] text-danger-600">
              {createError}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!newName.trim() || creating}
              onClick={() => void handleCreateGroup()}
            >
              {creating ? "创建中…" : "创建"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 新建群组：与创建工作区一致的分阶段初始化进度（至少展示 1s） */}
      {createStep !== null ? (
        <CreatingOverlay steps={CREATE_STEPS} active={createStep} />
      ) : null}

      <ConfirmDialog
        open={!!pendingDelete}
        title="删除群组"
        description={
          pendingDelete
            ? `确定删除「${pendingDelete.name}」？该群组的群对话会一并删除，消息与工作区无法恢复。`
            : undefined
        }
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        onConfirm={() => {
          void confirmDeleteGroup();
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
