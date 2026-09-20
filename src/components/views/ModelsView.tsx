import {
  ChevronRight,
  Cloud,
  Loader2,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createModel,
  deleteModel,
  listModels,
  pickActiveModel,
  setDefaultModel,
  testModelConnection,
  updateModel,
  type CreateLlmModelPayload,
  type LlmModelRecord,
  type UpdateLlmModelPayload,
} from "../../api";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { AddModelDialog } from "../models/AddModelDialog";

type ModelsViewProps = {
  /** Bump to open the add-model dialog (e.g. from Sidebar「添加模型」). */
  addRequestId?: number;
  onModelsChange?: (info: {
    count: number;
    defaultName: string | null;
  }) => void;
};

type ModelForm = {
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  presence: number;
  frequency: number;
  stream: boolean;
  jsonMode: boolean;
  retries: number;
  isDefault: boolean;
};

function toForm(model: LlmModelRecord): ModelForm {
  return {
    name: model.name,
    baseUrl: model.base_url ?? "",
    modelId: model.model_id,
    apiKey: model.key_mask ?? "",
    temperature: model.temperature,
    maxTokens: model.max_tokens,
    presence: model.presence_penalty,
    frequency: model.frequency_penalty,
    stream: model.stream,
    jsonMode: model.json_mode,
    retries: model.retries,
    isDefault: model.is_default,
  };
}

function formToPayload(form: ModelForm): UpdateLlmModelPayload {
  const payload: UpdateLlmModelPayload = {
    name: form.name.trim(),
    model_id: form.modelId.trim(),
    base_url: form.baseUrl.trim() || null,
    temperature: form.temperature,
    max_tokens: form.maxTokens,
    presence_penalty: form.presence,
    frequency_penalty: form.frequency,
    stream: form.stream,
    json_mode: form.jsonMode,
    retries: form.retries,
    is_default: form.isDefault,
  };
  // 仅当用户改过密钥（不含脱敏星号）时才提交
  if (form.apiKey && !form.apiKey.includes("*") && !form.apiKey.includes("•")) {
    payload.api_key = form.apiKey.trim();
  } else if (form.apiKey === "") {
    payload.api_key = "";
  }
  return payload;
}

