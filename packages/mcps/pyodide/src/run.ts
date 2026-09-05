/**
 * Pyodide 运行时：懒加载单例 + 工作区脚本 / 内联执行。
 */
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { resolveInWorkspace } from './paths'

const requireFromHere = createRequire(
  typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url),
)

const SCRIPT_EXTS = new Set(['.py'])

export interface RunPyResult {
  ok: boolean
  result?: string
  stdout?: string
  error?: string
  durationMs: number
  truncated: boolean
  script?: string
}

export interface RunPyOptions {
  code: string
  timeoutMs?: number
  maxOutputChars?: number
  meta?: Record<string, string>
}

type PyodideInterface = Awaited<ReturnType<typeof import('pyodide').loadPyodide>>

let pyodidePromise: Promise<PyodideInterface> | null = null
let stdoutBuf: string[] = []
let stderrBuf: string[] = []

/** Node 下 indexURL 必须是目录路径（不要 file://） */
function resolvePyodideIndexURL(): string {
  const pkgJson = requireFromHere.resolve('pyodide/package.json')
  return dirname(pkgJson).replace(/\\/g, '/')
}

export async function getPyodide(): Promise<PyodideInterface> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      const { loadPyodide } = await import('pyodide')
      stdoutBuf = []
      stderrBuf = []
      return loadPyodide({
        indexURL: resolvePyodideIndexURL(),
        stdout: (s) => {
          stdoutBuf.push(String(s))
        },
        stderr: (s) => {
          stderrBuf.push(String(s))
        },
      })
    })()
  }
  return pyodidePromise
}

/** 测试用：重置单例 */
export function resetPyodideForTests(): void {
  pyodidePromise = null
  stdoutBuf = []
  stderrBuf = []
}

function stringifyResult(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  if (value === undefined || value === null) {
    return { text: String(value), truncated: false }
  }
  let text: string
  try {
    if (typeof value === 'string') text = value
    else if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
      text = String(value)
    } else {
      // PyProxy → toJs if available
      const maybe = value as { toJs?: () => unknown; toString?: () => string }
      if (typeof maybe.toJs === 'function') {
        text = JSON.stringify(maybe.toJs(), null, 2) ?? String(value)
      } else {
        text = JSON.stringify(value, null, 2) ?? String(value)
      }
    }
  } catch {
    text = String(value)
  }
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: `${text.slice(0, maxChars)}…`, truncated: true }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} 超时（${timeoutMs}ms）`))
    }, timeoutMs)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

export async function runPyInPyodide(options: RunPyOptions): Promise<RunPyResult> {
  const code = options.code.trim()
  if (!code) {
    return { ok: false, error: 'code 不能为空', durationMs: 0, truncated: false }
  }
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 15_000, 100), 120_000)
  const maxOutputChars = Math.min(Math.max(options.maxOutputChars ?? 8_000, 256), 64_000)
  const started = Date.now()

  try {
    const py = await withTimeout(getPyodide(), Math.min(timeoutMs, 60_000), 'loadPyodide')
    stdoutBuf = []
    stderrBuf = []
    const value = await withTimeout(py.runPythonAsync(code), timeoutMs, 'runPython')
    const { text, truncated } = stringifyResult(value, maxOutputChars)
    const stdout = stdoutBuf.join('\n').slice(0, maxOutputChars)
    return {
      ok: true,
      result: text,
      stdout: stdout || undefined,
      durationMs: Date.now() - started,
      truncated,
      script: options.meta?.relativePath,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const stderr = stderrBuf.join('\n')
    const combined = stderr ? `${message}\n${stderr}` : message
    return {
      ok: false,
      error: combined.slice(0, maxOutputChars),
      stdout: stdoutBuf.join('\n').slice(0, maxOutputChars) || undefined,
      durationMs: Date.now() - started,
      truncated: combined.length > maxOutputChars,
      script: options.meta?.relativePath,
    }
  }
}

export interface RunWorkspaceScriptOptions {
  workspaceRoot: string
  path: string
  scriptsOnly?: boolean
  timeoutMs?: number
  maxOutputChars?: number
  maxScriptBytes?: number
}

export async function runWorkspaceScript(
  options: RunWorkspaceScriptOptions,
): Promise<RunPyResult> {
  const root = options.workspaceRoot.trim()
  if (!root) {
    return { ok: false, error: 'workspaceRoot 不能为空', durationMs: 0, truncated: false }
  }

  let abs: string
  try {
    abs = resolveInWorkspace(root, options.path)
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: 0,
      truncated: false,
    }
  }

  const rel = relative(root, abs).replace(/\\/g, '/')
  const scriptsOnly = options.scriptsOnly !== false
  if (scriptsOnly) {
    const underScripts = rel === 'scripts' || rel.startsWith('scripts/')
    if (!underScripts) {
      return {
        ok: false,
        error: `仅允许执行工作区 scripts/ 下的脚本：${rel}`,
        durationMs: 0,
        truncated: false,
        script: rel,
      }
    }
  }

  const ext = extname(abs).toLowerCase()
  if (!SCRIPT_EXTS.has(ext)) {
    return {
      ok: false,
      error: `不支持的脚本扩展名：${ext || '(无)'}（允许 .py）`,
      durationMs: 0,
      truncated: false,
      script: rel,
    }
  }

  const maxBytes = options.maxScriptBytes ?? 256 * 1024
  let code: string
  try {
    const st = await fs.stat(abs)
    if (!st.isFile()) {
      return {
        ok: false,
        error: `不是文件：${rel}`,
        durationMs: 0,
        truncated: false,
        script: rel,
      }
    }
    if (st.size > maxBytes) {
      return {
        ok: false,
        error: `脚本过大（>${maxBytes} bytes）：${rel}`,
        durationMs: 0,
        truncated: false,
        script: rel,
      }
    }
    code = await fs.readFile(abs, 'utf8')
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: 0,
      truncated: false,
      script: rel,
    }
  }

  return runPyInPyodide({
    code,
    timeoutMs: options.timeoutMs,
    maxOutputChars: options.maxOutputChars,
    meta: {
      relativePath: rel,
      fileName: basename(abs),
      dir: dirname(rel),
    },
  })
}

export async function listWorkspaceScripts(
  workspaceRoot: string,
  subdir = 'scripts',
): Promise<{ root: string; scripts: string[]; error?: string }> {
  const root = workspaceRoot.trim()
  if (!root) return { root: '', scripts: [], error: 'workspaceRoot 不能为空' }

  let dirAbs: string
  try {
    dirAbs = resolveInWorkspace(root, subdir)
  } catch (err) {
    return {
      root,
      scripts: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        await walk(full)
      } else if (ent.isFile() && SCRIPT_EXTS.has(extname(ent.name).toLowerCase())) {
        out.push(relative(root, full).replace(/\\/g, '/'))
      }
    }
  }

  try {
    const st = await fs.stat(dirAbs)
    if (!st.isDirectory()) {
      return { root, scripts: [], error: `${subdir} 不是目录` }
    }
  } catch {
    return { root, scripts: [], error: `目录不存在：${subdir}（可先用 filesystem 创建）` }
  }

  await walk(dirAbs)
  out.sort()
  return { root, scripts: out }
}

export function runPyResultToText(result: RunPyResult): string {
  return JSON.stringify(result, null, 2)
}
