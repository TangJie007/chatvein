/**
 * L1 事实抽取入口：聚合各信号模块。
 */
import { normalizeText } from '../../normalize'
import { hasAnaphora } from '../../signals/anaphora'
import { extractCodeFacts } from './code'
import { extractFileFacts } from './files'
import { extractKeywordFacts } from './keywords'
import { isGreetingOnly, isSelfIntro } from './social'
import { extractUtteranceFacts } from './utterance'
import type { Facts, L1Input } from '../types'

export function extractFacts(input: L1Input | string): Facts {
  const raw = typeof input === 'string' ? input : input.text
  const attachments = typeof input === 'string' ? undefined : input.attachments
  const textNorm = normalizeText(raw)
  const code = extractCodeFacts(textNorm)
  const files = extractFileFacts(textNorm, attachments)
  const keywords = extractKeywordFacts(textNorm)
  const utterance = extractUtteranceFacts(textNorm, keywords.multiStep.length)
  const social = {
    greetingOnly: textNorm.length <= 30 && isGreetingOnly(textNorm),
    selfIntro: textNorm.length <= 30 && isSelfIntro(textNorm),
  }

  return {
    textNorm,
    charLen: [...textNorm].length,
    code,
    files,
    keywords,
    utterance: {
      ...utterance,
      multiStep: utterance.multiStep || keywords.multiStep.length >= 2,
    },
    needsHistory: hasAnaphora(textNorm),
    social,
  }
}
