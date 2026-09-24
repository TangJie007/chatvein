import {
  Cloud,
  Cpu,
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
  prepareEmbedding,
  testModelConnection,
  updateModel,
  type CreateLlmModelPayload,
  type EmbeddingStatus,
  type LlmModelRecord,
  type UpdateLlmModelPayload,
} from "../../api";
import { cn } from "../../lib/cn";
import { useEmbedding } from "../embedding/EmbeddingProvider";
import { Button } from "../ui/button";
import { AddModelDialog } from "../models/AddModelDialog";

type ModelsViewProps = {
  /** Bump to open the add-model dialog (e.g. from Sidebar「添加模型」). */
  addRequestId?: number;
  onModelsChange?: (info: {
    count: number;
  }) => void;
};

type ModelForm = {
  name: string;
  baseUrl: string;
  modelId: string;
  apiKey: string;
};

function toForm(model: LlmModelRecord): ModelForm {
  return {
    name: model.name,
    baseUrl: model.base_url ?? "",
    modelId: model.model_id,
    apiKey: model.key_mask ?? "",
  };
}

function formToPayload(form: ModelForm): UpdateLlmModelPayload {
  const payload: UpdateLlmModelPayload = {
    name: form.name.trim(),
    model_id: form.modelId.trim(),
    base_url: form.baseUrl.trim() || null,
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
  const [selected, setSelected] = useState<
    { kind: "local" } | { kind: "online"; id: string } | null
  >({ kind: "local" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [statusById, setStatusById] = useState<Record<string, "online" | "offline">>({});
  const onModelsChangeRef = useRef(onModelsChange);
  onModelsChangeRef.current = onModelsChange;

  const emitChange = useCallback((list: LlmModelRecord[]) => {
    onModelsChangeRef.current?.({
      count: list.length,
    });
  }, []);

  const refresh = useCallback(
    async (preferId?: string | null) => {
      setError(null);
      const list = await listModels();
      setModels(list);
      setSelected((prev) => {
        // 本地模型选中不受线上列表变化影响
        if (prev?.kind === "local") return prev;
        const next = preferId ?? (prev?.kind === "online" ? prev.id : null);
        if (next && list.some((m) => m.id === next)) return { kind: "online", id: next };
        return list[0] ? { kind: "online", id: list[0].id } : null;
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

  const showLocal = selected?.kind === "local";
  const active =
    selected?.kind === "online" ? (models.find((m) => m.id === selected.id) ?? null) : null;

  const handleCreate = async (payload: CreateLlmModelPayload) => {
    const created = await createModel(payload);
    await refresh(created.id);
  };

  const handleSave = async (id: string, form: ModelForm) => {
    await updateModel(id, formToPayload(form));
    await refresh(id);
  };

  const handleDelete = async (id: string) => {
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
        <div className="shrink-0 px-3 pb-2 pt-3.5">
          <p className="px-1 pb-2 text-[11px] font-medium text-ink-400">本地模型</p>
          <LocalModelInfo
            active={showLocal}
            onSelect={() => setSelected({ kind: "local" })}
          />
        </div>

        <div className="shrink-0 px-3 pb-1.5 pt-1.5">
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
                  onClick={() => setSelected({ kind: "online", id: m.id })}
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
        {showLocal ? (
          <LocalModelConfig />
        ) : active ? (
          <ModelConfig
            key={active.id}
            model={active}
            status={statusById[active.id]}
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
  onSave: (id: string, form: ModelForm) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onTest: (id: string) => Promise<{ ok: boolean; message: string; latency_ms: number }>;
};

function ModelConfig({
  model,
  status,
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

  return (
    <>
      <header className="flex items-center gap-3 px-6 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-[15px] font-semibold text-ink-900">
              {model.name}
            </h1>
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
          <Button
            variant="ghost"
            size="icon"
            className="text-ink-400 hover:text-danger-600"
            title="删除模型"
            onClick={() => void onDelete(model.id)}
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </Button>
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

/* ---------------- 本地模型 ---------------- */

function LocalModelInfo({
  active,
  onSelect,
}: {
  active: boolean;
  onSelect: () => void;
}) {
  const { status: embed } = useEmbedding();
  const failed = !embed;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-xl p-2.5 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-brand-600",
        active ? "bg-surface shadow-soft" : "hover:bg-tint/60"
      )}
    >
      {failed ? (
        <div className="flex items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-page text-ink-400">
            <Cpu className="size-3" strokeWidth={1.75} />
          </span>
          <span className="min-w-0 flex-1 text-[12px] text-ink-500">
            状态读取失败
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-tint text-brand-600">
              <Cpu className="size-3" strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink-900">
              {embed.model}
            </span>
            <LocalBadge embed={embed} />
          </div>
          <p className="mt-1 truncate font-mono text-[10px] text-ink-400">
            {embed.dim} 维 · ONNX 本地推理
          </p>
          <p className="mt-0.5 truncate font-mono text-[10px] text-ink-400" title={embed.cache_dir}>
            {embed.cache_dir}
          </p>
          {embed.error && (
            <p
              className="mt-1.5 truncate rounded-lg bg-warn-50 px-2 py-1 text-[10px] text-warn-600"
              title={embed.error}
            >
              {embed.error}
            </p>
          )}
        </>
      )}
    </button>
  );
}

function LocalBadge({ embed }: { embed: EmbeddingStatus }) {
  if (embed.downloading) {
    const pct = Math.round(Math.min(100, Math.max(0, embed.progress ?? 0)));
    return (
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-warn-50 px-1.5 py-0.5 text-[10px] font-medium text-warn-600">
        <Loader2 className="size-2.5 animate-spin" strokeWidth={2} />
        {pct > 0 ? `下载中 ${pct}%` : "下载中"}
      </span>
    );
  }
  if (embed.error) {
    return (
      <span className="shrink-0 rounded-full bg-warn-50 px-1.5 py-0.5 text-[10px] font-medium text-warn-600">
        异常
      </span>
    );
  }
  if (!embed.installed) {
    return (
      <span className="shrink-0 rounded-full bg-page px-1.5 py-0.5 text-[10px] font-medium text-ink-500">
        未安装
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-ok-50 px-1.5 py-0.5 text-[10px] font-medium text-ok-600">
      已就绪
    </span>
  );
}

/** 实际下载源的展示文案（后端 source：modelscope / huggingface）。 */
function mirrorLabel(embed: EmbeddingStatus): string {
  if (embed.source === "modelscope") {
    return "ModelScope 国内源（modelscope.cn · 阿里云链路）";
  }
  return `HuggingFace 镜像（${embed.endpoint}）`;
}

/** 本地向量模型详情：信息 + 安装进度（百分比）。 */
function LocalModelConfig() {
  const { status: embed, progress } = useEmbedding();
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleDownload = async (force: boolean) => {
    setBusy(true);
    setBanner(null);
    try {
      await prepareEmbedding(force);
      setBanner(force ? "已开始重新下载" : "已开始下载");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const pct = Math.round(Math.min(100, Math.max(0, progress ?? 0)));

  if (!embed) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-400">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        正在获取本地模型状态…
      </div>
    );
  }

  return (
    <>
      <header className="flex items-center gap-3 px-6 pb-3 pt-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-[15px] font-semibold text-ink-900">
              {embed.model}
            </h1>
            <LocalBadge embed={embed} />
          </div>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
            {embed.dim} 维 · ONNX 本地推理 · {mirrorLabel(embed)}
          </p>
        </div>
        {embed.downloading ? (
          <Button variant="secondary" size="sm" disabled>
            下载中…
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void handleDownload(true)}
          >
            {busy ? "处理中…" : "重新下载"}
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 pb-20">
        <div className="mx-auto flex max-w-[720px] flex-col gap-3">
          {banner && (
            <p className="rounded-xl bg-tint px-3 py-2 text-[12px] text-brand-700">
              {banner}
            </p>
          )}

          {embed.downloading && (
            <Card title="安装进度" desc="权重下载完成后即可用于知识库检索">
              <div className="flex items-center gap-2 px-1 pt-1">
                <Loader2 className="size-3.5 animate-spin text-brand-600" strokeWidth={2} />
                <span className="text-[12.5px] text-ink-700">正在下载模型权重…</span>
                <span className="ml-auto font-mono text-[12.5px] font-semibold text-ink-900">
                  {pct}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-page">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="px-1 pb-1 text-[10.5px] text-ink-400">
                受网络影响可能较慢；切换页面进度在后台继续。
              </p>
            </Card>
          )}

          {embed.error && (
            <div className="rounded-2xl bg-warn-50 p-3 text-[12px] leading-5 text-warn-600">
              安装失败：{embed.error}
            </div>
          )}

          <Card title="模型信息" desc="FastEmbed + ONNX Runtime 本地推理，数据不出本机">
            <Field label="模型标识">
              <TextInput mono disabled value={embed.model} onChange={() => {}} />
            </Field>
            <Field label="向量维度">
              <TextInput mono disabled value={`${embed.dim}`} onChange={() => {}} />
            </Field>
            <Field label="缓存路径">
              <TextInput mono disabled value={embed.cache_dir} onChange={() => {}} />
            </Field>
            <Field label="下载源">
              <TextInput mono disabled value={mirrorLabel(embed)} onChange={() => {}} />
            </Field>
          </Card>
        </div>
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

function TextInput({
  value,
  onChange,
  mono,
  type = "text",
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  mono?: boolean;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "w-full min-w-0 rounded-xl bg-surface px-3 py-1.5 text-[12.5px] text-ink-900 placeholder-ink-400 shadow-soft transition-shadow",
        "focus:outline-none focus-visible:shadow-lift",
        mono && "font-mono text-[11.5px]",
        disabled && "cursor-not-allowed bg-tint/40 text-ink-600 opacity-90"
      )}
    />
  );
}

