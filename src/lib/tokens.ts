/** token 估算与上下文用量：对话视图与群组视图共用同一口径。 */

/** 粗略估算：CJK 按 1 token，其余按 0.25 token（与后端量级对齐即可，用于进度展示）。 */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    tokens += code > 0xff ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  const k = tokens / 1000;
  return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}K`;
}

export type ContextUsage = {
  used: number;
  total: number;
  pct: number;
  title: string;
};

/** 上下文用量：messages 累加估算 token，contextWindowK 为模型上下文窗口（K）。 */
export function contextUsage(
  messages: { content: string }[],
  contextWindowK = 128
): ContextUsage {
  const used = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const total = Math.max(1, contextWindowK * 1000);
  const pct = Math.min(100, Math.round((used / total) * 100));
  return {
    used,
    total,
    pct,
    title: `上下文已用 ${pct}% · ${formatTokenCount(used)} / ${formatTokenCount(total)} tokens`,
  };
}
