import {
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Play,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  createRole,
  deleteRole,
  listModels,
  listRoles,
  updateRole,
  type LlmModelRecord,
  type RoleRecord,
  type RoleTone,
  type UpdateRolePayload,
} from "../../api";
import { cn } from "../../lib/cn";
import { makeNewRole, TOOLSET } from "../../lib/rolesStore";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";

/* 角色头像 / 标签的色调，沿用参考设计的色板（chatvein tokens 已具备）。 */
const TONE: Record<
  RoleTone,
  { avatar: string; chip: string }
> = {
  brand: { avatar: "bg-brand-500", chip: "bg-brand-50 text-brand-700" },
  violet: { avatar: "bg-violet-400", chip: "bg-violet-50 text-violet-600" },
  teal: { avatar: "bg-teal-400", chip: "bg-teal-50 text-teal-600" },
  amber: { avatar: "bg-amber-400", chip: "bg-warn-50 text-warn-600" },
  peach: { avatar: "bg-peach-400", chip: "bg-warn-50 text-warn-600" },
};

type RoleForm = Omit<RoleRecord, "id" | "sessions" | "primary"> & {
  id: string;
  sessions: number;
  primary: boolean;
};

function toForm(role: RoleRecord): RoleForm {
  return { ...role };
}

function modelLabel(modelId: string, models: LlmModelRecord[]): string {
  if (!modelId) return "主对话模型";
  return models.find((m) => m.id === modelId)?.name ?? "主对话模型";
}

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
      initial: form.initial,
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
      {/* 二级导航：角色列表 */}
      <section className="flex w-[220px] shrink-0 flex-col bg-list select-none">
        <div className="shrink-0 px-3 pb-1.5 pt-3.5">
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-[11px] font-medium text-ink-400">
              角色 · {roles.length}
            </p>
            <button
              type="button"
              title="新建角色"
              onClick={() => void handleCreate()}
              className="flex size-5 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-tint hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
          <div className="flex flex-col gap-1">
            {roles.map((r) => {
              const isActive = r.id === active?.id;
              const tone = TONE[r.tone] || TONE.brand;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setActiveId(r.id)}
                  className={cn(
                    "flex w-full flex-col gap-0.5 rounded-xl px-2.5 py-1.5 text-left transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-brand-600",
                    isActive ? "bg-surface shadow-soft" : "hover:bg-tint/60"
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold text-white",
                        tone.avatar
                      )}
                    >
                      {r.initial}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[12.5px]",
                        isActive ? "font-medium text-ink-900" : "text-ink-500"
                      )}
                    >
                      {r.name}
                    </span>
                    {r.primary && (
                      <span className="shrink-0 rounded-full bg-brand-50 px-1.5 text-[9.5px] font-medium text-brand-700">
                        主
                      </span>
                    )}
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        r.enabled ? "bg-ok-500" : "bg-ink-300"
                      )}
                    />
                  </span>
                  <span className="truncate pl-[28px] text-[10px] text-ink-400">
                    {modelLabel(r.model_id, models)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 px-3 pb-3">
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-tint px-3 py-1.5 text-[12.5px] font-medium text-brand-700 shadow-soft transition-colors hover:bg-tint-deep focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            新建角色
          </button>
        </div>
      </section>

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

/* ---------------- 角色配置 ---------------- */

type RoleConfigProps = {
  role: RoleRecord;
  models: LlmModelRecord[];
  loadingModels: boolean;
  onSave: (form: RoleForm) => Promise<void>;
  onDelete: () => void;
};

function RoleConfig({ role, models, loadingModels, onSave, onDelete }: RoleConfigProps) {
  const tone = TONE[role.tone] || TONE.brand;
  const [form, setForm] = useState<RoleForm>(() => toForm(role));
  const set = <K extends keyof RoleForm>(key: K, value: RoleForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const toggleTool = (id: string) =>
    set(
      "tools",
      form.tools.includes(id)
        ? form.tools.filter((t) => t !== id)
        : [...form.tools, id]
    );

  const [saved, setSaved] = useState(false);
  const handleSave = async () => {
    await onSave(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const realCount = form.tools.filter((t) => t !== "policy.guard").length;
  const usedBy = role.sessions ?? 0;

  const advancedCount =
    [form.presence_penalty, form.frequency_penalty].filter(Boolean).length +
    (form.json_mode ? 1 : 0) +
    (form.retries !== 2 ? 1 : 0) +
    (!form.stream ? 1 : 0);

  return (
    <>
      {/* 顶栏 */}
      <header className="flex shrink-0 items-center gap-3 px-6 pb-2.5 pt-4">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-xl text-[14px] font-semibold text-white shadow-soft",
            tone.avatar
          )}
        >
          {role.initial}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <h1 className="max-w-[240px] shrink-0 truncate text-[15px] font-semibold text-ink-900">
            {role.name}
          </h1>
          {role.primary && (
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium", tone.chip)}>
              内置
            </span>
          )}
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
              form.enabled ? "bg-ok-50 text-ok-600" : "bg-page text-ink-400"
            )}
          >
            {form.enabled ? "已启用" : "已停用"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" size="sm">
            <Play className="size-3.5" strokeWidth={1.75} />
            试跑一句
          </Button>
          {!role.primary && (
            <Button
              variant="ghost"
              size="icon"
              className="text-ink-400 hover:text-danger-600"
              title="删除角色"
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
        <div className="mx-auto flex max-w-[720px] flex-col gap-2">
          {/* 基础设置 */}
          <Collapsible title="基础设置" desc="名称、模型与启停状态" defaultOpen>
            <Row label="角色名称" hint="列表与会话头部展示">
              <TextInput compact value={form.name} onChange={(v) => set("name", v)} />
            </Row>
            <Row label="绑定模型" hint="该角色默认调用的模型">
              <ModelSelect
                value={form.model_id}
                models={models}
                loading={loadingModels}
                onChange={(v) => set("model_id", v)}
              />
            </Row>
            <Row label="启用该角色" hint="停用后不出现在新建会话的可选项中">
              <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </Row>
          </Collapsible>

          {/* 系统提示词 */}
          <Collapsible
            title="系统提示词"
            desc="角色的人格与行为边界，每次会话开始前注入"
            badge={`${form.prompt.length} 字符`}
          >
            <Textarea
              value={form.prompt}
              onChange={(v) => set("prompt", v)}
              rows={8}
              hint={`${form.prompt.length} 字符 · 约 ${Math.ceil(
                form.prompt.length / 2.2
              )} tokens`}
            />
          </Collapsible>

          {/* 可用工具 */}
          <Collapsible
            title="可用工具"
            desc="只勾选必要的，可以减少误调用"
            badge={`${realCount} / ${TOOLSET.length}`}
          >
            <div className="flex flex-col">
              {TOOLSET.map((t) => {
                const on = form.tools.includes(t.id);
                return (
                  <div
                    key={t.id}
                    className="flex items-center gap-3 rounded-xl px-2.5 py-1.5 transition-colors hover:bg-tint/50"
                  >
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-lg",
                        on ? "bg-tint text-brand-600" : "bg-page text-ink-400"
                      )}
                    >
                      <Wrench className="size-3.5" strokeWidth={1.75} />
                    </span>
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 truncate text-[12px] font-medium text-ink-900">
                        {t.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-400">
                        {t.id}
                      </span>
                    </div>
                    <Switch checked={on} onCheckedChange={() => toggleTool(t.id)} />
                  </div>
                );
              })}
            </div>
          </Collapsible>

          {/* 知识与记忆 */}
          <Collapsible
            title="知识与记忆"
            desc="检索来源与上下文保留策略"
            badge={`${form.kb.length} 个知识库`}
          >
            <div className="rounded-xl bg-surface px-3 py-2 shadow-soft">
              <div className="flex flex-wrap items-center gap-1.5">
                {form.kb.length > 0 ? (
                  form.kb.map((k) => (
                    <span
                      key={k}
                      className="rounded-full bg-tint px-2.5 py-1 text-[11.5px] font-medium text-brand-700"
                    >
                      {k}
                    </span>
                  ))
                ) : (
                  <span className="text-[11.5px] text-ink-400">尚未挂载知识库</span>
                )}
                <button
                  type="button"
                  className="flex items-center gap-1 rounded-full bg-page px-2.5 py-1 text-[11.5px] text-ink-500 transition-colors hover:bg-tint hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <Plus className="size-3" strokeWidth={1.75} />
                  挂载
                </button>
              </div>
            </div>
            <Slider
              label="记忆轮数"
              hint="带入上下文的最近对话条数"
              value={form.memory}
              min={0}
              max={30}
              step={1}
              onChange={(v) => set("memory", v)}
            />
            <Row label="跨会话长期记忆" hint="把稳定偏好写入本地记忆库">
              <Switch checked={false} onCheckedChange={() => {}} />
            </Row>
          </Collapsible>

          {/* 运行参数（生成参数统一由此角色持有） */}
          <Collapsible
            title="运行参数"
            desc="采样设置与护栏策略，保持默认一般即可"
            badge={`${usedBy} 个会话在用`}
          >
            <Slider
              label="温度 Temperature"
              hint="越低越稳定，越高越发散"
              value={form.temperature}
              min={0}
              max={2}
              step={0.1}
              onChange={(v) => set("temperature", v)}
            />
            <Slider
              label="最大输出 Max Tokens"
              hint="单次回复的长度上限"
              value={form.max_tokens}
              min={256}
              max={16384}
              step={256}
              format={(v) => v.toLocaleString()}
              onChange={(v) => set("max_tokens", v)}
            />
            <Collapsible title="高级" desc="不常用，保持默认一般即可" badge={`${advancedCount} 项已调整`}>
              <Slider
                label="存在惩罚 Presence Penalty"
                hint="鼓励引入新话题"
                value={form.presence_penalty}
                min={-2}
                max={2}
                step={0.1}
                onChange={(v) => set("presence_penalty", v)}
              />
              <Slider
                label="频率惩罚 Frequency Penalty"
                hint="抑制重复用词"
                value={form.frequency_penalty}
                min={-2}
                max={2}
                step={0.1}
                onChange={(v) => set("frequency_penalty", v)}
              />
              <Row label="流式输出" hint="逐字返回，响应体感更快">
                <Switch checked={form.stream} onCheckedChange={(v) => set("stream", v)} />
              </Row>
              <Row label="强制 JSON 输出" hint="以 response_format 约束返回结构">
                <Switch checked={form.json_mode} onCheckedChange={(v) => set("json_mode", v)} />
              </Row>
              <Row label="失败重试次数" hint="网络或限流错误时自动重试">
                <Select
                  value={String(form.retries)}
                  onChange={(v) => set("retries", Number(v))}
                  options={["0", "1", "2", "3", "5"]}
                />
              </Row>
              <Row label="超出额度时转人工" hint="触发护栏后生成待确认工单">
                <Switch checked={false} onCheckedChange={() => {}} />
              </Row>
            </Collapsible>
          </Collapsible>
        </div>
      </div>

      {/* 底部固定操作条 */}
      <div className="flex shrink-0 items-center gap-3 bg-surface px-6 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-400">
          {role.primary
            ? "内置角色 · 可调整人格与工具，不可删除"
            : "修改后对新建会话生效 · 进行中的会话不受影响"}
        </span>
        {saved && (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px] font-medium text-ok-600">
            <Check className="size-3.5" strokeWidth={2.5} />
            已保存到云端
          </span>
        )}
        <Button variant="secondary" size="sm" onClick={() => setForm(toForm(role))}>
          还原
        </Button>
        <Button variant="primary" size="sm" onClick={() => void handleSave()}>
          {saved ? "已保存" : "保存配置"}
        </Button>
      </div>
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

/* ---------------- 基础件 ---------------- */

function Collapsible({
  title,
  desc,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  desc?: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl bg-page p-1 shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-1 text-left transition-colors hover:bg-tint/50 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h2 className="shrink-0 text-[12.5px] font-semibold text-ink-900">
            {title}
          </h2>
          {badge && (
            <span className="shrink-0 rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
              {badge}
            </span>
          )}
          {desc && (
            <p className="min-w-0 flex-1 truncate text-[11px] text-ink-400">
              {desc}
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 text-ink-400 transition-transform",
            open && "rotate-90"
          )}
        >
          <ChevronRight className="size-3.5" strokeWidth={1.75} />
        </span>
      </button>
      {open && <div className="mt-px flex flex-col gap-1 px-1 pb-1">{children}</div>}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">{label}</p>
        {hint && <p className="truncate text-[11px] text-ink-400">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <div className="rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
      <div className="flex min-w-0 items-baseline gap-2">
        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">{label}</p>
        {hint && (
          <p className="min-w-0 flex-1 truncate text-[11px] text-ink-400">
            {hint}
          </p>
        )}
        <span className="shrink-0 rounded-lg bg-page px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700 shadow-soft">
          {format ? format(value) : value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-tint accent-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
      />
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  compact,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange?.(e.target.value)}
      className={cn(
        "min-w-0 rounded-xl bg-surface px-3 py-1 text-[12.5px] text-ink-900 placeholder-ink-400 shadow-soft transition-shadow focus:outline-none focus-visible:shadow-lift",
        compact ? "w-[240px]" : "w-full"
      )}
    />
  );
}

function Textarea({
  value,
  onChange,
  rows = 6,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <textarea
        rows={rows}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className="w-full min-w-0 resize-none rounded-xl bg-surface px-3 py-2 text-[12px] leading-5 text-ink-900 shadow-soft transition-shadow focus:outline-none focus-visible:shadow-lift"
      />
      {hint && (
        <p className="px-1 text-right text-[10.5px] text-ink-400">{hint}</p>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl bg-surface py-1.5 pl-3 pr-7 text-[12.5px] text-ink-900 shadow-soft transition-shadow hover:shadow-lift focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400">
        <ChevronRight className="size-3.5 rotate-90" strokeWidth={1.75} />
      </span>
    </div>
  );
}

/** 绑定模型：空串代表「主对话模型（自动）」，其余为具体模型 id。 */
function ModelSelect({
  value,
  models,
  loading,
  onChange,
}: {
  value: string;
  models: LlmModelRecord[];
  loading: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        disabled={loading}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl bg-surface py-1.5 pl-3 pr-7 text-[12.5px] text-ink-900 shadow-soft transition-shadow hover:shadow-lift focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-60"
      >
        <option value="">主对话模型（自动）</option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400">
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="size-3.5 rotate-90" strokeWidth={1.75} />
        )}
      </span>
    </div>
  );
}
