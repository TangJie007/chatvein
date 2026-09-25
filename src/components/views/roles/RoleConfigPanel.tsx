import { useEffect, useState } from "react";
import { Check, Play, Plus, Trash2, Wrench } from "lucide-react";
import {
  listInstalledSkills,
  type InstalledSkill,
  type LlmModelRecord,
  type RoleRecord,
} from "../../../api";
import { cn } from "../../../lib/cn";
import { TOOLSET } from "../../../lib/rolesStore";
import { AvatarPicker, RoleAvatar } from "../../ui/avatar-picker";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { Collapsible, Row, Select, Slider, Textarea, TextInput } from "./formFields";
import { ModelSelect } from "./ModelSelect";
import { ResidentSkillPicker } from "./ResidentSkillPicker";
import type { RoleForm } from "./roleForm";
import { toForm } from "./roleForm";
import { TONE } from "./tone";
import { TryRunDialog } from "./TryRunDialog";

export function RoleConfig({
  role,
  models,
  loadingModels,
  onSave,
  onDelete,
}: {
  role: RoleRecord;
  models: LlmModelRecord[];
  loadingModels: boolean;
  onSave: (form: RoleForm) => Promise<void>;
  onDelete: () => void;
}) {
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
  // 常驻技能：只允许从「已下载技能」中勾选，聊天时会自动带入（可与消息级临时技能叠加）。
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [loadingInstalled, setLoadingInstalled] = useState(true);
  useEffect(() => {
    let cancelled = false;
    listInstalledSkills()
      .then((r) => {
        if (!cancelled) setInstalled(r.skills);
      })
      .catch(() => {
        /* 拉取失败时视为暂无已安装技能 */
      })
      .finally(() => {
        if (!cancelled) setLoadingInstalled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // 去掉当前表单里已卸载的技能（避免 role 里指向不存在的 slug）
  // 注意：仅在已下载技能列表加载完成后清理，否则首次挂载时空列表会把选项清光
  const knownSlugs = new Set(installed.map((s) => s.slug));
  useEffect(() => {
    if (loadingInstalled) return;
    setForm((f) => {
      const current = f.resident_skills ?? [];
      const next = current.filter((s) => knownSlugs.has(s));
      return next.length === current.length ? f : { ...f, resident_skills: next };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installed, loadingInstalled]);
  const toggleResidentSkill = (slug: string) =>
    set(
      "resident_skills",
      form.resident_skills.includes(slug)
        ? form.resident_skills.filter((s) => s !== slug)
        : [...form.resident_skills, slug]
    );

  const [saved, setSaved] = useState(false);
  const handleSave = async () => {
    await onSave(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  };

  const [tryOpen, setTryOpen] = useState(false);
  // 试跑前先持久化当前表单，保证所见即所得；保存失败也允许用已保存配置试跑
  const handleTryRun = async () => {
    try {
      await onSave(form);
    } catch {
      /* 忽略保存失败，仍可用已保存配置试跑 */
    }
    setTryOpen(true);
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
      <header className="flex shrink-0 items-center gap-3 px-[25px] pb-2.5 pt-4">
        <span className="shrink-0">
          <RoleAvatar
            style={{ display: "block" }}
            name={role.avatar}
            initial={role.initial}
            toneClass={tone.avatar}
            sizeClass="size-12 text-[14px] rounded-xl shadow-soft"
          />
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void handleTryRun()}
          >
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

      <div className="min-h-0 flex-1 overflow-y-auto px-[25px] py-2 pb-4">
        <div className="flex flex-1 flex-col gap-4">
          {/* 基础设置 */}
          <Collapsible title="基础设置" desc="名称、模型与启停状态" defaultOpen>
            <Row label="角色名称" hint="列表与会话头部展示">
              <TextInput compact value={form.name} onChange={(v) => set("name", v)} />
            </Row>
            <Row label="角色描述" hint="一句话说明用途，列表与群组花名册展示">
              <TextInput
                compact
                value={form.description}
                placeholder="例如：负责代码审查与重构"
                onChange={(v) => set("description", v)}
              />
            </Row>
            <Row label="头像图标" hint="">
              <AvatarPicker
                value={form.avatar}
                onChange={(v) => set("avatar", v)}
              />
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

          {/* 常驻技能：从已下载技能中多选，聊天时自动注入 role prompt */}
          <Collapsible
            title="常驻技能"
            desc="从已下载技能中挑选，聊天时自动注入角色提示词"
            badge={`${form.resident_skills.length} 个常驻`}
          >
            <ResidentSkillPicker
              installed={installed}
              loading={loadingInstalled}
              selected={form.resident_skills}
              onToggle={toggleResidentSkill}
            />
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
      <div className="flex shrink-0 items-center gap-3 bg-surface px-[25px] py-2.5">
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

      <TryRunDialog
        role={role}
        open={tryOpen}
        onOpenChange={setTryOpen}
      />
    </>
  );
}
