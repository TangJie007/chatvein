/**
 * @chatvein/context
 *
 * Context and token budget management: head/tail truncation with folded middle,
 * error-frame extraction (stack / failed case / assertion diff only), per-task
 * history summarization, a file index (path + summary + signatures) and the
 * global BudgetGuard (token / step / wall-clock / consecutive-failure circuit
 * breakers).
 *
 * 已落地：token 估算（tokens.ts）+ 头尾折叠截断（truncate.ts）。
 * 短期记忆的窗口/预算直接复用这两项，见 @chatvein/memory。
 */

export const CHATVEIN_CONTEXT_VERSION = '0.1.0'

export {
  TOKENS_PER_MESSAGE,
  estimateTextTokens,
  estimateMessagesTokens,
  tokensToChars,
} from './tokens'

export { truncateFolded, type TruncateOptions, type TruncateResult } from './truncate'
