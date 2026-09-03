/**
 * @chatvein/service
 *
 * Headless Node runner (a thin caller of @chatvein/core):
 *  - sidecar server: stdio line-delimited JSON-RPC (start/pause/abort/
 *    intervene/resume/loadRun) with a streaming event channel, spawned by the
 *    Electron app for crash isolation;
 *  - programmatic entry points reused by the forge CLI.
 */

export const CHATVEIN_SERVICE_VERSION = '0.1.0'
export {}
