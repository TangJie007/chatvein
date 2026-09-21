import { debounce } from "es-toolkit";
import {
  ExternalLink,
  Loader2,
  Search,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  listSkills,
  type SkillCategory,
  type SkillHubItem,
} from "../../api";
import { cn } from "../../lib/cn";
import { SkillDetailDrawer } from "../skills/SkillDetailDrawer";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ScrollArea } from "../ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../ui/tooltip";

const PAGE_SIZE = 24;

function formatCount(n: number): string {
  if (n >= 10_000) {
    const wan = n / 10_000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, "")}万`;
  }
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function SkillCard({
  skill,
  onOpen,
}: {
  skill: SkillHubItem;
  onOpen: (skill: SkillHubItem) => void;
}) {
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen(skill)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(skill);
        }
      }}
      className="flex cursor-pointer flex-col gap-2.5 rounded-2xl bg-tint/50 p-3.5 shadow-soft transition-colors hover:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface shadow-soft">
          {skill.icon_url ? (
            <img
              src={skill.icon_url}
              alt=""
              className="size-full object-cover"
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Sparkles className="size-4 text-brand-500" strokeWidth={1.75} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13.5px] font-medium text-ink-900">
            {skill.name}
          </h3>
          <p className="mt-0.5 truncate text-[11.5px] text-ink-400">
            {skill.publisher || skill.slug}
            {skill.version ? ` · v${skill.version}` : ""}
          </p>
        </div>
      </div>

      <p className="line-clamp-3 min-h-[3.6em] text-[12.5px] leading-5 text-ink-500">
        {skill.description || "暂无简介"}
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-lg bg-surface px-1.5 py-0.5 text-[11px] text-ink-500">
          {skill.category_label}
        </span>
        <span className="text-[11px] text-ink-400">
          ↓ {formatCount(skill.downloads)}
        </span>
        {skill.stars > 0 && (
          <span className="text-[11px] text-ink-400">★ {formatCount(skill.stars)}</span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 pt-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="flex-1"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <Button variant="tint" size="sm" className="w-full" disabled>
                安装
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>安装能力即将支持</TooltipContent>
        </Tooltip>
        {skill.homepage && (
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            title="在 SkillHub 打开"
            onClick={(e) => {
              e.stopPropagation();
              window.open(skill.homepage, "_blank", "noopener,noreferrer");
            }}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
          </Button>
        )}
      </div>
    </article>
  );
}

export function SkillsView() {
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [categories, setCategories] = useState<SkillCategory[]>([]);
  const [skills, setSkills] = useState<SkillHubItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [website, setWebsite] = useState("https://skillhub.cn");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<SkillHubItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const applyKeyword = useMemo(
    () =>
      debounce((value: string) => {
        setKeyword(value.trim());
        setPage(1);
      }, 320),
    []
  );

  useEffect(() => {
    return () => {
      applyKeyword.cancel();
    };
  }, [applyKeyword]);

  useEffect(() => {
    let cancelled = false;
    const append = page > 1;
    if (append) {
      setLoadingMore(true);
    } else {
      // 分类 / 搜索切换：先清空再出 loading，避免旧列表挡住加载态
      setLoading(true);
      setSkills([]);
      setTotal(0);
    }
    setError(null);

    void listSkills({
      page,
      pageSize: PAGE_SIZE,
      keyword: keyword || undefined,
      category: category || undefined,
      sortBy: "score",
    })
      .then((data) => {
        if (cancelled) return;
        setCategories(data.categories);
        setTotal(data.total);
        setWebsite(data.website || "https://skillhub.cn");
        setSkills((prev) => (append ? [...prev, ...data.skills] : data.skills));
      })
      .catch((err) => {
        if (cancelled) return;
        if (!append) setSkills([]);
        const raw = err instanceof Error ? err.message : String(err);
        setError(
          /Backend 404/i.test(raw)
            ? "后端没有 Skill 接口（多半是旧进程还在跑）。请重启应用后再试。"
            : raw
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoadingMore(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, keyword, category, refreshKey]);

  const hasMore = skills.length < total;

  const openDetail = (skill: SkillHubItem) => {
    setSelected(skill);
    setDetailOpen(true);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-3 border-b border-tint px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-[16px] font-semibold text-ink-900">Skill 市场</h1>
              <span className="rounded-lg bg-tint px-1.5 py-0.5 text-[11px] font-medium text-ink-500">
                SkillHub
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px] text-ink-400">
              浏览腾讯 SkillHub 公开技能；点击卡片查看详情，安装与使用后续接入
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(website, "_blank", "noopener,noreferrer")}
          >
            <ExternalLink className="size-3.5" strokeWidth={1.75} />
            官网
          </Button>
        </div>

        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-400"
            strokeWidth={1.75}
          />
          <Input
            value={keywordInput}
            onChange={(e) => {
              const value = e.target.value;
              setKeywordInput(value);
              applyKeyword(value);
            }}
            placeholder="搜索技能，例如：PPT、文档、爬虫…"
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              if (category === null) return;
              setCategory(null);
              setPage(1);
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors disabled:opacity-70",
              category === null
                ? "bg-brand-600 text-white shadow-soft"
                : "bg-tint text-ink-500 hover:bg-tint-deep hover:text-ink-700"
            )}
          >
            {loading && category === null && (
              <Loader2 className="size-3 animate-spin" strokeWidth={1.75} />
            )}
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={loading}
              onClick={() => {
                if (category === c.id) return;
                setCategory(c.id);
                setPage(1);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors disabled:opacity-70",
                category === c.id
                  ? "bg-brand-600 text-white shadow-soft"
                  : "bg-tint text-ink-500 hover:bg-tint-deep hover:text-ink-700"
              )}
            >
              {loading && category === c.id && (
                <Loader2 className="size-3 animate-spin" strokeWidth={1.75} />
              )}
              {c.label}
            </button>
          ))}
        </div>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-24 text-[13px] text-ink-400">
              <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
              正在从 SkillHub 加载…
            </div>
          ) : error && skills.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
              <p className="max-w-sm text-[13px] text-ink-500">{error}</p>
              <Button
                variant="tint"
                size="sm"
                onClick={() => {
                  setPage(1);
                  setRefreshKey((n) => n + 1);
                }}
              >
                重试
              </Button>
            </div>
          ) : skills.length === 0 ? (
            <div className="py-24 text-center text-[13px] text-ink-400">
              没有找到匹配的技能
            </div>
          ) : (
            <>
              <p className="mb-3 text-[12px] text-ink-400">
                共 {total.toLocaleString()} 个技能
                {keyword ? ` · 「${keyword}」` : ""}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {skills.map((skill, index) => (
                  <SkillCard
                    key={`${skill.slug}-${skill.version}-${index}`}
                    skill={skill}
                    onOpen={openDetail}
                  />
                ))}
              </div>
              <div className="flex justify-center py-6">
                {hasMore ? (
                  <Button
                    variant="tint"
                    size="sm"
                    disabled={loadingMore}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                        加载中
                      </>
                    ) : (
                      "加载更多"
                    )}
                  </Button>
                ) : (
                  <span className="text-[12px] text-ink-400">已全部加载</span>
                )}
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      <SkillDetailDrawer
        skill={selected}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </div>
  );
}
