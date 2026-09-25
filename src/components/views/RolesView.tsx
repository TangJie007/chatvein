import { Loader2, Plus, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import {
  createRole,
  deleteRole,
  listModels,
  listRoles,
  updateRole,
  type LlmModelRecord,
  type RoleRecord,
  type UpdateRolePayload,
} from "../../api";
import { makeNewRole } from "../../lib/rolesStore";
import { Button } from "../ui/button";
import { RoleConfig } from "./roles/RoleConfigPanel";
import { RoleListSidebar } from "./roles/RoleListSidebar";
import type { RoleForm } from "./roles/roleForm";

export function RolesView() {
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [models, setModels] = useState<LlmModelRecord[]>([]);
  const [loadingModels, setLoadingModels] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await listRoles();
        if (cancelled) return;
        setRoles(list);
        setActiveId(list[0]?.id ?? "");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载角色失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listModels()
      .then((list) => {
        if (!cancelled) setModels(list);
      })
      .catch(() => {
        /* 模型接口不可用时角色仍可用，仅下拉为空 */
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = roles.find((r) => r.id === activeId) ?? roles[0] ?? null;

  const handleCreate = async () => {
    const payload = makeNewRole(roles.length);
    const created = await createRole(payload);
    setRoles((prev) => [...prev, created]);
    setActiveId(created.id);
  };

  const handleDelete = async (id: string) => {
    const target = roles.find((r) => r.id === id);
    if (target?.primary) return;
    if (!window.confirm(`确定删除角色「${target?.name ?? ""}」？`)) return;
    await deleteRole(id);
    setRoles((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next;
    });
    setActiveId((cur) => (cur === id ? roles.find((r) => r.id !== id)?.id ?? "" : cur));
  };

  const handleSave = async (form: RoleForm) => {
    const payload: UpdateRolePayload = {
      name: form.name,
      description: form.description,
      initial: form.initial,
      avatar: form.avatar,
      prompt: form.prompt,
      model_id: form.model_id,
      tone: form.tone,
      temperature: form.temperature,
      max_tokens: form.max_tokens,
      presence_penalty: form.presence_penalty,
      frequency_penalty: form.frequency_penalty,
      stream: form.stream,
      json_mode: form.json_mode,
      retries: form.retries,
      memory: form.memory,
      enabled: form.enabled,
      tools: form.tools,
      kb: form.kb,
      resident_skills: form.resident_skills,
    };
    const saved = await updateRole(active!.id, payload);
    setRoles((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-400">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        加载角色…
      </div>
    );
  }

  if (error && roles.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[14px] font-medium text-ink-900">无法加载角色</p>
        <p className="max-w-sm text-[12px] text-ink-400">{error}</p>
        <Button
          variant="tint"
          onClick={() => {
            setLoading(true);
            void listRoles()
              .then((list) => {
                setRoles(list);
                setActiveId(list[0]?.id ?? "");
                setError(null);
              })
              .catch((err) =>
                setError(err instanceof Error ? err.message : "加载角色失败")
              )
              .finally(() => setLoading(false));
          }}
        >
          重试
        </Button>
      </div>
    );
  }

  return (
    <>
      <RoleListSidebar
        roles={roles}
        activeId={active?.id ?? ""}
        models={models}
        onSelect={setActiveId}
        onCreate={() => void handleCreate()}
      />

      {/* 内容区：角色配置 */}
      <section className="flex min-w-0 flex-1 flex-col bg-surface">
        {active ? (
          <RoleConfig
            key={active.id}
            role={active}
            models={models}
            loadingModels={loadingModels}
            onSave={handleSave}
            onDelete={() => void handleDelete(active.id)}
          />
        ) : (
          <EmptyState onCreate={() => void handleCreate()} />
        )}
      </section>
    </>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-tint text-brand-600">
        <Sparkles className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-[14px] font-medium text-ink-900">还没有角色</p>
      <p className="mt-1.5 max-w-xs text-[12px] leading-5 text-ink-400">
        建一个角色，给它人格、工具与知识库，不同场景就能各司其职。
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="mt-4 flex items-center gap-1.5 rounded-xl bg-tint px-4 py-2 text-[12.5px] font-medium text-brand-700 shadow-soft transition-colors hover:bg-tint-deep focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
        新建角色
      </button>
    </div>
  );
}
