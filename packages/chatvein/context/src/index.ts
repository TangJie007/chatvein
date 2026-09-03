/**
 * @chatvein/context
 *
 * Context and token budget management: head/tail truncation with folded middle,
 * error-frame extraction (stack / failed case / assertion diff only), per-task
 * history summarization, a file index (path + summary + signatures) and the
 * global BudgetGuard (token / step / wall-clock / consecutive-failure circuit
 * breakers).
 */

export const CHATVEIN_CONTEXT_VERSION = '0.1.0'
export {}
