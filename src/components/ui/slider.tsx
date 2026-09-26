// 滑块：数值徽标 + range 轨道。用于检索参数（topK / 阈值 / 切片大小）。
export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div className="rounded-xl bg-surface px-3 py-1.5 transition-shadow hover:shadow-lift">
      <div className="flex min-w-0 items-baseline gap-2">
        <p className="shrink-0 text-[12.5px] font-medium text-ink-900">{label}</p>
        {hint && (
          <p className="min-w-0 flex-1 truncate text-[11px] text-ink-400">{hint}</p>
        )}
        <span className="shrink-0 rounded-lg bg-page px-1.5 py-0.5 font-mono text-[11px] font-medium text-brand-700">
          {value}
          {suffix || ""}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-tint accent-brand-600 focus-visible:outline-2 focus-visible:outline-brand-600"
      />
    </div>
  );
}
