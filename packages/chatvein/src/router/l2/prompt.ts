/**
 * L2 Prompt：角色 → 词汇表 → 判别标准 → 历史摘要 → few-shot → 输出 schema。
 */
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { truncate } from 'es-toolkit/compat'
import type { Facts } from '../l1/types'
import { L2_FEW_SHOTS } from './fewshot'
import { summarizeHistory } from './history'
import type { L2Attachment, L2HistoryTurn } from './types'

const SYSTEM_PROMPT = `你是路由分类器，不是对话助手。对用户消息做一次结构化判断，输出唯一一个 JSON 对象，禁止 Markdown、禁止回答问题、禁止多余字段。

## 角色
把用户本轮输入翻译成「执行形态 + 领域 + 预算档 + 置信度」，供下游执行图使用。你不选具体工具，不规划步骤。

## 词汇表与判别标准

### lane（执行形态）
- direct：寒暄、概念问答、确认/澄清；单次回答、无需工具循环。
- agentic：需要短工具循环或单任务改动（查天气、修一个类型错误、解析一份 PDF）。
- orchestrated：多步骤/多文件/多产物、需规划或人工确认（跨模块重构、投标应答流水线）。

### domain（领域 / worker）
- general：通用能力（问答、检索、文档解析/抽取/转换、短工具链）。原 office 场景归此类。
- code：编写/修改/调试代码、跑测试或构建、工程改动。

### band（预算档）
拿不准就往高一档判（灰区抬档）：
- trivial：纯寒暄/确认，几乎不需推理。
- simple：单点知识问答/短检索，副作用少。
- standard：读文件/搜索/改一小处/短文档处理。
- complex：多文件多步骤、架构/迁移、长协作。

### 其他规则
- 灰区（拿不准）→ ambiguous=true，且 lane/band 抬一档，勿压成 direct。
- 缺关键信息（如文档任务未指明文件）→ 填 clarification.question（可带 options），lane 可暂为 direct、confidence 偏低。
- 多意图需串联（「查 X 并写进 Y」）→ orchestrated，并填 intents。
- rewritten：去指代、补全省略后的规范表述（给下游用，不是回复用户）。
- searchQuery：面向检索的精简串；无检索需求可省略。
- confidence：0~1；明确 ≥0.85，犹豫 0.6~0.85，很不确定 <0.6。
- reason：≤40 字中文短因。

## 输出 JSON Schema（字段必须齐全带 * 的）
{
  "lane": "direct|agentic|orchestrated",   // *
  "domain": "general|code",                // *
  "band": "trivial|simple|standard|complex", // *
  "confidence": 0.0~1.0,                   // *
  "ambiguous": boolean,
  "reason": string,                        // *
  "rewritten": string,                     // *
  "searchQuery": string?,
  "intents": string[]?,
  "clarification": { "question": string, "options"?: string[] }?
}`

/** 每类 2~3 条示范 → prompt 段落（L3 复用同一批示范） */
export function formatFewShots(): string {
  return L2_FEW_SHOTS.map((ex, i) => {
    const e = ex.expect
    return `${i + 1}. 输入「${ex.input}」→ lane=${e.lane}, domain=${e.domain}, band=${e.band}, confidence=${e.confidence}, rewritten="${e.rewritten}", reason="${e.reason}"`
  }).join('\n')
}

/** L1 结构特征 → prompt 段落（L3 复用同一份抽取视图） */
export function formatFacts(facts: Facts | undefined): string {
  if (!facts) return '（无）'
  return JSON.stringify({
    charLen: facts.charLen,
    code: {
      fence: facts.code.fence,
      pathWithLine: facts.code.pathWithLine.slice(0, 4),
      stackLike: facts.code.stackLike,
      errorLike: facts.code.errorLike,
    },
    files: {
      paths: facts.files.paths.slice(0, 6),
      extensions: facts.files.extensions.slice(0, 8),
      officeExt: facts.files.officeExt,
      codeExt: facts.files.codeExt,
      fromAttachments: facts.files.fromAttachments,
    },
    keywords: facts.keywords,
    utterance: facts.utterance,
    needsHistory: facts.needsHistory,
    social: facts.social,
  })
}

/** 附件 → prompt 段落（L3 复用） */
export function formatAttachments(attachments: L2Attachment[] | undefined): string {
  if (!attachments?.length) return '（无）'
  return attachments
    .slice(0, 8)
    .map((a) => `${a.name}${a.mime ? ` (${a.mime})` : ''}`)
    .join(', ')
}

export interface BuildL2MessagesOptions {
  text: string
  history?: L2HistoryTurn[]
  attachments?: L2Attachment[]
  facts?: Facts
}

/** 组装 L2 单次调用消息（system + user） */
export function buildL2Messages(options: BuildL2MessagesOptions): BaseMessage[] {
  const text = truncate(options.text.replace(/\s+/g, ' ').trim(), {
    length: 2000,
    omission: '…',
  })

  const user = [
    '## 历史摘要',
    summarizeHistory(options.history),
    '',
    '## 附件',
    formatAttachments(options.attachments),
    '',
    '## 结构特征（规则层已抽取，供参考）',
    formatFacts(options.facts),
    '',
    '## Few-shot（只示范判法，实际仍输出完整 JSON）',
    formatFewShots(),
    '',
    '## 用户消息',
    text || '（空）',
    '',
    '请输出唯一 JSON 对象。',
  ].join('\n')

  return [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(user)]
}

export { SYSTEM_PROMPT }
