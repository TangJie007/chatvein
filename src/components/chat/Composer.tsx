import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AtSign,
  Check,
  Paperclip,
  Plus,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listInstalledSkills, uploadFiles, type InstalledSkill } from "../../api";
import { cn } from "../../lib/cn";
import { escapeRegExp, parseMentionIds, type MemberAvatar } from "./mentions";

export type { MemberAvatar };

const LINE_HEIGHT = 20;
const PADDING_Y = 12;
const MAX_LINES = 10;
const MIN_H = LINE_HEIGHT + PADDING_Y;
const MAX_H = LINE_HEIGHT * MAX_LINES + PADDING_Y;

export type ComposerSkill = {
  /** SkillHub slug；对应本机 <data>/skills/<slug>/ 目录 */
  slug: string;
  /** 展示名，用于底部 chip；发给后端时只用 slug */
  name: string;
};

export type ComposerFile = {
  path: string;
  name: string;
};

type ComposerProps = {
  /** chat=对话视图（模型 / 用量 / 技能齐全）；group=群组视图（无模型、无技能）。 */
  variant?: "chat" | "group";
  modelName?: string;
  modelId?: string;
  contextPct?: number;
  contextTitle?: string;
  sending?: boolean;
  /** mentionIds 为文本里 @ 到的成员（按出现顺序）；空 / 缺省表示交给默认角色。 */
  onSend: (text: string, skills?: ComposerSkill[], mentionIds?: string[]) => void;
  /** 生成中点击：主动停止当前 LLM 推理。 */
  onStop?: () => void;
  /** 由父组件回灌的待编辑原文（null 表示无需回灌）。 */
  restoreText?: string | null;
  /** 消费 restoreText 后回调，父组件据此清空。 */
  onRestored?: () => void;
  conversationId?: string | null;
  /** 会话级已选技能（受控）：勾选 / 移除后持久化到当前会话，切换会话由父组件刷新。 */
  skills?: ComposerSkill[];
  /** 受控更新：勾选 / 移除 chip 时回调，由父组件负责持久化。 */
  onSkillsChange?: (skills: ComposerSkill[]) => void;
  /** 角色常驻技能 slug：勾选面板中隐藏（已由角色自动注入，无需重复勾选）。 */
  residentSkills?: string[];
  /** 群组变体：可 @ 点名的成员；缺省时不显示点名入口。 */
  mentionOptions?: MemberAvatar[];
};

type UploadItemInput =
  | { source_path: string }
  | { content_base64: string; name: string };

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function composeOutgoing(
  text: string,
  files: ComposerFile[]
): string {
  if (files.length === 0) return text;
  return `${text}\n\n请参考以下本地文件：\n${files.map((f) => `- ${f.path}`).join("\n")}`;
}

