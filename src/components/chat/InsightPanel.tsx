import {
  ArrowRight,
  Ban,
  Check,
  File,
  Image,
  Lightbulb,
  PanelRightClose,
  Sparkles,
  Table,
  Ticket,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

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
};

export function InsightPanel({
  thread = [],
  artifacts = [],
  onClose,
}: InsightPanelProps) {
  const steps: InsightStep[] = [];
  let goal = "";
  thread.forEach((m) => {
    if (m.role === "trace" && "trace" in m) {
      if (!goal) goal = m.trace.goal;
      m.trace.steps.forEach((s) => steps.push(s));
    }
  });

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
            hint={steps.length ? `${steps.length} 步` : null}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
            {goal ? (
              <div className="mb-3 flex items-center gap-1.5 rounded-xl bg-tint/70 px-3 py-2 text-[12px] leading-5 text-ink-500">
                <span className="shrink-0 font-medium text-ink-700">目标</span>
                <span className="truncate">{goal}</span>
              </div>
            ) : null}
            {steps.length ? (
              <div className="flex flex-col">
                {steps.map((s, i) => (
                  <TimelineNode key={i} step={s} last={i === steps.length - 1} />
                ))}
              </div>
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
  return (
    <div className="w-full min-w-0 rounded-xl bg-surface px-2.5 py-2 shadow-soft">
      <div className="flex min-w-0 items-center gap-1.5">
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
      </div>
      <code className="mt-1 block w-full rounded-md bg-tint/80 px-1.5 py-0.5 font-mono text-[10px] leading-4 break-all text-ink-500">
        {step.args}
      </code>
      <div className="mt-1 flex min-w-0 items-start gap-1 text-[11px] leading-4 text-ink-500">
        <ArrowRight className="mt-0.5 size-3 shrink-0 text-ink-400" strokeWidth={1.75} />
        <span className="min-w-0 flex-1 break-words">{step.result}</span>
      </div>
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
