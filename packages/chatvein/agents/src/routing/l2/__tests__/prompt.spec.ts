import { describe, expect, it } from 'vitest'
import { extractFacts } from '../../l1/features'
import {
  L2_SYSTEM_PROMPT,
  buildL2PromptVars,
  formatL2PromptMessages,
  l2ChatPromptTemplate,
} from '../prompt'

const session = {
  turnIndex: 0,
  lastAssistantHadTools: false,
  recentFailure: false,
  activeMode: 'chat' as const,
}

describe('L2 ChatPromptTemplate', () => {
  it('formatL2PromptMessages 产出 system + human，且含用户原文与 facts', async () => {
    const ctx = extractFacts('今天上海天气怎么样', session)
    const messages = await formatL2PromptMessages(ctx)
    expect(messages).toHaveLength(2)
    expect(messages[0]!.getType()).toBe('system')
    expect(messages[1]!.getType()).toBe('human')
    expect(String(messages[0]!.content)).toBe(L2_SYSTEM_PROMPT)
    expect(String(messages[0]!.content)).toContain('rewrittenQuery')
    expect(String(messages[1]!.content)).toContain('今天上海天气怎么样')
    expect(String(messages[1]!.content)).toContain('"charLen"')
    expect(String(messages[1]!.content)).toContain('请只输出一个 JSON 对象')
  })

  it('buildL2PromptVars 截断超长文本', () => {
    const long = '啊'.repeat(3000)
    const vars = buildL2PromptVars(extractFacts(long, session))
    expect(vars.text.length).toBe(2000)
  })

  it('l2ChatPromptTemplate.formatMessages 与 formatL2PromptMessages 一致', async () => {
    const ctx = extractFacts('闭包是什么', session)
    const viaHelper = await formatL2PromptMessages(ctx)
    const viaTemplate = await l2ChatPromptTemplate.formatMessages(buildL2PromptVars(ctx))
    expect(String(viaHelper[0]!.content)).toBe(String(viaTemplate[0]!.content))
    expect(String(viaHelper[1]!.content)).toBe(String(viaTemplate[1]!.content))
  })
})
