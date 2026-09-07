/**
 * @chatvein/service
 *
 * Headless Node runner (a thin caller of @chatvein/core):
 *  - CLI: forge run / resume / preview (regression + sidecar in M2-7)
 *  - sidecar server (M2-7): stdio line-delimited JSON-RPC, spawned by the
 *    Electron app for crash isolation.
 *
 * 本包只做参数解析 / 进程通信 / 退出码，所有逻辑来自 @chatvein/core。
 */

export const CHATVEIN_SERVICE_VERSION = '0.1.0'

export { loadForgeConfig } from './config-loader'
