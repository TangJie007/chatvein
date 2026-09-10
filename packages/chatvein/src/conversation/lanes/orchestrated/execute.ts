/**
 * orchestrated · execute：复用 agentic 已编译 worker 子图。
 * 禁止复制流水线。
 */
export async function executeNode(): Promise<never> {
  throw new Error('conversation/lanes/orchestrated/execute: not implemented')
}
