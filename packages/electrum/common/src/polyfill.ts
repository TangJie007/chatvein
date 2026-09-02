// Must run before any decorator evaluation
;(Symbol as { metadata?: symbol }).metadata ??= Symbol.for('Symbol.metadata')

export const METADATA_READY = true
