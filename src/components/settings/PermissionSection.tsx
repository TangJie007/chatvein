import { Loader2, Plus, RefreshCw, Save, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  getPermissions,
  listAuditEvents,
  savePermissions,
  type AuditEvent,
  type PermissionMode,
  type PermissionRule,
  type PermissionView,
} from "../../api";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Card, CardAction, IconButton, Note, Row, Select } from "./primitives";

const DECISION_LABEL: Record<string, string> = {
  allow: "放行",
  ask: "确认",
  deny: "拒绝",
};
const DECISION_TONE: Record<string, string> = {
  allow: "text-ok-600",
  ask: "text-warn-600",
  deny: "text-danger-600",
};

const TEMPLATES: { label: string; rule: PermissionRule }[] = [
  { label: "禁止跑命令", rule: { effect: "deny", tool: "bash_run", note: "由用户显式禁止" } },
  {
    label: "只写 output",
    rule: {
      effect: "deny",
      tool: "write_file",
      path_not_prefix: "session:output/**",
      note: "写入必须在 output/ 内",
    },
  },
  {
    label: "禁改库",
    rule: { effect: "deny", tool: "sqlite_query", read_only: false, note: "只允许查询" },
  },
  {
    label: "仅白名单域名",
    rule: { effect: "deny", tool: "web_fetch", url_host_in: ["example.com"], note: "仅允许这些域名" },
  },
];

function parseRules(text: string): PermissionRule[] {
  const data: unknown = JSON.parse(text);
  if (!Array.isArray(data)) throw new Error("规则必须是一个数组（[] 表示不限制）");
  return data as PermissionRule[];
}

function formatRule(rule: PermissionRule): string {
  const parts = [`${rule.effect} · ${rule.tool ?? "*"}`];
  if (rule.path_prefix) parts.push(`path~${rule.path_prefix}`);
  if (rule.path_not_prefix) parts.push(`path!~${rule.path_not_prefix}`);
  if (rule.url_host_in?.length) parts.push(`host∈${rule.url_host_in.join(",")}`);
  if (rule.read_only !== undefined) parts.push(rule.read_only ? "只读 SQL" : "写 SQL");
  return parts.join("  ");
}

const fieldBox =
  "w-16 rounded-xl bg-surface px-2.5 py-1.5 text-[12.5px] text-ink-900 shadow-soft focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600";

