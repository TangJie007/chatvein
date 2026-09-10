/**
 * L1 规则判决：高置信定案，否则 pass。
 * 对齐：寒暄→direct；代码→agentic·code；文档/短工具→agentic·general；多步骤→orchestrated。
 * Domain 仅 general | code（原 office 归 general）。
 */
import { DEFAULT_BAND } from '../constants'
import type { Band, Domain, Lane } from '../types'
import { hasStrongCodeSignal } from './facts/code'
import type { Facts, L1Decision, L1Pass, L1Result } from './types'

const ACCEPT = 0.85

function decide(
  partial: Omit<L1Decision, 'kind' | 'decidedBy' | 'ambiguous' | 'needsHistory'> & {
    ambiguous?: boolean
    needsHistory?: boolean
  },
  facts: Facts,
): L1Decision {
  const { ambiguous, needsHistory, ...rest } = partial
  return {
    kind: 'decide',
    decidedBy: 'rule',
    ambiguous: ambiguous ?? false,
    needsHistory: needsHistory ?? facts.needsHistory,
    ...rest,
  }
}

function bandFor(lane: Lane, override?: Band): Band {
  return override ?? DEFAULT_BAND[lane]
}

/** 仅 general | code；文档信号不再产出 office domain */
function pickDomain(facts: Facts): Domain {
  const codeScore =
    (hasStrongCodeSignal(facts.code) ? 2 : 0) +
    (facts.files.codeExt ? 2 : 0) +
    facts.keywords.code.length
  return codeScore > 0 ? 'code' : 'general'
}

function docMissingFile(facts: Facts): boolean {
  return (
    facts.keywords.office.length > 0 &&
    !facts.files.officeExt &&
    facts.files.paths.length === 0 &&
    !facts.files.fromAttachments
  )
}

/**
 * 纯规则判决。
 * - `decide`：置信足够，可跳过 L2
 * - `pass`：交 L2
 */
export function decideL1(facts: Facts, acceptThreshold = ACCEPT): L1Result {
  const rewritten = facts.textNorm
  const slots: Record<string, unknown> = {}
  if (facts.files.paths.length) slots.paths = facts.files.paths
  if (facts.code.pathWithLine.length) slots.codeRefs = facts.code.pathWithLine
  if (facts.files.extensions.length) slots.extensions = facts.files.extensions

  if (facts.social.greetingOnly || facts.social.selfIntro) {
    return decide(
      {
        lane: 'direct',
        domain: 'general',
        band: 'trivial',
        confidence: 0.95,
        query: { rewritten },
        reason: facts.social.selfIntro ? 'self-intro' : 'greeting',
      },
      facts,
    )
  }

  if (facts.charLen === 0) {
    return decide(
      {
        lane: 'direct',
        domain: 'general',
        band: 'trivial',
        confidence: 1,
        query: { rewritten: '' },
        reason: 'empty',
      },
      facts,
    )
  }

  const domain = pickDomain(facts)
  const strongCode = hasStrongCodeSignal(facts.code) || facts.files.codeExt
  const strongDoc =
    facts.files.officeExt ||
    (facts.keywords.office.length >= 2 &&
      (facts.files.paths.length > 0 || facts.files.fromAttachments))
  const multiStep = facts.utterance.multiStep || facts.keywords.multiStep.length >= 2
  const multiFiles = facts.files.paths.length >= 3

  if (docMissingFile(facts) && facts.keywords.office.length > 0) {
    return decide(
      {
        lane: 'direct',
        domain: 'general',
        band: 'trivial',
        confidence: 0.9,
        query: { rewritten },
        reason: 'doc-missing-file',
        clarification: { question: '你希望我处理哪个文件？' },
      },
      facts,
    )
  }

  if ((multiStep || multiFiles) && (strongCode || strongDoc || domain === 'code')) {
    const lane: Lane = 'orchestrated'
    const resolvedDomain: Domain = strongCode || domain === 'code' ? 'code' : 'general'
    return decide(
      {
        lane,
        domain: resolvedDomain,
        band: bandFor(lane),
        confidence: 0.88,
        query: {
          rewritten,
          slots,
          intents: facts.keywords.multiStep.slice(0, 4),
        },
        reason: multiFiles ? 'multi-file' : 'multi-step',
      },
      facts,
    )
  }

  if (strongCode) {
    const lane: Lane = multiStep || multiFiles ? 'orchestrated' : 'agentic'
    return decide(
      {
        lane,
        domain: 'code',
        band: bandFor(lane),
        confidence: 0.9,
        query: { rewritten, slots },
        reason: 'code-signal',
      },
      facts,
    )
  }

  if (strongDoc || (facts.files.officeExt && facts.utterance.isImperative)) {
    const lane: Lane = multiStep || multiFiles ? 'orchestrated' : 'agentic'
    return decide(
      {
        lane,
        domain: 'general',
        band: bandFor(lane),
        confidence: 0.9,
        query: { rewritten, slots },
        reason: 'doc-signal',
      },
      facts,
    )
  }

  if (facts.keywords.code.length >= 1 && facts.utterance.isImperative) {
    if (0.82 >= acceptThreshold) {
      return decide(
        {
          lane: 'agentic',
          domain: 'code',
          band: bandFor('agentic'),
          confidence: 0.82,
          ambiguous: true,
          query: { rewritten, slots },
          reason: 'code-keyword-imperative',
        },
        facts,
      )
    }
    return pass(facts, 'code-keyword-weak')
  }

  if (facts.keywords.office.length >= 1 && facts.utterance.isImperative) {
    return pass(facts, 'doc-keyword-weak')
  }

  if (
    facts.utterance.isQuestion &&
    facts.charLen <= 40 &&
    domain === 'general' &&
    !strongCode
  ) {
    return decide(
      {
        lane: 'direct',
        domain: 'general',
        band: 'simple',
        confidence: 0.86,
        query: { rewritten },
        reason: 'short-question',
      },
      facts,
    )
  }

  if (facts.needsHistory && domain === 'general') {
    return pass(facts, 'anaphora-needs-l2')
  }

  return pass(facts, 'ambiguous')
}

function pass(facts: Facts, reason: string): L1Pass {
  return { kind: 'pass', facts, reason }
}
