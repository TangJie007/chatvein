/**
 * L2 提示词：路由策略分类，不做对话意图、不回答用户问题。
 */
import type { RouteDecision } from '@chatvein/common'
import type { HeuristicCtx } from '../l1/features'

export const L2_SYSTEM_PROMPT = `你是 Chatvein 的路由分类器（L2），不是对话助手。
任务：根据用户消息与 L1 启发式结果，输出唯一一个 JSON 对象，判定执行策略。
禁止回答用户问题；禁止输出 Markdown；禁止 unknown。

JSON 字段（全部必填除非标注可选）：
- band: "trivial"|"simple"|"standard"|"complex"（禁止 unknown）
- tools: "none"|"full"（禁止 unknown；消化 L1 的 tools=unknown）
- modelTier: 可选 "weak"|"medium"|"strong"
- maxSteps: 可选 0–64 整数（simple≈8 / standard≈16 / complex≈64）
- memoryRecall: 可选 boolean
- allowSubAgents: 可选 boolean（Agent 可生子 Agent，不是拉群）
- hintUserCreateGroup: 可选 boolean（仅提示用户拉群，禁止自动建群）
- hintUserForge: 可选 boolean
- confident: boolean
- reason: 可选，≤40 字中文短因

分档直觉：
- trivial: 纯寒暄/确认，可无工具、宜短答
- simple: 短问答，通常无工具
- standard: 默认单 Agent 任务
- complex: 多步/对比/重工具，可 allowSubAgents

假阳性严控：可能改代码/查文件/跑命令 → tools 倾向 full；纯闲聊 → none。`

export function buildL2UserPrompt(ctx: HeuristicCtx, l1: RouteDecision): string {
  const facts = {
    charLen: ctx.charLen,
    lang: ctx.lang,
    hitGreetingOnly: ctx.hitGreetingOnly,
    hitSelfIntro: ctx.hitSelfIntro,
    hasCodeFence: ctx.hasCodeFence,
    hasPathLike: ctx.hasPathLike,
  }
  return [
    '## 用户消息',
    ctx.text.slice(0, 2000),
    '',
    '## L1 决策（供参考，请拍板）',
    JSON.stringify(
      {
        band: l1.band,
        confident: l1.confident,
        policy: l1.policy,
        reasons: l1.reasons.slice(0, 8),
        ruleIds: l1.ruleIds.slice(0, 12),
      },
      null,
      0,
    ),
    '',
    '## 关键特征',
    JSON.stringify(facts, null, 0),
    '',
    '请只输出一个 JSON 对象。',
  ].join('\n')
}
