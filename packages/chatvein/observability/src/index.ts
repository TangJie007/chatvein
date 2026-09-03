/**
 * @chatvein/observability
 *
 * Trace event bus + persistence: RunEvent fan-out to JSONL append log, UI stream
 * and budget aggregation; large payloads are sharded to runs/<id>/payloads/ with
 * only a payload_ref kept in context; run report.md generation. Optionally
 * indexes trace/events into an embedded PGlite instance for SQL queries.
 */

export const CHATVEIN_OBSERVABILITY_VERSION = '0.1.0'
export {}
