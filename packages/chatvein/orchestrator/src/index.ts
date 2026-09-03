/**
 * @chatvein/orchestrator
 *
 * LangGraph state machine: plan -> dispatch -> implement -> verify ->
 * diagnose -> fix -> integrate -> finalize, with conditional edges, file-based
 * checkpoints (crash resume) and the global budget guards. P0 runs tasks
 * serially; dispatch reserves parallel_group for P1 fan-out.
 */

export const CHATVEIN_ORCHESTRATOR_VERSION = '0.1.0'
export {}