export function ModelsView({ addRequestId = 0, onModelsChange }: ModelsViewProps) {
  const [models, setModels] = useState<LlmModelRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [statusById, setStatusById] = useState<Record<string, "online" | "offline">>({});
  const onModelsChangeRef = useRef(onModelsChange);
  onModelsChangeRef.current = onModelsChange;

  const emitChange = useCallback((list: LlmModelRecord[]) => {
    const active = pickActiveModel(list);
    onModelsChangeRef.current?.({
      count: list.length,
      defaultName: active?.name ?? null,
    });
  }, []);

  const refresh = useCallback(
    async (preferId?: string | null) => {
      setError(null);
      const list = await listModels();
      setModels(list);
      setActiveId((prev) => {
        const next = preferId ?? prev;
        if (next && list.some((m) => m.id === next)) return next;
        return list[0]?.id ?? null;
      });
      emitChange(list);
      return list;
    },
    [emitChange]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "加载模型失败");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (addRequestId > 0) setAddOpen(true);
  }, [addRequestId]);

  const active = models.find((m) => m.id === activeId) ?? models[0] ?? null;

  const handleCreate = async (payload: CreateLlmModelPayload) => {
    const created = await createModel(payload);
    await refresh(created.id);
  };

  const handleSetDefault = async (id: string) => {
    await setDefaultModel(id);
    await refresh(id);
  };

  const handleSave = async (id: string, form: ModelForm) => {
    await updateModel(id, formToPayload(form));
    await refresh(id);
  };

  const handleDelete = async (id: string) => {
    const target = models.find((m) => m.id === id);
    if (target?.is_primary) {
      window.alert("主对话模型不可删除");
      return;
    }
    if (!window.confirm("确定删除该模型？此操作不可撤销。")) return;
    await deleteModel(id);
    setStatusById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    await refresh(null);
  };

  const handleTest = async (id: string) => {
    const result = await testModelConnection(id);
    setStatusById((prev) => ({
      ...prev,
      [id]: result.ok ? "online" : "offline",
    }));
    return result;
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-400">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        加载模型…
      </div>
    );
  }

  if (error && models.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[14px] font-medium text-ink-900">无法加载模型</p>
        <p className="max-w-sm text-[12px] text-ink-400">{error}</p>
        <Button
          variant="tint"
          onClick={() => {
            setLoading(true);
            void refresh().finally(() => setLoading(false));
          }}
        >
          重试
        </Button>
      </div>
    );
  }

  return (
    <>
      <section className="flex w-[220px] shrink-0 flex-col bg-list select-none">
        <div className="shrink-0 px-3 pb-1.5 pt-3.5">
          <div className="flex items-center justify-between px-1 pb-2">
            <p className="text-[11px] font-medium text-ink-400">
              线上模型 · {models.length}
            </p>
            <button
              type="button"
              title="添加线上模型"
              onClick={() => setAddOpen(true)}
              className="flex size-5 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-tint hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-3">
          <div className="flex flex-col gap-1">
            {models.map((m) => {
              const isActive = m.id === active?.id;
              const status = statusById[m.id];
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setActiveId(m.id)}
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
                        status === "online"
                          ? "bg-brand-500"
                          : status === "offline"
                            ? "bg-ink-400"
                            : "bg-brand-500"
                      )}
                    >
                      {m.name.slice(0, 1)}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-[12.5px]",
                        isActive ? "font-medium text-ink-900" : "text-ink-500"
                      )}
                    >
                      {m.name}
                    </span>
                    {m.is_primary && (
                      <span className="shrink-0 rounded-full bg-brand-50 px-1.5 text-[9.5px] font-medium text-brand-700">
                        主
                      </span>
                    )}
                    {m.is_default && !m.is_primary && (
                      <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[9.5px] font-medium text-white">
                        默认
                      </span>
                    )}
                    {status && (
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          status === "online" ? "bg-ok-500" : "bg-ink-300"
                        )}
                      />
                    )}
                  </span>
                  <span className="truncate pl-[28px] font-mono text-[10px] text-ink-400">
                    {m.model_id || m.provider}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 px-3 pb-3">
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-tint px-3 py-1.5 text-[12.5px] font-medium text-brand-700 shadow-soft transition-colors hover:bg-tint-deep focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            添加线上模型
          </button>
        </div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col bg-surface">
        {active ? (
          <ModelConfig
            key={active.id}
            model={active}
            status={statusById[active.id]}
            onSetDefault={handleSetDefault}
            onSave={handleSave}
            onDelete={handleDelete}
            onTest={handleTest}
          />
        ) : (
          <EmptyState onAdd={() => setAddOpen(true)} />
        )}
      </section>

      <AddModelDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={handleCreate}
      />
    </>
  );
}

/* ---------------- 模型配置 ---------------- */

type ModelConfigProps = {
  model: LlmModelRecord;
  status?: "online" | "offline";
  onSetDefault: (id: string) => Promise<void>;
  onSave: (id: string, form: ModelForm) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTest: (id: string) => Promise<{ ok: boolean; message: string; latency_ms: number }>;
};