export function Composer({
  variant = "chat",
  modelName = "",
  modelId = "",
  contextPct = 0,
  contextTitle = "",
  sending = false,
  onSend,
  onStop,
  restoreText = null,
  onRestored,
  conversationId = null,
  skills = [],
  onSkillsChange,
  residentSkills = [],
  mentionOptions,
}: ComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const mentionRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const atRef = useRef<HTMLDivElement>(null);
  const atListRef = useRef<HTMLUListElement>(null);
  const [draft, setDraft] = useState("");
  const [skillOpen, setSkillOpen] = useState(false);
  const [mentionOpen, setMentionOpen] = useState(false);
  /** 输入框里键入 @ 触发的候选状态：null=未触发；start 为 @ 在草稿中的下标，query 为 @ 后的筛选词。 */
  const [atTrigger, setAtTrigger] = useState<{ start: number; query: string } | null>(null);
  /** 键盘 / 悬停高亮的候选下标。 */
  const [atIndex, setAtIndex] = useState(0);
  const [files, setFiles] = useState<ComposerFile[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [catalog, setCatalog] = useState<InstalledSkill[]>([]);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillLoading, setSkillLoading] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // 技能附件面板打开时：只拉「已安装」列表；关键词在本地做前缀 / 包含过滤。
  // 聊天里不允许临时挂未下载的技能——用户需先在技能市场下载，否则后端查不到 SKILL.md。
  useEffect(() => {
    if (!skillOpen) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSkillLoading(true);
      setSkillError(null);
      void listInstalledSkills()
        .then((res) => {
          if (cancelled) return;
          setCatalog(res.skills);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setCatalog([]);
          setSkillError(err instanceof Error ? err.message : "技能目录暂不可用");
        })
        .finally(() => {
          if (!cancelled) setSkillLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [skillOpen]);

  useEffect(() => {
    if (!skillOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!barRef.current?.contains(event.target as Node)) setSkillOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [skillOpen]);

  useEffect(() => {
    if (!mentionOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!mentionRef.current?.contains(event.target as Node)) setMentionOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [mentionOpen]);

  // 点名完全由草稿文本决定（和微信一样：正文里写了 @谁，就是点名谁）。
  const mentionIds = useMemo<string[]>(
    () => (variant === "group" ? parseMentionIds(draft, mentionOptions ?? []) : []),
    [draft, mentionOptions, variant]
  );
  const mentioned = useMemo<MemberAvatar[]>(
    () =>
      mentionIds
        .map((id) => mentionOptions?.find((m) => m.id === id))
        .filter((m): m is MemberAvatar => !!m),
    [mentionIds, mentionOptions]
  );

  /** 只有群组变体且有成员时才支持 @ 点名；@ 后输入的内容按名字做包含匹配。 */
  const atCandidates = useMemo<MemberAvatar[]>(() => {
    if (variant !== "group" || !atTrigger) return [];
    const list = mentionOptions ?? [];
    const q = atTrigger.query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.name.toLowerCase().includes(q));
  }, [atTrigger, mentionOptions, variant]);

  /** @ 候选面板是否可见：已触发且有匹配成员。 */
  const atOpen = !!atTrigger && atCandidates.length > 0;

  useEffect(() => {
    if (!atOpen) return;
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (atRef.current?.contains(target)) return;
      if (inputRef.current === target) return;
      setAtTrigger(null);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [atOpen]);

  // 切换群 / 会话后清空草稿，点名随文本一起失效，只需收起弹层。
  useEffect(() => {
    setMentionOpen(false);
    setAtTrigger(null);
    setAtIndex(0);
  }, [conversationId]);

  // 高亮项随键盘移动时滚动到可视区。
  useEffect(() => {
    if (!atOpen) return;
    const el = atListRef.current?.querySelector<HTMLElement>(
      `[data-at-index="${atIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [atIndex, atOpen]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const isOverDropZone = (pos: { x: number; y: number }) => {
      const el = dropRef.current;
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom;
    };
    void (async () => {
      try {
        const win = getCurrentWindow();
        const fn = await win.onDragDropEvent((event) => {
          const { payload } = event;
          if (payload.type === "drop") {
            if (isOverDropZone(payload.position))
              void uploadAndAdd(payload.paths.map((p) => ({ source_path: p })));
            setDragActive(false);
          } else if (payload.type === "enter" || payload.type === "over") {
            setDragActive(isOverDropZone(payload.position));
          } else {
            setDragActive(false);
          }
        });
        // 若组件在异步注册完成前已卸载（StrictMode 双重挂载），立即反注册，
        // 避免重复注册导致一次拖放触发多次上传。
        if (cancelled) fn();
        else unlisten = fn;
      } catch {
        // Browser preview without Tauri — drag-drop is unavailable.
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const autoGrow = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_H);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_H ? "auto" : "hidden";
  };

  const resetInput = () => {
    setDraft("");
    setAtTrigger(null);
    setAtIndex(0);
    const el = inputRef.current;
    if (!el) return;
    el.style.height = `${MIN_H}px`;
    el.style.overflowY = "hidden";
  };

  // 扫描光标前的文本，判断是否处于「@筛选词」输入态：
  // @ 必须在开头或空白之后（避免邮箱 / 正文里的 @ 误触发），且 @ 后未出现空白。
  const detectAt = (el: HTMLTextAreaElement) => {
    if (variant !== "group" || !mentionOptions || mentionOptions.length === 0) {
      setAtTrigger(null);
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at < 0) {
      setAtTrigger(null);
      return;
    }
    const prev = at > 0 ? before[at - 1] : "";
    const query = before.slice(at + 1);
    if ((prev && !/\s/.test(prev)) || /\s/.test(query)) {
      setAtTrigger(null);
      return;
    }
    setAtTrigger({ start: at, query });
    setAtIndex(0);
  };

  /** 把草稿改成 next 并把光标放到 caret：统一在这里收尾（高度自适应 + 弹层收起 + 回焦）。 */
  const commitDraft = (next: string, caret: number) => {
    setDraft(next);
    setAtTrigger(null);
    setAtIndex(0);
    setMentionOpen(false);
    window.requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(caret, caret);
      autoGrow(node);
    });
  };

  // 键入 @ 后选中某个成员：把「@筛选词」整体替换成「@昵称 」，可继续 @ 下一个人。
  const applyMention = (member: MemberAvatar) => {
    const el = inputRef.current;
    if (!el || !atTrigger) return;
    const caret = el.selectionStart ?? el.value.length;
    const token = `@${member.name} `;
    const next = el.value.slice(0, atTrigger.start) + token + el.value.slice(caret);
    commitDraft(next, atTrigger.start + token.length);
  };

  // 「@ 成员」按钮：在光标处插入 @昵称（前后按需补空格），已点名则取消。
  const toggleMentionFromBar = (member: MemberAvatar) => {
    const el = inputRef.current;
    if (!el) return;
    if (mentionIds.includes(member.id)) {
      removeMention(member);
      setMentionOpen(false);
      return;
    }
    const caret = el.selectionStart ?? el.value.length;
    const head = el.value.slice(0, caret);
    const tail = el.value.slice(caret);
    const lead = head && !/\s$/.test(head) ? " " : "";
    const token = `@${member.name} `;
    commitDraft(`${head}${lead}${token}${tail}`, caret + lead.length + token.length);
  };

  // 取消点名：把文本里的 @昵称 删掉（文本是唯一事实来源，删了就等于取消）。
  const removeMention = (member: MemberAvatar) => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? draft.length;
    // 与解析口径保持一致：@昵称 后面必须接空白 / 标点 / 结尾，避免误删昵称前缀相同的正文。
    const next = draft.replace(
      new RegExp(
        `\\s?@${escapeRegExp(member.name)}(?=[\\s，。！？、；：,.!?;:'"’”)\\]}]|$)`,
        "g"
      ),
      ""
    );
    commitDraft(next, Math.min(caret, next.length));
  };

  // 编辑 / 撤回后把原文回灌到输入框，便于继续修改后重发。
  useEffect(() => {
    if (restoreText == null) return;
    setDraft(restoreText);
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      const next = Math.min(el.scrollHeight, MAX_H);
      el.style.height = `${next}px`;
      el.style.overflowY = el.scrollHeight > MAX_H ? "auto" : "hidden";
      el.focus();
    }
    onRestored?.();
  }, [restoreText, onRestored]);

  // 发送：拼出带本地文件路径的最终文案，并把 skills（含 slug）交给父组件。
  // 技能是会话级的：发送后保留 chip（当前会话持续生效），移除需在 chip 上手动操作；
  // files 仍是单次性的，发送后清空。
  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    onSend(composeOutgoing(text, files), skills, mentionIds);
    setFiles([]);
    setSkillOpen(false);
    setMentionOpen(false);
    resetInput();
  };

  const uploadAndAdd = useCallback(
    async (items: UploadItemInput[]) => {
      if (items.length === 0) return;
      setUploadError(null);
      try {
        const res = await uploadFiles(items, conversationId);
      const results = res?.files ?? [];
      const accepted = results.filter(
        (f): f is { name: string; path: string } => !!f && !f.error && !!f.path
      );
      if (accepted.length > 0) {
        setFiles((prev) => {
          const seen = new Set(prev.map((f) => f.path));
          const next = [...prev];
          for (const f of accepted) {
            if (seen.has(f.path)) continue;
            seen.add(f.path);
            next.push({ path: f.path, name: f.name });
          }
          return next;
        });
      }
      const failed = results.filter((f) => !!f && !!f.error);
      if (failed.length > 0) {
        setUploadError(
          failed.map((f) => (f as { error: string }).error).join("；")
        );
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "文件上传失败");
    }
  }, [conversationId]);

  const pickFiles = async () => {
    setSkillOpen(false);
    try {
      const selected = await open({ multiple: true, title: "添加文件" });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      await uploadAndAdd(paths.map((p) => ({ source_path: p })));
    } catch {
      fileInputRef.current?.click();
    }
  };

  // 本地按关键词过滤（name / description / slug，忽略大小写）；空关键词展示全部。
  // 常驻技能（residentSkills）已由角色自动注入，不出现在勾选面板里。
  const filteredCatalog = ((): InstalledSkill[] => {
    const q = keyword.trim().toLowerCase();
    let list = catalog;
    if (q) {
      list = catalog.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q)
      );
    }
    const residentSet = new Set(residentSkills);
    return list.filter((s) => !residentSet.has(s.slug));
  })();

  // 勾选一条已安装的技能：按 slug 去重追加到已选（会话级，持久化由父组件负责），
  // 然后收起面板、清空搜索词。已选列表以 chip 形式展示，随消息提交 slug。
  const attachSkill = (item: InstalledSkill) => {
    if (skills.some((s) => s.slug === item.slug)) {
      setSkillOpen(false);
      setKeyword("");
      return;
    }
    onSkillsChange?.([...skills, { slug: item.slug, name: item.name }]);
    setSkillOpen(false);
    setKeyword("");
  };

  // 模型名 + 上下文用量：只属于对话视图；群组视图没有模型 / 技能的概念。
  const modelBar =
    variant === "chat" ? (
      <>
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
      </>
    ) : null;

  return (
    <footer className="px-6 pb-5 pt-1">
      <div ref={barRef} className="mx-auto max-w-[760px]">
        <div className="flex items-center gap-2 pb-2">
          {modelBar}

          <div className="ml-auto flex items-center gap-2">
            {variant === "chat" ? (
              <div className="relative">
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
                  placeholder="搜索已安装的技能"
                  className="w-full rounded-lg bg-page px-2.5 py-1.5 text-[12px] text-ink-900 placeholder:text-ink-400 focus:outline-none"
                />
                <ul className="mt-1 max-h-52 overflow-auto">
                  {skillLoading ? (
                    <li className="px-2 py-2 text-[12px] text-ink-400">加载中…</li>
                  ) : skillError ? (
                    <li className="px-2 py-2 text-[12px] text-danger-600">{skillError}</li>
                  ) : filteredCatalog.length === 0 ? (
                    <li className="px-2 py-2 text-[12px] text-ink-400">
                      {catalog.length === 0
                        ? "还没有安装技能，去「技能」页下载"
                        : keyword.trim()
                          ? "没有匹配的技能"
                          : "当前角色已常驻全部技能，无需重复勾选"}
                    </li>
                  ) : (
                    filteredCatalog.map((item) => (
                      <li key={item.slug}>
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
            ) : null}

            {variant === "group" && mentionOptions && mentionOptions.length > 0 ? (
              <div ref={mentionRef} className="relative">
                <button
                  type="button"
                  title={
                    mentioned.length > 0
                      ? `已点名 ${mentioned.map((m) => m.name).join("、")}`
                      : "点名某个成员"
                  }
                  onClick={() => {
                    setSkillOpen(false);
                    setMentionOpen((open) => !open);
                  }}
                  className={cn(
                    "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] transition-colors focus-visible:outline-2 focus-visible:outline-brand-600",
                    mentioned.length > 0
                      ? "bg-brand-50 text-brand-700 hover:bg-brand-100"
                      : "bg-page text-ink-500 hover:bg-tint hover:text-brand-700"
                  )}
                >
                  <AtSign className="size-3" strokeWidth={1.75} />
                  {mentioned.length > 0 ? `@ ${mentioned.length}` : "点名"}
                </button>
                {mentionOpen ? (
                  <div className="absolute right-0 bottom-full z-20 mb-1 w-56 rounded-xl bg-surface p-1.5 shadow-lift">
                    <ul className="max-h-56 overflow-auto">
                      {mentionOptions.map((mb) => (
                        <li key={mb.id}>
                          <button
                            type="button"
                            onClick={() => toggleMentionFromBar(mb)}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-tint"
                          >
                            {mb.avatarUrl ? (
                              <img
                                src={mb.avatarUrl}
                                alt=""
                                draggable={false}
                                className="size-5 shrink-0 rounded-full object-cover"
                              />
                            ) : (
                              <span
                                className={cn(
                                  "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white",
                                  mb.colorClass
                                )}
                              >
                                {mb.name.slice(0, 1)}
                              </span>
                            )}
                            <span className="min-w-0 truncate text-[12.5px] font-medium text-ink-900">
                              {mb.name}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

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
              const fileList = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (fileList.length === 0) return;
              void (async () => {
                try {
                  const items = await Promise.all(
                    fileList.map(async (file) => ({
                      content_base64: toBase64(
                        new Uint8Array(await file.arrayBuffer())
                      ),
                      name: file.name,
                    }))
                  );
                  await uploadAndAdd(items);
                } catch (err) {
                  setUploadError(
                    err instanceof Error ? err.message : "文件读取失败"
                  );
                }
              })();
            }}
          />
          </div>
        </div>

        {(variant === "chat" && skills.length > 0) ||
        files.length > 0 ||
        mentioned.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pb-2">
            {variant === "chat"
              ? skills.map((skill) => (
                  <Chip
                    key={skill.slug}
                    label={catalog.find((c) => c.slug === skill.slug)?.name ?? skill.name}
                    onRemove={() =>
                      onSkillsChange?.(skills.filter((s) => s.slug !== skill.slug))
                    }
                  />
                ))
              : null}
            {mentioned.map((mb) => (
              <Chip
                key={mb.id}
                label={`@${mb.name}`}
                title={`将点名 ${mb.name}，本轮由 TA 回复`}
                onRemove={() => removeMention(mb)}
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

        {uploadError ? (
          <p className="pb-1 text-[12px] text-danger-600">{uploadError}</p>
        ) : null}

        <div
          ref={dropRef}
          onDragOver={(e) => {
            e.preventDefault();
            if (!dragActive) setDragActive(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null))
              setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
          }}
          className={cn(
            "relative flex items-end gap-2 rounded-2xl bg-page p-2.5 pl-4 shadow-soft transition-shadow focus-within:shadow-lift",
            dragActive &&
              "outline-2 outline-dashed outline-brand-500 bg-tint"
          )}
        >
          {atOpen ? (
            <div
              ref={atRef}
              className="absolute left-3 bottom-full z-30 mb-2 w-64 rounded-xl bg-surface p-1.5 shadow-lift"
            >
              <p className="px-2 pb-1 text-[10.5px] text-ink-400">
                选择成员（↑↓ 切换，Enter 选中，Esc 关闭）
              </p>
              <ul ref={atListRef} className="max-h-56 overflow-auto">
                {atCandidates.map((mb, index) => (
                  <li key={mb.id}>
                    <button
                      type="button"
                      data-at-index={index}
                      onMouseEnter={() => setAtIndex(index)}
                      // 在 mousedown 阶段处理并阻止默认行为：输入框不会失焦，后续选中态与光标位置才稳定。
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyMention(mb);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left",
                        index === atIndex ? "bg-tint" : "hover:bg-tint"
                      )}
                    >
                      {mb.avatarUrl ? (
                        <img
                          src={mb.avatarUrl}
                          alt=""
                          draggable={false}
                          className="size-5 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white",
                            mb.colorClass
                          )}
                        >
                          {mb.name.slice(0, 1)}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-900">
                        {mb.name}
                      </span>
                      {mentionIds.includes(mb.id) ? (
                        <Check className="size-3.5 shrink-0 text-brand-600" strokeWidth={2} />
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            disabled={sending}
            onChange={(e) => {
              setDraft(e.target.value);
              autoGrow(e.target);
              detectAt(e.target);
            }}
            onSelect={(e) => detectAt(e.currentTarget)}
            onKeyDown={(e) => {
              if (atOpen) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAtIndex((i) => (i + 1) % atCandidates.length);
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAtIndex((i) => (i - 1 + atCandidates.length) % atCandidates.length);
                  return;
                }
                if (e.key === "Enter" || e.key === "Tab") {
                  const target = atCandidates[atIndex];
                  if (target) {
                    e.preventDefault();
                    applyMention(target);
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAtTrigger(null);
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            onBlur={() => setAtTrigger(null)}
            placeholder={
              sending
                ? "Agent 处理中…"
                : variant === "group"
                  ? "给群组下达指令…（输入 @ 指派成员，Enter 发送）"
                  : "给 Agent 下达指令…（Enter 发送，Shift+Enter 换行）"
            }
            className="flex-1 resize-none overflow-y-hidden bg-transparent py-1.5 text-[13px] leading-5 text-ink-900 placeholder:text-ink-400 focus:outline-none disabled:opacity-60"
            style={{ height: MIN_H, maxHeight: MAX_H }}
          />
          {sending ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="停止生成"
              title="停止生成"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-danger-600 text-white shadow-soft transition-colors hover:bg-danger-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger-600"
            >
              <Square className="size-4" strokeWidth={2} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              aria-label="发送"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-soft transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50"
            >
              <SendHorizontal className="size-4" strokeWidth={1.75} />
            </button>
          )}
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

/** 上下文用量环；群组视图把它放在气泡上方，因此对外导出。 */
export function ContextRing({ pct, size = 14 }: { pct: number; size?: number }) {
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
