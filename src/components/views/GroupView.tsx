import { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesSquare, Plus } from "lucide-react";
import {
  createConversation,
  listConversations,
  listRoles,
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
import { avatarUrl } from "../../lib/rolesStore";
import { GroupChat } from "../group/GroupChat";
import { GroupList, type GroupMemberItem, type GroupSummary } from "../group/GroupList";
import { GroupPickerDialog, type PickerItem } from "../group/GroupPickerDialog";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import type { SessionItem } from "../chat/SessionList";
import { ChatView, errorMessage, toSessionItem } from "./ChatView";

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
  /** 每个群组各自记住上次打开的共享会话（不持久化）。 */
  const [sessionByGroup, setSessionByGroup] = useState<Record<string, string | null>>(
    {}
  );
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "members" | "sessions" | null>(null);
  const [newName, setNewName] = useState("");
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
      // 首次进入：兜一个默认群组，成员取全部角色，共享会话取最近的几条，
      // 免得一进来左栏全空、看不出群组视图长什么样。
      setGroups((prev) => {
        if (prev.length > 0) return prev;
        return [
          {
            ...makeGroup("我的群组", 0),
            memberIds: roleRows.map((r) => r.id),
            conversationIds: convRows.slice(0, 5).map((c) => c.id),
          },
        ];
      });
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

  useEffect(() => {
    if (!newGroupRequestId || newGroupRequestId === lastHandledNewGroupId) return;
    lastHandledNewGroupId = newGroupRequestId;
    setNewName(`新群组 ${groups.length + 1}`);
    setDialog("create");
  }, [newGroupRequestId, groups.length]);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0] ?? null;

  const summaries = useMemo<GroupSummary[]>(
    () =>
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        colorClass: g.color,
        memberCount: g.memberIds.length,
        sessionCount: g.conversationIds.length,
      })),
    [groups]
  );

  const members = useMemo<GroupMemberItem[]>(() => {
    if (!activeGroup) return [];
    return activeGroup.memberIds
      .map((id) => roles.find((r) => r.id === id))
      .filter((r): r is RoleRecord => !!r)
      .map((r) => ({
        id: r.id,
        name: r.name,
        initial: r.initial || r.name.slice(0, 1),
        colorClass: TONE_CLASS[r.tone] ?? "bg-brand-500",
        roleLabel: r.primary ? "组长" : "成员",
        avatarUrl: avatarUrl(r.avatar) || undefined,
      }));
  }, [activeGroup, roles]);

  const sessions = useMemo<SessionItem[]>(() => {
    if (!activeGroup) return [];
    const byId = new Map(conversations.map((c) => [c.id, c]));
    return activeGroup.conversationIds.flatMap((id) => {
      const c = byId.get(id);
      return c ? [toSessionItem(c)] : [];
    });
  }, [activeGroup, conversations]);

  const storedSession = activeGroup ? sessionByGroup[activeGroup.id] : undefined;
  const activeSessionId =
    storedSession && activeGroup?.conversationIds.includes(storedSession)
      ? storedSession
      : activeGroup?.conversationIds[0] ?? null;

  /** 会话 id → 群组的共享会话集合（新增 / 移出都走这里）。 */
  const patchGroup = useCallback(
    (groupId: string, patch: (g: ChatGroup) => ChatGroup) => {
      setGroups((prev) => prev.map((g) => (g.id === groupId ? patch(g) : g)));
    },
    []
  );

  const handleSelectSession = useCallback(
    (id: string) => {
      if (!activeGroup) return;
      setSessionByGroup((prev) => ({ ...prev, [activeGroup.id]: id }));
    },
    [activeGroup]
  );

  /** ChatView 在无会话时发送会先建一个会话：把它并进当前群组的共享会话并选中。 */
  const handleSelectConversation = useCallback(
    (id: string | null) => {
      if (!activeGroup) return;
      setSessionByGroup((prev) => ({ ...prev, [activeGroup.id]: id }));
      if (!id) return;
      patchGroup(activeGroup.id, (g) =>
        g.conversationIds.includes(id)
          ? g
          : { ...g, conversationIds: [id, ...g.conversationIds] }
      );
    },
    [activeGroup, patchGroup]
  );

  const handleRemoveMember = useCallback(
    (roleId: string) => {
      if (!activeGroup) return;
      patchGroup(activeGroup.id, (g) => ({
        ...g,
        memberIds: g.memberIds.filter((id) => id !== roleId),
      }));
    },
    [activeGroup, patchGroup]
  );

  const handleAddMembers = useCallback(
    (ids: string[]) => {
      if (!activeGroup || ids.length === 0) return;
      patchGroup(activeGroup.id, (g) => ({
        ...g,
        memberIds: [...g.memberIds, ...ids.filter((id) => !g.memberIds.includes(id))],
      }));
    },
    [activeGroup, patchGroup]
  );

  const handleAddSessions = useCallback(
    (ids: string[]) => {
      if (!activeGroup || ids.length === 0) return;
      patchGroup(activeGroup.id, (g) => ({
        ...g,
        conversationIds: [
          ...ids.filter((id) => !g.conversationIds.includes(id)),
          ...g.conversationIds,
        ],
      }));
      setSessionByGroup((prev) => ({ ...prev, [activeGroup.id]: ids[0] ?? null }));
    },
    [activeGroup, patchGroup]
  );

  const handleRemoveSession = useCallback(
    (id: string) => {
      if (!activeGroup) return;
      patchGroup(activeGroup.id, (g) => ({
        ...g,
        conversationIds: g.conversationIds.filter((cid) => cid !== id),
      }));
      setSessionByGroup((prev) => ({ ...prev, [activeGroup.id]: null }));
    },
    [activeGroup, patchGroup]
  );

  const handleCreateSession = useCallback(async () => {
    if (!activeGroup) return;
    try {
      const created = await createConversation("");
      setConversations((prev) => [created, ...prev]);
      patchGroup(activeGroup.id, (g) => ({
        ...g,
        conversationIds: [created.id, ...g.conversationIds],
      }));
      setSessionByGroup((prev) => ({ ...prev, [activeGroup.id]: created.id }));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [activeGroup, patchGroup]);

  const handleCreateGroup = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const group = makeGroup(name, groups.length);
    setGroups((prev) => [...prev, group]);
    setActiveGroupId(group.id);
    setSessionByGroup((prev) => ({ ...prev, [group.id]: null }));
    setDialog(null);
  }, [groups.length, newName]);

  const confirmDeleteGroup = useCallback(() => {
    if (!pendingDelete) return;
    setGroups((prev) => prev.filter((g) => g.id !== pendingDelete.id));
    if (activeGroupId === pendingDelete.id) setActiveGroupId(null);
    setPendingDelete(null);
  }, [activeGroupId, pendingDelete]);

  const memberCandidates = useMemo<PickerItem[]>(() => {
    if (!activeGroup) return [];
    return roles
      .filter((r) => !activeGroup.memberIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        name: r.name,
        meta: r.primary ? "主角色" : "角色",
        initial: r.initial || r.name.slice(0, 1),
        colorClass: TONE_CLASS[r.tone] ?? "bg-brand-500",
        avatarUrl: avatarUrl(r.avatar) || undefined,
      }));
  }, [activeGroup, roles]);

  const sessionCandidates = useMemo<PickerItem[]>(() => {
    if (!activeGroup) return [];
    return conversations
      .filter((c) => !activeGroup.conversationIds.includes(c.id))
      .map((c) => ({
        id: c.id,
        name: c.title.trim() || "新会话",
        desc: c.last_message?.trim() || c.workspace_dir || "尚无消息",
        meta: c.message_count > 0 ? `${c.message_count} 条` : "空闲",
      }));
  }, [activeGroup, conversations]);

  return (
    <>
      <GroupList
        groups={summaries}
        activeId={activeGroup?.id ?? null}
        onSelect={setActiveGroupId}
        onDeleteGroup={(id) => {
          const g = groups.find((x) => x.id === id);
          setPendingDelete({ id, name: g?.name ?? "该群组" });
        }}
        members={members}
        onInvite={() => setDialog("members")}
        onRemoveMember={handleRemoveMember}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={handleSelectSession}
        onAddSession={() => setDialog("sessions")}
        onRemoveSession={handleRemoveSession}
      />

      {activeGroup ? (
        <GroupChat
          name={activeGroup.name}
          colorClass={activeGroup.color}
          members={members}
          error={error}
        >
          {activeSessionId ? (
            <ChatView
              fixedConversationId={activeSessionId}
              showList={false}
              onSelectConversation={handleSelectConversation}
              onConversationsChange={setConversations}
            />
          ) : (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center bg-surface px-6 text-center">
              <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-tint text-brand-500">
                <MessagesSquare className="size-6" strokeWidth={1.75} />
              </span>
              <h2 className="text-[16px] font-semibold text-ink-900">
                还没有共享会话
              </h2>
              <p className="mt-1.5 max-w-xs text-[13px] leading-6 text-ink-400">
                把已有会话加进群组，或新建一个供成员共享上下文的会话。
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="tint" onClick={() => void handleCreateSession()}>
                  <Plus className="size-3.5" strokeWidth={1.75} />
                  新建共享会话
                </Button>
                <Button variant="ghost" onClick={() => setDialog("sessions")}>
                  添加已有会话
                </Button>
              </div>
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
        open={dialog === "create"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建群组</DialogTitle>
            <DialogDescription>
              创建后可在左栏邀请成员、添加共享会话。
            </DialogDescription>
          </DialogHeader>
          <Input
            value={newName}
            autoFocus
            placeholder="群组名称"
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateGroup();
            }}
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              取消
            </Button>
            <Button variant="primary" disabled={!newName.trim()} onClick={handleCreateGroup}>
              创建
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <GroupPickerDialog
        open={dialog === "members"}
        title="邀请成员"
        description="成员即角色：加入群组的角色共享同一份会话上下文。"
        items={memberCandidates}
        confirmLabel="邀请"
        emptyText="所有角色都已在该群组中"
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onConfirm={handleAddMembers}
      />

      <GroupPickerDialog
        open={dialog === "sessions"}
        title="添加共享会话"
        description="加入群组后，群内成员看到的都是这份会话记录。"
        items={sessionCandidates}
        confirmLabel="添加"
        emptyText="没有可添加的会话"
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onConfirm={handleAddSessions}
      />

      <ConfirmDialog
        open={!!pendingDelete}
        title="删除群组"
        description={
          pendingDelete
            ? `确定删除「${pendingDelete.name}」？群组与其成员、共享会话的关联会一并移除（会话本身不会被删除）。`
            : undefined
        }
        confirmLabel="删除"
        cancelLabel="取消"
        tone="danger"
        onConfirm={confirmDeleteGroup}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
