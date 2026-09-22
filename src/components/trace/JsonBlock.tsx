import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import "streamdown/styles.css";

const code = createCodePlugin({
  themes: ["github-light", "github-light"],
});

const plugins = { code, cjk };

function toPrettyJson(value: unknown): string {
  if (value == null) return "null";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return '""';
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch {
        return JSON.stringify(value, null, 2);
      }
    }
    return JSON.stringify(value, null, 2);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return JSON.stringify(String(value), null, 2);
  }
}

type JsonBlockProps = {
  value: unknown;
  /** 代码块最大高度（px），默认 480 */
  maxHeight?: number;
  emptyLabel?: string;
};

/** 追踪用：完整 JSON 格式化 + Shiki 高亮（Streamdown code）。 */
export function JsonBlock({
  value,
  maxHeight = 480,
  emptyLabel = "（空）",
}: JsonBlockProps) {
  if (value == null || value === "") {
    return (
      <p className="rounded-xl bg-surface px-3 py-2 text-[12px] text-ink-400 shadow-soft">
        {emptyLabel}
      </p>
    );
  }

  const body = toPrettyJson(value);
  return (
    <div className="trace-json overflow-hidden rounded-xl bg-surface shadow-soft">
      <Streamdown
        className="text-[12px] leading-5 text-ink-900"
        plugins={plugins}
        mode="static"
        lineNumbers
        codeBlockMaxHeight={maxHeight}
        controls={{
          code: { copy: true, download: false },
          table: { copy: false, download: false, fullscreen: false },
        }}
        translations={{
          copyCode: "复制 JSON",
          copied: "已复制",
        }}
      >
        {`\`\`\`json\n${body}\n\`\`\``}
      </Streamdown>
    </div>
  );
}
