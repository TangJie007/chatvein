/**
 * L2 提示词：策略拍板 + 工具向语义改写。
 * 唯一入口：`l2ChatPromptTemplate` / `formatL2PromptMessages`。
 */
import { ChatPromptTemplate } from '@langchain/core/prompts'
import type { BaseMessage } from '@langchain/core/messages'
import type { RouteDecision } from '@chatvein/common'
import type { HeuristicCtx } from '../l1/features'

/** System 正文（静态）；写入模板前转义 `{`/`}`，避免被当成 f-string 变量 */
export const L2_SYSTEM_PROMPT = `你是 Chatvein 的 L2 路由分类器，不是对话助手。
上游 L1 已过滤纯寒暄/自我介绍/本地命令；你只处理需要策略判断的用户消息。
输出唯一一个 JSON 对象。禁止回答用户问题；禁止 Markdown；禁止 band/tools 为 unknown。

## 必填字段
- band: "trivial"|"simple"|"standard"|"complex"
- tools: "none"|"full"
- confident: boolean
- rewrittenQuery: string（1～400 字）——面向工具路由的语义改写，见下
- reason: 可选，≤40 字中文短因

## 可选字段（省略则按 band 默认策略）
- modelTier: "weak"|"medium"|"strong"
- maxSteps: 0–64（默认 trivial≈4 / simple≈8 / standard≈16 / complex≈64；L1 本地短路仍为 0）
- memoryRecall: boolean
- allowSubAgents: boolean（子 Agent ≠ 拉群）
- hintUserCreateGroup / hintUserForge: boolean（仅提示 UI，禁止自动建群/派单）

## band 复杂度（从严，假阴性优于假阳性）
- trivial：仍像闲聊/确认、几乎不需推理（少见；L1 已截大半）。tools 通常 none。
- simple：单点知识问答、概念解释、短计算口算、无需读仓库/联网也能答。tools=none 为主；仅当明确要查实时信息才 full。
- standard：默认档。需要读文件、搜索、跑命令、改一小处代码、查天气/网页、写一段可落地内容。tools=full；maxSteps≈16。
- complex：多文件/多步骤、对比选型、架构设计、大范围重构、并行子任务、长链路调试。tools=full；可 allowSubAgents；maxSteps≈64；modelTier 倾向 strong。

判定线索：
- 有路径、代码围栏、明确「搜索/打开/修改/运行」→ 至少 standard + tools=full
- 「解释一下 XX 原理」且无仓库上下文 → simple + tools=none
- 「帮我把 A 和 B 做选型权衡并给方案」→ complex
- 不确定是否要工具 → tools=full（宁可多给，勿漏工具）

## rewrittenQuery（关键）
把用户口语改写成「给工具检索器用的语义描述」，不是复述原文，也不是回复用户。
要求：
1. 中文为主；可夹必要英文符号/API 名
2. 显式写出可能需要的能力与对象：如 读文件、搜索网页、计算、改代码、列目录、查天气
3. 补全省略主语/宾语；去掉语气词与寒暄
4. 一两句即可，勿写成执行计划清单
5. 即使用户只要闲聊解释（tools=none），也改写成清晰的问题陈述，便于日后检索

示例：
- 用户「看看 src 里路由怎么写的」→ rewrittenQuery「读取项目 src 目录下路由相关源码并说明实现」
- 用户「今天惠阳天气」→ rewrittenQuery「查询广东省惠阳今日天气预报」
- 用户「闭包是什么」→ rewrittenQuery「解释编程语言中的闭包概念与用途」
- 用户「Redis 和 Memcached 怎么选」→ rewrittenQuery「对比 Redis 与 Memcached 的选型差异并给出适用场景建议」`

const L2_USER_TEMPLATE = `## 用户消息
{text}

## 结构特征
{facts}

请只输出一个 JSON 对象（含 band、tools、confident、rewrittenQuery）。`

function escapePromptTemplateLiterals(text: string): string {
  return text.replace(/\{/g, '{{').replace(/\}/g, '}}')
}

/** L2 ChatPromptTemplate：system 固定 + human `{text}`/`{facts}` */
export const l2ChatPromptTemplate = ChatPromptTemplate.fromMessages([
  ['system', escapePromptTemplateLiterals(L2_SYSTEM_PROMPT)],
  ['human', L2_USER_TEMPLATE],
])

export type L2PromptVars = {
  text: string
  facts: string
}

/** 从 HeuristicCtx 抽出模板变量 */
export function buildL2PromptVars(ctx: HeuristicCtx, _l1?: RouteDecision): L2PromptVars {
  return {
    text: ctx.text.slice(0, 2000),
    facts: JSON.stringify({
      charLen: ctx.charLen,
      lang: ctx.lang,
      hasCodeFence: ctx.hasCodeFence,
      hasPathLike: ctx.hasPathLike,
      hasUrl: ctx.hasUrl,
    }),
  }
}

/** 格式化为 LangChain messages（L2 唯一 prompt 出口） */
export function formatL2PromptMessages(
  ctx: HeuristicCtx,
  l1?: RouteDecision,
): Promise<BaseMessage[]> {
  return l2ChatPromptTemplate.formatMessages(buildL2PromptVars(ctx, l1))
}
