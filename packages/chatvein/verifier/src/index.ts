/**
 * @chatvein/verifier
 *
 * Verification loop: build/test/lint execution inside the sandbox and parsing
 * into structured TestReport (failed case name + assertion + stack keyframes).
 * Hard rule: "done" is only ever established by this structured verify output,
 * never by a model self-report. Also hosts failure attribution and the
 * submission checklist.
 */

export const CHATVEIN_VERIFIER_VERSION = '0.1.0'
export {}
