/**
 * 超时 + 外部取消联动的 AbortSignal。
 *
 * Node 内置即可：
 * - `AbortSignal.timeout(ms)` 超时 abort（定时器 unref，不挂进程）
 * - `AbortSignal.any([...])` 合并外部 signal 与超时
 *
 * 要求 Node >= 20.3；本仓库 engines 为 node >= 22.12。
 */
export function withTimeoutSignal(timeoutMs: number, outer?: AbortSignal): AbortSignal {
  const timed = AbortSignal.timeout(timeoutMs)
  return outer ? AbortSignal.any([outer, timed]) : timed
}
