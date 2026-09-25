import { useEffect, useRef, useState } from "react";
import { ChevronRight, Download, Loader2, Zap } from "lucide-react";
import type { InstalledSkill } from "../../../api";
import { cn } from "../../../lib/cn";

/** 常驻技能下拉多选：点击展开面板，checkbox 勾选已下载的技能。 */
export function ResidentSkillPicker({
  installed,
  loading,
  selected,
  onToggle,
}: {
  installed: InstalledSkill[];
  loading: boolean;
  selected: string[];
  onToggle: (slug: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [keyword, setKeyword] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedSet = new Set(selected);
  const kw = keyword.trim().toLowerCase();
  const filtered = kw
    ? installed.filter(
        (s) =>
          s.name.toLowerCase().includes(kw) || s.slug.toLowerCase().includes(kw)
      )
    : installed;

  return (
    <div ref={ref} className="relative">
      {/* 选择框：显示已选数量与首几个技能名 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-xl bg-surface px-3 py-2 text-left shadow-soft transition-shadow hover:shadow-lift focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-tint text-brand-600">
          <Zap className="size-3.5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1 truncate">
          {selected.length === 0 ? (
            <span className="text-[12.5px] text-ink-400">从已下载技能中挑选</span>
          ) : (
            <span className="text-[12.5px] text-ink-900">
              已选 {selected.length} 个常驻技能
              {selected.slice(0, 2).map((slug) => {
                const meta = installed.find((s) => s.slug === slug);
                return <span key={slug}> · {meta?.name ?? slug}</span>;
              })}
              {selected.length > 2 && (
                <span className="text-ink-400"> +{selected.length - 2}</span>
              )}
            </span>
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
        <div className="absolute left-0 right-0 z-20 mt-1 max-h-72 overflow-y-auto rounded-xl bg-surface p-1 shadow-lift">
          {/* 搜索框 */}
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索技能名称或 slug…"
            className="mb-1 w-full rounded-lg bg-page px-2.5 py-1.5 text-[12px] text-ink-900 placeholder-ink-400 focus:outline-none"
          />
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-3 text-[12px] text-ink-400">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
              加载已下载技能…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 py-4 text-center">
              <span className="flex size-8 items-center justify-center rounded-xl bg-tint text-brand-600">
                <Download className="size-4" strokeWidth={1.75} />
              </span>
              <p className="text-[12px] text-ink-500">
                {kw ? "没有匹配的技能" : "还没有已下载的技能"}
              </p>
              {!kw && (
                <p className="text-[11px] text-ink-400">
                  去「技能」页面下载，然后回这里勾选
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col">
              {filtered.map((s) => {
                const on = selectedSet.has(s.slug);
                return (
                  <label
                    key={s.slug}
                    className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-tint/50"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onToggle(s.slug)}
                      className="size-3.5 shrink-0 accent-brand-600"
                    />
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-md",
                        on ? "bg-tint text-brand-600" : "bg-page text-ink-400"
                      )}
                    >
                      <Zap className="size-3" strokeWidth={1.75} />
                    </span>
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 truncate text-[12px] font-medium text-ink-900">
                        {s.name}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-ink-400">
                        {s.slug}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selected.length > 0 && (
        <p className="mt-1.5 text-[10.5px] leading-4 text-ink-400">
          常驻技能在每次会话开始时自动注入角色提示词；对话里临时加的技能仅本次生效。
        </p>
      )}
    </div>
  );
}
