import { open } from "@tauri-apps/plugin-dialog";
import { Paperclip, Plus, SendHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { listSkills, type SkillHubItem } from "../../api";
import { cn } from "../../lib/cn";

const LINE_HEIGHT = 20;
const PADDING_Y = 12;
const MAX_LINES = 10;
const MIN_H = LINE_HEIGHT + PADDING_Y;
const MAX_H = LINE_HEIGHT * MAX_LINES + PADDING_Y;

export type ComposerSkill = {
  slug: string;
  name: string;
};

export type ComposerFile = {
  path: string;
  name: string;
};

type ComposerProps = {
  modelName: string;
  modelId?: string;
  contextPct: number;
  contextTitle: string;
  sending?: boolean;
  onSend: (text: string) => void;
};

function fileNameOf(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function composeOutgoing(
  text: string,
  skills: ComposerSkill[],
  files: ComposerFile[]
): string {
  const extras: string[] = [];
  if (skills.length > 0) {
    extras.push(
      "请结合以下技能：\n" + skills.map((s) => `- ${s.name} (${s.slug})`).join("\n")
    );
  }
  if (files.length > 0) {
    extras.push("请参考以下本地文件：\n" + files.map((f) => `- ${f.path}`).join("\n"));
  }
  return extras.length > 0 ? `${text}\n\n${extras.join("\n\n")}` : text;
}

export function Composer({
  modelName,
  modelId = "",
  contextPct,
  contextTitle,
  sending = false,
  onSend,
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState("");
  const [skillOpen, setSkillOpen] = useState(false);
  const [skills, setSkills] = useState<ComposerSkill[]>([]);
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const [keyword, setKeyword] = useState("");
  const [catalog, setCatalog] = useState<SkillHubItem[]>([]);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);

  useEffect(() => {
    if (!skillOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSkillLoading(true);
      setSkillError(null);
      void listSkills({ keyword, page: 1, pageSize: 8 })
        .then((data) => {
          if (!cancelled) setCatalog(data.skills);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setCatalog([]);
            setSkillError(err instanceof Error ? err.message : "技能目录暂不可用");
          }
        })
        .finally(() => {
          if (!cancelled) setSkillLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keyword, skillOpen]);

  useEffect(() => {
    if (!skillOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setSkillOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [skillOpen]);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_H);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? "auto" : "hidden";
  };

  const resetInput = () => {
    setDraft("");
    const el = inputRef.current;
    if (!el) return;
    el.style.height = `${MIN_H}px`;
    el.style.overflowY = "hidden";
  };

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(composeOutgoing(text, skills, files));
    setSkills([]);
    setFiles([]);
    setSkillOpen(false);
    resetInput();
  };

  const addFiles = (paths: string[]) => {
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.path));
      const next = [...prev];
      for (const path of paths) {
        if (!path || seen.has(path)) continue;
        seen.add(path);
        next.push({ path, name: fileNameOf(path) });
      }
      return next;
    });
  };

  const pickFiles = async () => {
    setSkillOpen(false);
    try {
      const selected = await open({ multiple: true, title: "添加文件" });
      if (!selected) return;
      addFiles(Array.isArray(selected) ? selected : [selected]);
    } catch {
      fileInputRef.current?.click();
    }
  };

  const attachSkill = (item: SkillHubItem) => {
    setSkills((prev) =>
      prev.some((s) => s.slug === item.slug)
        ? prev
        : [...prev, { slug: item.slug, name: item.name }]
    );
    setSkillOpen(false);
    setKeyword("");
  };

  return (
    <footer className="px-6 pb-5 pt-1">
      <div ref={barRef} className="mx-auto max-w-[760px]">
        <div className="flex items-center gap-2 pb-2">
          <span
            title={modelId ? `${modelName} · ${modelId}` : modelName}
            className="flex min-w-0 items-center gap-1.5 rounded-full bg-page px-2.5 py-1 text-[11.5px] text-ink-500"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-ok-500" />
            <span className="min-w-0 truncate font-medium text-ink-700">{modelName}</span>
            {modelId ? (
              <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-400">
                {modelId}
              </span>
            ) : null}
          </span>

          <span
            title={contextTitle}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-page px-2.5 py-1 text-[11.5px] text-ink-400"
          >
            <ContextRing pct={contextPct} />
            <span className="font-mono font-medium text-ink-700">{contextPct}%</span>
          </span>

          <div className="relative ml-auto">
            <button
              type="button"
              title="添加 Skill"
              onClick={() => setSkillOpen((open) => !open)}
              className="flex shrink-0 items-center gap-1 rounded-full bg-page px-2.5 py-1 text-[11.5px] text-ink-500 transition-colors hover:bg-tint hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              <Plus className="size-3" strokeWidth={1.75} />
              添加 Skill
            </button>
            {skillOpen ? (
              <div className="absolute right-0 bottom-full z-20 mb-1 w-72 rounded-xl bg-surface p-2 shadow-lift">
                <input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜索技能"
                  className="w-full rounded-lg bg-page px-2.5 py-1.5 text-[12px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
                />
                <ul className="mt-1 max-h-52 overflow-auto">
                  {skillLoading ? (
                    <li className="px-2 py-2 text-[12px] text-ink-400">加载中…</li>
                  ) : skillError ? (
                    <li className="px-2 py-2 text-[12px] text-danger-600">{skillError}</li>
                  ) : catalog.length === 0 ? (
                    <li className="px-2 py-2 text-[12px] text-ink-400">没有匹配的技能</li>
                  ) : (
                    catalog.map((item) => (
                      <li key={`${item.slug}-${item.version}`}>
                        <button
                          type="button"
                          onClick={() => attachSkill(item)}
                          className="flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-tint"
                        >
                          <span className="truncate text-[12.5px] font-medium text-ink-900">
                            {item.name}
                          </span>
                          <span className="truncate text-[11px] text-ink-400">
                            {item.description || item.slug}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ) : null}
          </div>

          <button
            type="button"
            title="添加文件"
            onClick={() => {
              void pickFiles();
            }}
            className="flex shrink-0 items-center gap-1 rounded-full bg-page px-2.5 py-1 text-[11.5px] text-ink-500 transition-colors hover:bg-tint hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <Paperclip className="size-3" strokeWidth={1.75} />
            添加文件
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []).map(
                (file) => file.name
              );
              addFiles(picked);
              e.target.value = "";
            }}
          />
        </div>

        {skills.length > 0 || files.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {skills.map((skill) => (
              <Chip
                key={skill.slug}
                label={skill.name}
                onRemove={() =>
                  setSkills((prev) => prev.filter((s) => s.slug !== skill.slug))
                }
              />
            ))}
            {files.map((file) => (
              <Chip
                key={file.path}
                label={file.name}
                title={file.path}
                onRemove={() =>
                  setFiles((prev) => prev.filter((f) => f.path !== file.path))
                }
              />
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-2xl bg-page p-2.5 pl-4 shadow-soft transition-shadow focus-within:shadow-lift">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={sending}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              sending ? "Agent 处理中…" : "给 Agent 下达指令…（Enter 发送，Shift+Enter 换行）"
            }
            className="flex-1 resize-none overflow-y-hidden bg-transparent py-1.5 text-[13px] leading-5 text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
            style={{ height: MIN_H, maxHeight: MAX_H }}
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim() || sending}
            aria-label="发送"
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-soft transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
          >
            <SendHorizontal className="size-4" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </footer>
  );
}

function Chip({
  label,
  title,
  onRemove,
}: {
  label: string;
  title?: string;
  onRemove: () => void;
}) {
  return (
    <span
      title={title ?? label}
      className="flex max-w-[220px] items-center gap-1 rounded-full bg-page py-0.5 pr-1 pl-2.5 text-[11.5px] text-ink-700"
    >
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        aria-label={`移除 ${label}`}
        onClick={onRemove}
        className="flex size-4 items-center justify-center rounded-full text-ink-400 hover:bg-tint hover:text-ink-700"
      >
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

function ContextRing({ pct, size = 14 }: { pct: number; size?: number }) {
  const r = (size - 2) / 2;
  const c = 2 * Math.PI * r;
  const tone = pct >= 80 ? "text-danger-500" : "text-brand-500";
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0 -rotate-90"
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="2"
        className="stroke-ink-200"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${(c * pct) / 100} ${c}`}
        className={cn("stroke-current transition-all", tone)}
      />
    </svg>
  );
}
