/**
 * @chatvein/memory
 *
 * Layered memory for personal / group / global scopes (CP2).
 * See docs/design/03-记忆方案.md（长期记忆）与 docs/design/14-短期记忆方案.md（短期记忆）。
 *
 * 已落地：**短期记忆（会话内工作记忆）**——近因窗口 + 滚动摘要 + token 预算，
 * 纯逻辑、零 IO：落盘与模型调用由调用方（app ChatService）注入。
 */

export const CHATVEIN_MEMORY_VERSION = '0.1.0'

export * from './short-term'
