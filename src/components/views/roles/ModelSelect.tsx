import { ChevronRight, Loader2 } from "lucide-react";
import type { LlmModelRecord } from "../../../api";

/** 绑定模型：每个角色必须显式指定模型；未配置模型时禁用下拉并给出提示。 */
export function ModelSelect({
  value,
  models,
  loading,
  onChange,
}: {
  value: string;
  models: LlmModelRecord[];
  loading: boolean;
  onChange: (v: string) => void;
}) {
  const disabled = loading || models.length === 0;
  return (
    <div className="relative">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-xl bg-surface py-1.5 pl-3 pr-7 text-[12.5px] text-ink-900 shadow-soft transition-shadow hover:shadow-lift focus:outline-none focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-60"
      >
        <option value="" disabled>
          {loading ? "加载中…" : "暂未配置模型，请先到「模型」里添加"}
        </option>
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-400">
        {loading ? (
          <Loader2 className="size-3.5 animate-spin" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="size-3.5 rotate-90" strokeWidth={1.75} />
        )}
      </span>
    </div>
  );
}
