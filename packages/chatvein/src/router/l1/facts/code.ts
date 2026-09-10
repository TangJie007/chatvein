/**
 * 代码相关信号：围栏、反引号、path:line、堆栈、报错文本。
 */

const FENCE_RE = /```[\s\S]*?```/g
const INLINE_TICK_RE = /`[^`\n]+`/g
const PATH_LINE_RE =
  /\b[\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|cs|cpp|h|vue|svelte|json|md)(?::\d+(?::\d+)?)?\b/gi
const STACK_LINE_RE = /^\s*at\s+\S+/m
const ERROR_NAME_RE = /(?:Error|Exception|TypeError|ReferenceError|SyntaxError)\s*:/
const ERROR_WORD_RE =
  /(?:error|exception|traceback|panic|undefined is not|cannot find module|类型报错|编译失败|报错|堆栈)/i

export interface CodeFacts {
  fence: boolean
  inlineTicks: number
  pathWithLine: string[]
  stackLike: boolean
  errorLike: boolean
}

export function extractCodeFacts(text: string): CodeFacts {
  const fences = text.match(FENCE_RE)
  const ticks = text.match(INLINE_TICK_RE)
  const pathWithLine = [...new Set([...text.matchAll(PATH_LINE_RE)].map((m) => m[0]))]
  const stackLike = STACK_LINE_RE.test(text) || ERROR_NAME_RE.test(text)
  return {
    fence: (fences?.length ?? 0) > 0,
    inlineTicks: ticks?.length ?? 0,
    pathWithLine,
    stackLike,
    errorLike: stackLike || ERROR_WORD_RE.test(text),
  }
}

export function hasStrongCodeSignal(c: CodeFacts): boolean {
  return (
    c.fence ||
    c.stackLike ||
    c.pathWithLine.length > 0 ||
    c.inlineTicks >= 2 ||
    c.errorLike
  )
}