export function PermissionSection() {
  const [view, setView] = useState<PermissionView | null>(null);
  const [mode, setMode] = useState<PermissionMode>("normal");
  const [rulesText, setRulesText] = useState("[]");
  const [quotaTool, setQuotaTool] = useState("0");
  const [quotaTurn, setQuotaTurn] = useState("0");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditEnabled, setAuditEnabled] = useState(true);
  const [toolFilter, setToolFilter] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const applyView = useCallback((next: PermissionView) => {
    setView(next);
    setMode(next.mode);
    setRulesText(JSON.stringify(next.rules ?? [], null, 2));
    setQuotaTool(String(next.quota.max_per_tool_per_conversation ?? 0));
    setQuotaTurn(String(next.quota.max_per_turn_tool_calls ?? 0));
  }, []);

  const loadAudit = useCallback(async () => {
    try {
      const result = await listAuditEvents({
        limit: 100,
        tool: toolFilter.trim() || undefined,
        decision: decisionFilter === "all" ? undefined : decisionFilter,
      });
      setEvents(result.events);
      setAuditEnabled(result.enabled);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, [decisionFilter, toolFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      applyView(await getPermissions());
      await loadAudit();
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [applyView, loadAudit]);

  useEffect(() => {
    void load();
    // 只在进入分区时拉一次；筛选变化交给「刷新」，避免每次输入都打后端。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    setBanner(null);
    let rules: PermissionRule[];
    try {
      rules = parseRules(rulesText);
    } catch (err) {
      setBanner(`规则不是合法 JSON：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setSaving(true);
    try {
      const next = await savePermissions({
        mode,
        rules,
        quota: {
          max_per_tool_per_conversation: Number(quotaTool) || 0,
          max_per_turn_tool_calls: Number(quotaTurn) || 0,
        },
      });
      applyView(next);
      setBanner(`已保存，立即生效（${next.rules.length} 条规则）`);
      await loadAudit();
    } catch (err) {
      setBanner(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [applyView, loadAudit, mode, quotaTool, quotaTurn, rulesText]);

  const insertTemplate = useCallback(
    (rule: PermissionRule) => {
      try {
        setRulesText(JSON.stringify([...parseRules(rulesText), rule], null, 2));
      } catch {
        setRulesText(JSON.stringify([rule], null, 2));
      }
    },
    [rulesText]
  );

  const denied = events.filter((e) => e.decision === "deny").length;

  return (
    <Card
      title="权限与审计"
      desc="声明式规则决定工具是放行 / 确认 / 拒绝；执行留痕只追加、参数写前脱敏"
      icon={<ShieldCheck className="size-3.5 text-brand-600" strokeWidth={1.75} />}
      action={
        <>
          <CardAction label="保存" icon={Save} onClick={() => void save()} disabled={saving} />
          <IconButton title="重新读取" onClick={() => void load()}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
          </IconButton>
        </>
      }
    >
      {loading && (
        <p className="flex items-center gap-2 px-4 py-4 text-[11.5px] text-ink-400">
          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
          读取中…
        </p>
      )}

      {loadError && <Note tone="warn">读取失败：{loadError}</Note>}
      {view?.error && (
        <Note tone="warn">
          配置文件解析失败，规则未生效（当前按 normal 放行）：
          <span className="ml-1 font-mono">{view.error}</span>
        </Note>
      )}
      {banner && <Note tone="ok">{banner}</Note>}

      {view && (
        <>
          {view.env_mode && (
            <Note tone="muted">
              模式被环境变量 <code className="mx-1">CHATVEIN_PERMISSION_MODE</code> 锁定，界面选择不生效。
            </Note>
          )}

          <Row
            label="模式"
            hint={mode === "strict" ? "未知工具默认要求确认" : "未命中规则时放行（默认）"}
          >
            <Select
              value={mode}
              onChange={(v) => setMode(v === "strict" ? "strict" : "normal")}
              options={["normal", "strict"]}
            />
          </Row>

          <Row label="配额：单工具 / 会话" hint="0 表示不限；超限直接拒绝并提示模型换路">
            <input
              value={quotaTool}
              onChange={(e) => setQuotaTool(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className={fieldBox}
            />
          </Row>
          <Row label="配额：单轮工具调用" hint="0 表示不限；防止模型在一轮里反复试错">
            <input
              value={quotaTurn}
              onChange={(e) => setQuotaTurn(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              className={fieldBox}
            />
          </Row>

          <div className="px-3 pb-2">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <p className="text-[11px] text-ink-400">
                规则（按顺序取第一条命中；<span className="font-mono">[]</span> = 不限制）
              </p>
              {TEMPLATES.map(({ label, rule }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => insertTemplate(rule)}
                  className="inline-flex items-center gap-1 rounded-lg bg-surface px-2 py-0.5 text-[10.5px] text-brand-700 shadow-soft transition-colors hover:bg-tint focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <Plus className="size-3" strokeWidth={2} />
                  {label}
                </button>
              ))}
            </div>
            <textarea
              value={rulesText}
              onChange={(e) => setRulesText(e.target.value)}
              spellCheck={false}
              rows={10}
              className="w-full resize-y rounded-xl bg-surface p-3 font-mono text-[11.5px] leading-5 text-ink-900 shadow-soft focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600"
            />
            {view.rules.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {view.rules.map((rule, index) => (
                  <li
                    key={rule.id ?? index}
                    className="truncate font-mono text-[10.5px] text-ink-400"
                  >
                    {formatRule(rule)}
                    {rule.note ? ` — ${rule.note}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <div className="mx-3 mb-2 flex items-center gap-1.5">
        <p className="mr-auto text-[11px] text-ink-400">
          审计 · {events.length} 条{denied > 0 ? `（拒绝 ${denied}）` : ""}
          {!auditEnabled ? "（已关闭）" : ""}
        </p>
        <input
          value={toolFilter}
          onChange={(e) => setToolFilter(e.target.value)}
          placeholder="按工具名筛选"
          className="w-40 rounded-xl bg-surface px-2.5 py-1.5 text-[11.5px] text-ink-900 shadow-soft focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600"
        />
        <Select
          value={decisionFilter}
          onChange={setDecisionFilter}
          options={["all", "allow", "ask", "deny"]}
        />
        <Button size="sm" variant="ghost" onClick={() => void loadAudit()}>
          刷新
        </Button>
      </div>

      <div className="px-3 pb-3">
        {events.length === 0 ? (
          <p className="px-2 py-3 text-[11.5px] text-ink-400">
            {auditEnabled ? "还没有工具调用记录" : "审计已被 CHATVEIN_AUDIT=0 关闭，不写任何事件"}
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded-xl bg-surface shadow-soft">
            <table className="w-full table-fixed">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-[10.5px] text-ink-400">
                  <th className="w-[138px] px-3 py-1.5 font-normal">时间</th>
                  <th className="w-[150px] px-2 py-1.5 font-normal">工具</th>
                  <th className="w-[64px] px-2 py-1.5 font-normal">判定</th>
                  <th className="px-2 py-1.5 font-normal">依据 / 结果</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.seq} className="border-t border-tint/70 align-top">
                    <td className="px-3 py-1.5 font-mono text-[10.5px] text-ink-400">
                      {event.ts.replace("T", " ").slice(0, 19)}
                    </td>
                    <td className="truncate px-2 py-1.5 font-mono text-[10.5px] text-ink-700">
                      {event.tool || event.action}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-[10.5px] font-medium",
                        DECISION_TONE[event.decision] ?? "text-ink-500"
                      )}
                    >
                      {DECISION_LABEL[event.decision] ?? event.decision}
                    </td>
                    <td className="px-2 py-1.5">
                      <p className="truncate text-[10.5px] text-ink-500">
                        {event.decision_by}
                        {event.result_code ? ` · ${event.result_code}` : ""}
                        {event.duration_ms ? ` · ${event.duration_ms}ms` : ""}
                      </p>
                      <p className="truncate font-mono text-[10px] text-ink-400">
                        {JSON.stringify(event.args)}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
