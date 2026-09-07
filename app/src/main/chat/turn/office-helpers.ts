import type { RouteDecision } from '@chatvein/common'
import { isTelemetryEnabled } from '@chatvein/observability'
import type { LlmSelectToolsStatus } from '@chatvein/tools'

/**
 * 按路由给主模型追加回答约束（仅 LLM 路径；L1 本地短路不会走到这里）。
 * - band=trivial（含 L2 拍板）：友好简短寒暄式回复
 * - modelTier=weak：一两句、不列清单
 */
const TRIVIAL_BAND_BRIEF =
  '（路由：闲聊/寒暄档）请友好、简短地回复一两句，像正常打招呼或确认；不要列能力清单，不要长篇展开。'
const WEAK_TIER_BRIEF = '（路由：简短档）请用一两句回复，不要列清单。'

/**
 * 编程开发模式：把项目根与工作约定注入 system，引导 Agent 用文件/执行工具
 * 在真实仓库内读改代码，而不是在空沙箱里凭空作答。
 */
export function withCodingContext(prompt: string | undefined, projectRoot: string): string | undefined {
  if (!projectRoot) return prompt
  const block = [
    '【编程开发模式】',
    `当前项目根目录：${projectRoot}（文件读写、脚本执行工具均被限制在此目录内）。`,
    '工作约定：',
    '1. 改代码前先用文件工具读取相关文件、确认现状，不要臆造路径或 API；',
    '2. 优先做最小必要修改，改动后说明涉及的文件与关键行；',
    '3. 需要运行 / 验证时，用脚本执行工具在项目内跑（如测试、构建），并反馈结果；',
    '4. 涉及删除、覆盖、安装依赖等有副作用的操作，先说明再执行。',
  ].join('\n')
  const base = prompt?.trim()
  return base ? `${base}\n\n${block}` : block
}

export function systemPromptForRoute(
  agentPrompt: string | undefined,
  route: RouteDecision,
): string | undefined {
  const base = agentPrompt?.trim() || ''
  const extras: string[] = []
  if (route.band === 'trivial') {
    extras.push(TRIVIAL_BAND_BRIEF)
  } else if (route.policy.modelTier === 'weak') {
    extras.push(WEAK_TIER_BRIEF)
  }
  if (extras.length === 0) return base || undefined
  if (!base) return extras.join('\n')
  return `${base}\n\n${extras.join('\n')}`
}

/** maxSteps=0 时的本地礼貌回复；开发环境追加「· 命中L1本地短路」便于验证 */
export function localReplyForRoute(route: RouteDecision, userText: string): string {
  let text: string
  if (route.reasons.includes('self_intro')) {
    text = '好的，记住了。有什么我可以帮你的吗？'
  } else if (route.reasons.includes('greeting_only') || route.band === 'trivial') {
    text = '你好！有什么我可以帮你的吗？'
  } else {
    text = `好的，已收到。需要我继续帮你处理「${truncateTitle(userText)}」相关的事吗？`
  }
  if (isTelemetryEnabled()) {
    text = `${text} · 命中L1本地短路`
  }
  return text
}

/** 按档微调温度，便于验证 tier 已生效（无多模型表时的弱替代） */
export function temperatureForTier(
  tier: RouteDecision['policy']['modelTier'],
  base: number,
): number {
  if (tier === 'weak') return Math.min(1, base + 0.1)
  if (tier === 'strong') return Math.max(0, base - 0.1)
  return base
}

export function truncateTitle(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= 28 ? one : `${one.slice(0, 28)}…`
}

export function friendlyReplyFailure(reason: string): string {
  return `抱歉，这次没能完成回复。\n\n原因：${reason}\n\n你可以点击「重试」，或稍后再试。`
}

export function formatAgentError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/abort|timeout/i.test(msg)) return '模型调用超时'
  if (/401|unauthorized|invalid.*key/i.test(msg)) return '鉴权失败：API Key 无效'
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) {
    return `无法连接模型：${msg}`
  }
  return `对话失败：${msg.slice(0, 200)}`
}

export function formatRouteThinking(route: RouteDecision): string {
  const hints: string[] = []
  if (route.policy.hintUserCreateGroup) hints.push('可提示用户拉群')
  if (route.policy.hintUserForge) hints.push('可提示派 Forge')
  if (route.policy.allowSubAgents) hints.push('允许子 Agent')
  const hintStr = hints.length ? `；${hints.join('、')}` : ''
  const l2 = route.reasons.includes('l2_classifier')
    ? route.reasons.includes('l2_structured')
      ? '；已过 L2(structured)'
      : route.reasons.includes('l2_text')
        ? '；已过 L2(text)'
        : '；已过 L2'
    : route.reasons.includes('l2_failed') || route.reasons.includes('l2_timeout')
      ? '；L2 失败保留 L1'
      : ''
  const rewrite = route.rewrittenQuery
    ? `；改写=${route.rewrittenQuery.slice(0, 80)}${route.rewrittenQuery.length > 80 ? '…' : ''}`
    : ''
  return `路由 L1/L2：band=${route.band} score=${route.score} tier=${route.policy.modelTier} tools=${route.policy.tools} maxSteps=${route.policy.maxSteps}（${route.reasons.slice(0, 6).join(', ') || '—'}）${hintStr}${l2}${rewrite}\n`
}

export function formatPolicyApply(route: RouteDecision): string {
  const p = route.policy
  const lines = [
    `应用 policy：tier=${p.modelTier}（一期仍用 Agent 绑定模型）`,
    `tools=${p.tools}${p.tools === 'full' ? ' → 绑定 @chatvein/tools 目录' : ' → 禁用工具'}`,
    `maxSteps=${p.maxSteps}${p.maxSteps <= 0 ? ' → 将本地短路' : ` → recursionLimit=${Math.max(1, p.maxSteps)}`}`,
  ]
  if (
    route.band === 'trivial' &&
    !(p.maxSteps <= 0 && (route.reasons.includes('greeting_only') || route.reasons.includes('self_intro')))
  ) {
    lines.push('trivial → 主模型友好短答（POLICY_TRIVIAL_SHORT，默认 maxSteps=4）')
  } else if (
    p.modelTier === 'weak' &&
    !(p.maxSteps <= 0 && (route.reasons.includes('greeting_only') || route.reasons.includes('self_intro')))
  ) {
    lines.push('weak → 注入短回复约束（一两句，不列清单）')
  }
  if (p.maxSteps <= 0 && !(route.reasons.includes('greeting_only') || route.reasons.includes('self_intro'))) {
    lines.push('maxSteps=0 但非 L1 寒暄/自我介绍 → 仍调 LLM（recursionLimit≥1）')
  }
  if (p.hintUserCreateGroup) lines.push('hint：提示用户拉群（不自动建群）')
  if (p.hintUserForge) lines.push('hint：提示用户派 Forge（不自动派单）')
  if (p.allowSubAgents) lines.push('allowSubAgents=true（子 Agent 能力待接）')
  return `${lines.join('\n')}\n`
}

/** 工具选用埋点 selector：反映真实 C1/C2 路径 */
export function formatToolSelectorLabel(
  c1: 'hybrid' | 'keyword' | 'full',
  c2: LlmSelectToolsStatus | 'skipped',
): string {
  const c2Part =
    c2 === 'skipped'
      ? 'none'
      : c2 === 'selected_structured'
        ? 'c2'
        : c2 === 'selected_text'
          ? 'c2text'
          : c2 === 'passthrough_small'
            ? 'c2skip'
            : `c2fallback:${c2}`
  return `${c1}+${c2Part}`
}
