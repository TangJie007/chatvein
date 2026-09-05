/**
 * 弱模型摘要 prompt（与 L2 分类器同理：短、结构化、零寒暄）。
 * 只压缩，不新增信息；输出纯文本条目，便于逐字节稳定命中 prompt 缓存。
 */
import { compactText } from './digest'
import type { SummarizeInput } from './consolidate'

/** 喂给模型的单条消息字符上限（控制摘要调用本身的 token） */
export const SUMMARIZE_PER_MESSAGE_CHARS = 400

export interface SummarizePromptMessage {
  role: 'system' | 'user'
  content: string
}

const SYSTEM_PROMPT = [
  '你是会话记忆压缩器，负责把较早的对话压缩成可继续使用的简短记忆。',
  '规则：',
  '1. 只保留：用户目标与关键约束、已确认的事实与数字、做出的决定、待办与未解决问题、涉及的文件名/路径。',
  '2. 丢弃：寒暄、重复表述、推理过程、逐字原文、代码块全文（保留一句职责说明即可）。',
  '3. 不得新增任何对话中没出现的信息；不得输出标题、markdown 标题符号或说明性前后缀。',
  '4. 用中文紧凑条目输出，每行一条，形如「- 决定：xxx」「- 用户要求：xxx」。',
  '5. 已有摘要中的有效信息要保留并合并，不要简单追加重复项。',
].join('\n')

/** 组装摘要调用的两条消息（system + user） */
export function buildSummarizePrompt(input: SummarizeInput): SummarizePromptMessage[] {
  const rendered = input.messages
    .map((m) => {
      const label = m.role === 'user' ? '用户' : '助手'
      return `${label}：${compactText(m.content, SUMMARIZE_PER_MESSAGE_CHARS)}`
    })
    .join('\n')

  const prev = input.previousSummary?.trim()
  const user = [
    prev ? `【已有摘要】\n${prev}` : '【已有摘要】\n（无，这是首次压缩）',
    '',
    '【新增对话（按时间序）】',
    rendered,
    '',
    `请输出合并后的新摘要，纯文本条目，不超过 ${input.maxChars} 字。`,
  ].join('\n')

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}
