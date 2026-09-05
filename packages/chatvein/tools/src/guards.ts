import { resolve, normalize, sep } from 'node:path'

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

export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars]`
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
