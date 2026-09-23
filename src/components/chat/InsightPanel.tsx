import {
  ArrowRight,
  Ban,
  Check,
  ChevronRight,
  File,
  FolderOpen,
  Image,
  Lightbulb,
  Loader2,
  PanelRightClose,
  Sparkles,
  Table,
  Ticket,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

export type InsightToolStatus = "ok" | "blocked";

export type InsightStep =
  | { kind: "thought"; text: string }
  | {
      kind: "tool";
      tool: string;
      args: string;
      status: InsightToolStatus;
      result: string;
    };

export type InsightTrace = {
  goal: string;
  steps: InsightStep[];
};

export type InsightThreadItem =
  | { role: "trace"; trace: InsightTrace }
  | { role: string };

export type InsightArtifact = {
  type: "ticket" | "file" | "table" | "image" | "alert";
  name: string;
  meta: string;
  time: string;
  /** 产物在本机的绝对路径，用于「在文件管理器中打开」；缺失则不显示该操作。 */
  path?: string;
};

type IconCmp = ComponentType<{ className?: string }>;

const ART_META: Record<
  InsightArtifact["type"],
  { icon: IconCmp; cls: string }
> = {
  ticket: { icon: TicketIcon, cls: "bg-warn-50 text-warn-600" },
  file: { icon: FileIcon, cls: "bg-brand-50 text-brand-700" },
  table: { icon: TableIcon, cls: "bg-teal-50 text-teal-600" },
  image: { icon: ImageIcon, cls: "bg-violet-50 text-violet-600" },
  alert: { icon: AlertIcon, cls: "bg-danger-50 text-danger-600" },
};

const STEP_STATUS: Record<
  InsightToolStatus,
  { text: string; cls: string; icon: IconCmp }
> = {
  ok: { text: "完成", cls: "bg-ok-50 text-ok-600", icon: CheckIcon },
  blocked: { text: "已拦截", cls: "bg-danger-50 text-danger-600", icon: StopIcon },
};

type InsightPanelProps = {
  open?: boolean;
  thread?: InsightThreadItem[];
  artifacts?: InsightArtifact[];
  onClose: () => void;
  /** 在文件管理器中打开产物所在目录（path 为本机绝对路径）。 */
  onRevealArtifact?: (path: string) => void;
  /**
   * 生成中的在途轮次：把「思考流」锁定到这条正在回答的问题，
   * 不再沿用上一轮轨迹（否则看起来毫无反应）。步骤由追踪实时轮询填充。
   */
  live?: { goal: string; steps: InsightStep[] } | null;
};

export function InsightPanel({
  thread = [],
  artifacts = [],
  onClose,
  onRevealArtifact,
  live = null,
}: InsightPanelProps) {
  const steps: InsightStep[] = [];
  let goal = "";
  thread.forEach((m) => {
    if (m.role === "trace" && "trace" in m) {
      if (!goal) goal = m.trace.goal;
      m.trace.steps.forEach((s) => steps.push(s));
    }
  });
  // 在途轮次：思考流只显示本轮问题与它自己的实时步骤（末尾挂一个进行中节点）。
  const shownGoal = live ? live.goal : goal;
  const shownSteps = live ? live.steps : steps;

  return (
    <aside className="flex w-[220px] shrink-0 flex-col bg-list">
      <header className="flex items-center gap-2 px-4 pt-5 pb-4">
        <span className="flex size-7 items-center justify-center rounded-lg bg-tint text-brand-600">
          <Sparkles className="size-4" strokeWidth={1.75} />
        </span>
        <h2 className="text-[15px] font-semibold text-ink-900">执行洞察</h2>
        <button
          type="button"
          onClick={onClose}
          title="收起"
          className="ml-auto flex size-7 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-tint hover:text-ink-700 focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <PanelRightClose className="size-4" strokeWidth={1.75} />
        </button>
      </header>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-5">
        <div className="flex min-h-0 min-w-0 flex-[7] flex-col">
          <SectionTitle
            icon={<Lightbulb className="size-4 text-amber-400" strokeWidth={1.75} />}
            title="思考流"
            hint={
              live
                ? shownSteps.length
                  ? `${shownSteps.length} 步 · 进行中`
                  : "进行中"
                : shownSteps.length
                  ? `${shownSteps.length} 步`
                  : null
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
            {shownGoal ? (
              <div
                className="mb-3 flex items-center gap-1.5 rounded-xl bg-tint/70 px-3 py-2 text-[12px] leading-5 text-ink-500"
                title={shownGoal}
              >
                <span className="shrink-0 font-medium text-ink-700">
                  {live ? "正在回答" : "目标"}
                </span>
                <span className="line-clamp-2 break-words">{shownGoal}</span>
              </div>
            ) : null}
            {shownSteps.length ? (
              <div className="flex flex-col">
                {shownSteps.map((s, i) => (
                  <TimelineNode
                    key={i}
                    step={s}
                    last={!live && i === shownSteps.length - 1}
                  />
                ))}
                {live ? <LiveThinkingNode /> : null}
              </div>
            ) : live ? (
              <LiveThinkingNode />
            ) : (
              <Empty text="该会话暂无执行轨迹" />
            )}
          </div>
        </div>

        <div className="mt-4 flex min-h-0 min-w-0 flex-[3] flex-col">
          <SectionTitle
            icon={<File className="size-4 text-brand-600" strokeWidth={1.75} />}
            title="产物"
            hint={artifacts.length ? `${artifacts.length} 项` : null}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
            {artifacts.length ? (
              <div className="flex flex-col gap-2">
                {artifacts.map((a, i) => {
                  const meta = ART_META[a.type] || ART_META.file;
                  const ArtIcon = meta.icon;
                  const canReveal = !!a.path && !!onRevealArtifact;
                  return (
                    <button
                      key={`${a.name}-${i}`}
                      type="button"
                      className="group flex w-full min-w-0 items-center gap-2 rounded-xl bg-surface p-2 text-left shadow-soft transition-shadow hover:shadow-lift focus-visible:outline-2 focus-visible:outline-brand-600"
                    >
                      <span
                        className={
                          "flex size-7 shrink-0 items-center justify-center rounded-lg " +
                          meta.cls
                        }
                      >
                        <ArtIcon />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12px] font-medium text-ink-900">
                          {a.name}
                        </p>
                        <p className="truncate text-[11px] text-ink-400">{a.meta}</p>
                      </div>
                      <span className="shrink-0 text-[10px] text-ink-300 group-hover:text-ink-500">
                        {a.time}
                      </span>
                      {canReveal ? (
                        <span
                          role="button"
                          tabIndex={0}
                          title="打开文件所在位置"
                          aria-label="打开文件所在位置"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRevealArtifact?.(a.path as string);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              onRevealArtifact?.(a.path as string);
                            }
                          }}
                          className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-400 transition-colors hover:bg-tint hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
                        >
                          <FolderOpen className="size-3.5" strokeWidth={1.75} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <Empty text="本次执行暂无产物" />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

/** 在途轮次的思考节点：转圈 + 计时，说明 Agent 正盯着当前这条问题在跑。 */
function LiveThinkingNode() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="relative flex min-w-0 gap-2">
      <span className="relative z-10 mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-surface shadow-soft">
        <Loader2 className="size-2.5 animate-spin text-brand-600" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="rounded-xl bg-tint/70 px-2.5 py-1.5 text-[11.5px] leading-4 break-words text-ink-500">
          <span className="font-medium text-ink-700">思考中 </span>
          <span className="animate-pulse">正在理解问题并规划执行路径…</span>
          <span className="ml-1 tabular-nums text-ink-400">{seconds}s</span>
        </div>
      </div>
    </div>
  );
}

function TimelineNode({ step, last }: { step: InsightStep; last: boolean }) {
  return (
    <div className="relative flex min-w-0 gap-2 pb-3 last:pb-0">
      {!last ? (
        <span className="absolute top-5 bottom-0 left-[8px] w-px bg-ink-200/70" />
      ) : null}
      <span className="relative z-10 mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-surface shadow-soft">
        {step.kind === "thought" ? (
          <Lightbulb className="size-2.5 text-amber-400" strokeWidth={1.75} />
        ) : (
          <Wrench className="size-2.5 text-ink-400" strokeWidth={1.75} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        {step.kind === "thought" ? (
          <div className="rounded-xl bg-tint/70 px-2.5 py-1.5 text-[11.5px] leading-4 break-words text-ink-500">
            <span className="font-medium text-ink-700">思考 </span>
            {step.text}
          </div>
        ) : (
          <ToolNode step={step} />
        )}
      </div>
    </div>
  );
}

function ToolNode({
  step,
}: {
  step: Extract<InsightStep, { kind: "tool" }>;
}) {
  const meta = STEP_STATUS[step.status] || STEP_STATUS.ok;
  const StatusIcon = meta.icon;
  // 工具返回结果默认折叠：头部始终露出工具名与状态，参数 / 结果通过点击展开。
  const [open, setOpen] = useState(false);
  const [expandedFull, setExpandedFull] = useState(false);
  const resultPreview = step.result.slice(0, 260);
  const hasMore = step.result.length > 260;
  const hasArgs = step.args.trim().length > 0 && step.args.trim() !== "{}";

  return (
    <div className="w-full min-w-0 rounded-xl bg-surface px-2.5 py-2 shadow-soft">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "收起详情" : "展开参数与结果"}
        className="flex min-w-0 w-full items-center gap-1.5 text-left focus-visible:outline-2 focus-visible:outline-brand-600 rounded-md"
      >
        <ChevronRight
          className={`size-3 shrink-0 text-ink-400 transition-transform ${open ? "rotate-90" : ""}`}
          strokeWidth={2}
        />
        <span className="truncate font-mono text-[11px] font-medium text-brand-700">
          {step.tool}
        </span>
        <span
          className={
            "ml-auto flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium " +
            meta.cls
          }
        >
          <StatusIcon />
          {meta.text}
        </span>
      </button>
      {open ? (
        <div className="mt-1.5 flex flex-col gap-1">
          {hasArgs ? (
            <code className="block w-full rounded-md bg-tint/80 px-1.5 py-0.5 font-mono text-[10px] leading-4 break-all text-ink-500">
              {step.args}
            </code>
          ) : null}
          <div className="flex min-w-0 items-start gap-1 text-[11px] leading-4 text-ink-500">
            <ArrowRight className="mt-0.5 size-3 shrink-0 text-ink-400" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 break-words">
              {expandedFull ? step.result : resultPreview}
            </span>
          </div>
          {hasMore ? (
            <button
              type="button"
              onClick={() => setExpandedFull((v) => !v)}
              className="ml-4 self-start rounded text-[10.5px] text-brand-600 hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              {expandedFull ? "收起" : "展开全文"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint: string | null;
}) {
  return (
    <div className="mb-2.5 flex min-w-0 items-center gap-1.5">
      {icon}
      <h3 className="truncate text-[12.5px] font-semibold text-ink-700">{title}</h3>
      {hint ? (
        <span className="ml-auto shrink-0 rounded-full bg-page px-2 py-0.5 text-[10.5px] text-ink-400">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl bg-page px-3 py-4 text-center text-[11.5px] text-ink-400">
      {text}
    </div>
  );
}

function TicketIcon() {
  return <Ticket className="size-3.5" strokeWidth={1.75} />;
}
function FileIcon() {
  return <File className="size-3.5" strokeWidth={1.75} />;
}
function TableIcon() {
  return <Table className="size-3.5" strokeWidth={1.75} />;
}
function ImageIcon() {
  return <Image className="size-3.5" strokeWidth={1.75} />;
}
function AlertIcon() {
  return <TriangleAlert className="size-3.5" strokeWidth={1.75} />;
}
function CheckIcon() {
  return <Check className="size-2.5" strokeWidth={2} />;
}
function StopIcon() {
  return <Ban className="size-2.5" strokeWidth={2} />;
}