function ModelConfig({
  model,
  status,
  onSetDefault,
  onSave,
  onDelete,
  onTest,
}: ModelConfigProps) {
  const [form, setForm] = useState(() => toForm(model));
  const set = <K extends keyof ModelForm>(key: K, value: ModelForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    setForm(toForm(model));
    setBanner(null);
  }, [model]);

  const handleReset = () => {
    setForm(toForm(model));
    setBanner(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setBanner(null);
    try {
      await onSave(model.id, form);
      setBanner("已保存");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setBanner(null);
    try {
      // 先保存密钥等接入信息再测，避免测的是旧配置
      if (
        form.apiKey &&
        !form.apiKey.includes("*") &&
        form.apiKey !== (model.key_mask ?? "")
      ) {
        await onSave(model.id, form);
      }
      const result = await onTest(model.id);
      setBanner(
        result.ok
          ? `${result.message}（${result.latency_ms}ms）`
          : `测试失败：${result.message}`
      );
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTesting(false);
    }
  };

  const advancedCount =
    [form.presence, form.frequency].filter(Boolean).length +
    (form.jsonMode ? 1 : 0) +
    (form.retries !== 2 ? 1 : 0);

  return (
    <>
      <header className="flex items-center gap-3 px-6 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-[15px] font-semibold text-ink-900">
              {model.name}
            </h1>
            {model.is_primary && (
              <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10.5px] font-medium text-brand-700">
                主对话模型
              </span>
            )}
            {status && (
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium",
                  status === "online"
                    ? "bg-ok-50 text-ok-600"
                    : "bg-page text-ink-400"
                )}
              >
                {status === "online" ? "在线" : "离线"}
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
            {model.description || `${model.provider} · ${model.model_id}`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={testing}
            onClick={() => void handleTest()}
          >
            {testing ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <Play className="size-3.5" strokeWidth={1.75} />
            )}
            测试连接
          </Button>
          {!model.is_default && (
            <Button
              variant="tint"
              size="sm"
              onClick={() => void onSetDefault(model.id)}
            >
              设为默认
            </Button>
          )}
          {!model.is_primary && (
            <Button
              variant="ghost"
              size="icon"
              className="text-ink-400 hover:text-danger-600"
              title="删除模型"
              onClick={() => void onDelete(model.id)}
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          {banner && (
            <p
              className={cn(
                "rounded-xl px-3 py-2 text-[12px]",
                banner.startsWith("测试失败") || banner.includes("失败")
                  ? "bg-page text-danger-600"
                  : "bg-ok-50 text-ok-600"
              )}
            >
              {banner}
            </p>
          )}

          <Card title="接入信息" desc="OpenAI 兼容协议，改地址即可换供应商">
            <Field label="显示名称" hint="列表里展示的名字">
              <TextInput value={form.name} onChange={(v) => set("name", v)} />
            </Field>
            <Field label="接口地址" hint="Base URL，通常以 /v1 结尾">
              <TextInput
                mono
                value={form.baseUrl}
                onChange={(v) => set("baseUrl", v)}
              />
            </Field>
            <Field label="模型标识" hint="/v1/models 里返回的 id">
              <TextInput
                mono
                value={form.modelId}
                onChange={(v) => set("modelId", v)}
                placeholder="例如 gpt-4o-mini"
              />
            </Field>
            <Field label="API Key" hint="仅保存在本机，不随会话上传">
              <div className="flex items-center gap-2">
                <TextInput
                  mono
                  type={showKey ? "text" : "password"}
                  value={form.apiKey}
                  onChange={(v) => set("apiKey", v)}
                  placeholder="sk-..."
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  title={showKey ? "隐藏" : "显示"}
                  className="shrink-0 rounded-xl bg-page px-3 py-2 text-[11.5px] font-medium text-ink-700 shadow-soft transition-colors hover:bg-tint focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  {showKey ? "隐藏" : "显示"}
                </button>
              </div>
            </Field>
          </Card>

          <Card title="生成参数" desc="影响回复的随机性与长度">
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
              value={form.maxTokens}
              min={256}
              max={16384}
              step={256}
              format={(v) => v.toLocaleString()}
              onChange={(v) => set("maxTokens", v)}
            />
          </Card>

          <Collapsible
            title="高级"
            desc="不常用，保持默认一般即可"
            badge={`${advancedCount} 项已调整`}
          >
            <Slider
              label="存在惩罚 Presence Penalty"
              hint="鼓励引入新话题"
              value={form.presence}
              min={-2}
              max={2}
              step={0.1}
              onChange={(v) => set("presence", v)}
            />
            <Slider
              label="频率惩罚 Frequency Penalty"
              hint="抑制重复用词"
              value={form.frequency}
              min={-2}
              max={2}
              step={0.1}
              onChange={(v) => set("frequency", v)}
            />
            <Row label="流式输出" hint="逐字返回，响应体感更快">
              <Switch
                checked={form.stream}
                onCheckedChange={(v) => set("stream", v)}
              />
            </Row>
            <Row label="强制 JSON 输出" hint="以 response_format 约束返回结构">
              <Switch
                checked={form.jsonMode}
                onCheckedChange={(v) => set("jsonMode", v)}
              />
            </Row>
            <Row label="失败重试次数" hint="网络或限流错误时自动重试">
              <Select
                value={String(form.retries)}
                onChange={(v) => set("retries", Number(v))}
                options={["0", "1", "2", "3", "5"]}
              />
            </Row>
            <Row label="设为默认模型" hint="新会话优先使用该模型">
              <Switch
                checked={form.isDefault}
                onCheckedChange={(v) => set("isDefault", v)}
              />
            </Row>
          </Collapsible>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 bg-surface px-6 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-400">
          修改仅作用于该模型 · 保存后对新建会话生效
        </span>
        <Button variant="secondary" size="sm" onClick={handleReset} disabled={saving}>
          还原
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={saving}
          onClick={() => void handleSave()}
        >
          {saving ? "保存中…" : "保存配置"}
        </Button>
      </div>
    </>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-tint text-brand-600">
        <Cloud className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-[14px] font-medium text-ink-900">还没有添加线上模型</p>
      <p className="mt-1.5 max-w-xs text-[12px] leading-5 text-ink-400">
        填入接口地址与 API Key，兼容 OpenAI 协议的服务都可以直接接入。
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="mt-4 flex items-center gap-1.5 rounded-xl bg-tint px-4 py-2 text-[12.5px] font-medium text-brand-700 shadow-soft transition-colors hover:bg-tint-deep focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <Plus className="size-3.5" strokeWidth={1.75} />
        添加线上模型
      </button>
    </div>
  );
}

/* ---------------- 基础件 ---------------- */

function Card({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-page p-1.5 shadow-soft">
      <div className="px-3.5 pb-1.5 pt-2.5">
        <h2 className="text-[12.5px] font-semibold text-ink-900">{title}</h2>
        {desc && <p className="mt-0.5 text-[11px] text-ink-400">{desc}</p>}
      </div>
      <div className="flex flex-col gap-2 px-3 pb-2.5">{children}</div>
    </div>
  );
}

function Collapsible({
  title,
  desc,
  badge,
  children,
}: {
  title: string;
  desc?: string;
  badge?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl bg-page p-1.5 shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3.5 py-2 text-left transition-colors hover:bg-tint/50 focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="shrink-0 text-[12.5px] font-semibold text-ink-900">
              {title}
            </h2>
            {badge && (
              <span className="shrink-0 rounded-full bg-tint px-1.5 py-px text-[10px] text-ink-500">
                {badge}
              </span>
            )}
          </div>
          {desc && (
            <p className="mt-0.5 truncate text-[11px] text-ink-400">{desc}</p>
          )}
        </div>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-ink-400 transition-transform",
            open && "rotate-90"
          )}
          strokeWidth={1.75}
        />
      </button>
      {open && (
        <div className="mt-0.5 flex flex-col gap-2 px-3 pb-2.5">{children}</div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[12px] font-medium text-ink-700">
          {label}
        </span>
        {hint && (
          <span className="truncate text-[10.5px] text-ink-400">{hint}</span>
        )}
      </span>
      {children}
    </label>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl px-3 py-1.5 transition-colors hover:bg-tint/50">
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
    <div className="rounded-xl px-3 py-1.5 transition-colors hover:bg-tint/40">
      <div className="flex min-w-0 items-baseline gap-2">
        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">{label}</p>
        {hint && (
          <p className="min-w-0 flex-1 truncate text-[11px] text-ink-400">
            {hint}
          </p>
        )}
        <span className="shrink-0 rounded-lg bg-surface px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700 shadow-soft">
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
  mono,
  type = "text",
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full min-w-0 rounded-xl bg-surface px-3 py-1.5 text-[12.5px] text-ink-900 placeholder-ink-400 shadow-soft transition-shadow",
        "focus:outline-none focus-visible:shadow-lift",
        mono && "font-mono text-[11.5px]"
      )}
    />
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
      <ChevronRight className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 rotate-90 text-ink-400" strokeWidth={1.75} />
    </div>
  );
}
