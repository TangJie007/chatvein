/**
 * 指令形态：疑问 / 祈使 / 多步骤。
 */

export interface UtteranceFacts {
  isQuestion: boolean
  isImperative: boolean
  multiStep: boolean
}

const QUESTION_RE =
  /[？?]|^(?:什么|怎么|如何|为何|为什么|哪|谁|吗|么|是否|可否|能不能|可不可以)|(?:吗|呢|么)\s*$/i

const IMPERATIVE_RE =
  /^(?:请|帮我|帮|麻烦|给我|把|将|实现|修复|修改|改|写|生成|创建|删除|导出|转换|解析|抽取|重构|跑|执行)/

export function extractUtteranceFacts(
  text: string,
  multiStepKeywordHits: number,
): UtteranceFacts {
  const t = text.trim()
  const isQuestion = QUESTION_RE.test(t)
  const isImperative = !isQuestion && IMPERATIVE_RE.test(t)
  return {
    isQuestion,
    isImperative,
    multiStep: multiStepKeywordHits >= 2 || /[，,].{0,12}(?:然后|并且|接着|再|同时)/.test(t),
  }
}
