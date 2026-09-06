import { resolve, normalize, sep } from 'node:path'
import { estimateTextTokens, truncateFolded } from '@chatvein/context'

/** 将相对/绝对路径限制在 root 内；越界抛错 */
export function resolveInWorkspace(root: string, relativeOrAbsolute: string): string {
  const rootAbs = resolve(root)
  const candidate = resolve(rootAbs, relativeOrAbsolute)
  const normRoot = normalize(rootAbs + sep)
  const normCand = normalize(candidate)
  if (normCand !== rootAbs && !normCand.startsWith(normRoot)) {
    throw new Error(`路径越出工作区: ${relativeOrAbsolute}`)
  }
  return candidate
}

/**
 * 工具输出截断（PRD 5.3.5）：超 `maxChars` 时升级为「头尾保留 + 中间折叠」，
 * 复用 @chatvein/context 的 `truncateFolded`，比旧版「硬切头部、丢尾」更保真
 * （保留上下文头部与结论/错误尾部）。未超阈值时原样返回，故对短输出零影响、
 * 不改回复行为。
 */
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const maxTokens = estimateTextTokens(text.slice(0, maxChars))
  return truncateFolded(text, maxTokens).text
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: timeout after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
