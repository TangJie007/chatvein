import dayjs from "dayjs";
import {
  ExternalLink,
  Loader2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  getSkill,
  installSkill,
  uninstallSkill,
  type SkillHubDetail,
  type SkillHubItem,
} from "../../api";
import { openExternal } from "../../lib/openExternal";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

function formatCount(n: number): string {
  if (n >= 10_000) {
    const wan = n / 10_000;
    return `${wan >= 100 ? Math.round(wan) : wan.toFixed(1).replace(/\.0$/, "")}万`;
  }
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

function formatUpdatedAt(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  const ms = value > 1e12 ? value : value * 1000;
  const d = dayjs(ms);
  return d.isValid() ? d.format("YYYY-MM-DD") : null;
}

type SkillDetailDrawerProps = {
  skill: SkillHubItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 抽屉里成功安装 / 卸载时回调，父组件据此同步卡片状态。 */
  onInstallChange?: (slug: string, installed: boolean) => void;
};

export function SkillDetailDrawer({
  skill,
  open,
  onOpenChange,
  onInstallChange,
}: SkillDetailDrawerProps) {
  const [detail, setDetail] = useState<SkillHubDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !skill?.slug) {
      setDetail(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);

    void getSkill(skill.slug)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        // 首次拉到详情时同步一次已安装状态：让父组件的卡片也保持一致。
        onInstallChange?.(skill.slug, Boolean(data.installed));
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, skill?.slug, refreshKey, onInstallChange]);

  const title = detail?.name || skill?.name || "技能详情";
  const description =
    detail?.description || skill?.description || "暂无简介";
  const iconUrl = detail?.icon_url || skill?.icon_url;
  const homepage = detail?.homepage || skill?.homepage;
  const updated = formatUpdatedAt(detail?.updated_at ?? skill?.updated_at);
  const bodyMd = detail?.overview_md || detail?.skill_md || "";
  const installed = Boolean(detail?.installed);
  const canInstall = Boolean(detail?.skill_md?.trim());

  const handleInstallToggle = async () => {
    if (!skill?.slug || installing) return;
    setInstalling(true);
    setInstallError(null);
    try {
      if (installed) {
        await uninstallSkill(skill.slug);
        setDetail((prev) => (prev ? { ...prev, installed: false } : prev));
        onInstallChange?.(skill.slug, false);
      } else {
        const next = await installSkill(skill.slug);
        setDetail(next);
        onInstallChange?.(skill.slug, true);
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="max-w-[480px]">
        {skill && (
          <>
            <SheetHeader>
              <div className="flex items-start gap-3 pr-2">
                <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-tint shadow-soft">
                  {iconUrl ? (
                    <img
                      src={iconUrl}
                      alt=""
                      className="size-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <Sparkles className="size-5 text-brand-500" strokeWidth={1.75} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <SheetTitle className="truncate text-[16px] font-semibold text-ink-900">
                    {title}
                  </SheetTitle>
                  <SheetDescription className="mt-1 text-[12.5px] leading-5 text-ink-500">
                    {detail?.publisher || skill.publisher || skill.slug}
                    {(detail?.version || skill.version)
                      ? ` · v${detail?.version || skill.version}`
                      : ""}
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
              {loading && (
                <div className="flex items-center justify-center gap-2 py-16 text-[13px] text-ink-400">
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
                  正在加载详情…
                </div>
              )}

              {!loading && error && (
                <div className="rounded-xl bg-page px-3.5 py-4">
                  <p className="text-[12.5px] font-medium text-ink-900">详情加载失败</p>
                  <p className="mt-1 text-[11.5px] leading-4 text-ink-500">{error}</p>
                  <Button
                    variant="tint"
                    size="sm"
                    className="mt-3"
                    onClick={() => setRefreshKey((n) => n + 1)}
                  >
                    重试
                  </Button>
                </div>
              )}

              {!loading && !error && (
                <div className="flex flex-col gap-4">
                  <p className="text-[13px] leading-6 text-ink-700 whitespace-pre-wrap">
                    {description}
                  </p>

                  <div className="flex flex-wrap gap-1.5">
                    <span className="rounded-lg bg-tint px-2 py-0.5 text-[11.5px] text-ink-500">
                      {detail?.category_label || skill.category_label}
                    </span>
                    {(detail?.sub_categories || skill.sub_categories).map((label) => (
                      <span
                        key={label}
                        className="rounded-lg bg-page px-2 py-0.5 text-[11.5px] text-ink-400"
                      >
                        {label}
                      </span>
                    ))}
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded-xl bg-page px-3 py-2.5 text-center">
                    <Stat
                      label="下载"
                      value={formatCount(detail?.downloads ?? skill.downloads)}
                    />
                    <Stat
                      label="安装"
                      value={formatCount(detail?.installs ?? skill.installs)}
                    />
                    <Stat
                      label="收藏"
                      value={formatCount(detail?.stars ?? skill.stars)}
                    />
                  </div>

                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                    {updated && (
                      <>
                        <dt className="text-ink-400">更新</dt>
                        <dd className="text-ink-600">{updated}</dd>
                      </>
                    )}
                    {detail?.version_count ? (
                      <>
                        <dt className="text-ink-400">版本数</dt>
                        <dd className="text-ink-600">{detail.version_count}</dd>
                      </>
                    ) : null}
                    {detail?.changelog ? (
                      <>
                        <dt className="text-ink-400">变更</dt>
                        <dd className="text-ink-600">{detail.changelog}</dd>
                      </>
                    ) : null}
                    {detail?.source || skill.source ? (
                      <>
                        <dt className="text-ink-400">来源</dt>
                        <dd className="text-ink-600">
                          {detail?.source || skill.source}
                          {(detail?.verified ?? skill.verified) ? " · 已认证" : ""}
                        </dd>
                      </>
                    ) : null}
                  </dl>

                  {detail?.security_reports && detail.security_reports.length > 0 && (
                    <div className="rounded-xl bg-page px-3.5 py-3">
                      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-700">
                        <ShieldCheck className="size-3.5 text-brand-600" strokeWidth={1.75} />
                        安全扫描
                      </div>
                      <ul className="mt-2 flex flex-col gap-1.5">
                        {detail.security_reports.map((report) => (
                          <li
                            key={report.provider}
                            className="flex items-center justify-between gap-2 text-[11.5px]"
                          >
                            <span className="text-ink-500">{report.provider}</span>
                            {report.report_url ? (
                              <button
                                type="button"
                                className="truncate text-brand-700 hover:underline"
                                onClick={() =>
                                  void openExternal(report.report_url)
                                }
                              >
                                {report.status_text || report.status || "查看报告"}
                              </button>
                            ) : (
                              <span className="text-ink-600">
                                {report.status_text || report.status}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {bodyMd ? (
                    <div>
                      <h3 className="mb-2 text-[12px] font-medium text-ink-500">
                        {detail?.overview_md ? "概览" : "SKILL.md"}
                      </h3>
                      <pre className="max-h-[40vh] overflow-auto rounded-xl bg-page px-3.5 py-3 font-mono text-[11.5px] leading-5 whitespace-pre-wrap text-ink-600">
                        {bodyMd}
                      </pre>
                    </div>
                  ) : null}

                  <div className="flex flex-col gap-2 pt-1">
                    {installError ? (
                      <p className="text-[12px] text-danger-600">{installError}</p>
                    ) : null}
                    <div className="flex items-center gap-2">
                      <Button
                        variant="tint"
                        size="sm"
                        className="flex-1"
                        disabled={loading || installing || (!installed && !canInstall)}
                        onClick={() => {
                          void handleInstallToggle();
                        }}
                      >
                        {installing ? (
                          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
                        ) : null}
                        {installed ? "卸载" : "安装到本机"}
                      </Button>
                      {homepage && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void openExternal(homepage)}
                        >
                          <ExternalLink className="size-3.5" strokeWidth={1.75} />
                          SkillHub
                        </Button>
                      )}
                    </div>
                    {!installed && !canInstall && !loading ? (
                      <p className="text-[11.5px] text-ink-400">
                        该技能暂无 SKILL.md，无法安装
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[13px] font-medium text-ink-800">{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-400">{label}</div>
    </div>
  );
}
