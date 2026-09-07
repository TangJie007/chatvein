/**
 * vm2 执行工作区绑定的 Node 脚本。
 *
 * - 工作区脚本：NodeVM + require（仅工作区 node_modules；builtin 白名单）
 * - 内联 run_js：纯 VM，无 require
 * - 包安装：见 install.ts（信任校验后再 npm --ignore-scripts）
 */

import { createRequire } from 'node:module'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveInWorkspace } from './paths'
import { SAFE_NODE_BUILTINS } from './trust'

const requireFromHere = createRequire(
  typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url),
)

const SCRIPT_EXTS = new Set(['.js', '.cjs', '.mjs'])

export interface RunJsOptions {
  code: string
  timeoutMs?: number
  maxOutputChars?: number
  meta?: Record<string, string>
}

export interface RunJsResult {
  ok: boolean
  result?: string
  error?: string
  durationMs: number
  truncated: boolean
  script?: string
}

function buildSandbox(meta?: Record<string, string>): Record<string, unknown> {
  const sandbox = Object.create(null) as Record<string, unknown>
  Object.assign(sandbox, {
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    Date,
    RegExp,
    Map,
    Set,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
  })
  if (meta) {
    sandbox.__script = Object.freeze({ ...meta })
  }
  return sandbox
}

function stringifyResult(value: unknown, maxChars: number): { text: string; truncated: boolean } {
  if (value === undefined) return { text: 'undefined', truncated: false }
  if (typeof value === 'string') {
    if (value.length <= maxChars) return { text: value, truncated: false }
    return { text: `${value.slice(0, maxChars)}…`, truncated: true }
  }
  let text: string
  try {
    text = JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    text = String(value)
  }
  if (text.length <= maxChars) return { text, truncated: false }
  return { text: `${text.slice(0, maxChars)}…`, truncated: true }
}

/** 无 require 的内联 VM */
export function runJsInVm2(options: RunJsOptions): RunJsResult {
  const code = options.code.trim()
  if (!code) {
    return { ok: false, error: 'code 不能为空', durationMs: 0, truncated: false }
  }
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5_000, 50), 30_000)
  const maxOutputChars = Math.min(Math.max(options.maxOutputChars ?? 8_000, 256), 64_000)
  const started = Date.now()

  try {
    const { VM } = requireFromHere('vm2') as typeof import('vm2')
    const vm = new VM({
      timeout: timeoutMs,
      sandbox: buildSandbox(options.meta),
      eval: false,
      wasm: false,
      fixAsync: true,
    })
    const value = vm.run(`"use strict";\n${code}`)
    const { text, truncated } = stringifyResult(value, maxOutputChars)
    return {
      ok: true,
      result: text,
      durationMs: Date.now() - started,
      truncated,
      script: options.meta?.relativePath,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: message.slice(0, maxOutputChars),
      durationMs: Date.now() - started,
      truncated: message.length > maxOutputChars,
      script: options.meta?.relativePath,
    }
  }
}

/** 有 exports/require 则原样；否则当作表达式赋给 module.exports */
export function prepareModuleSource(code: string): string {
  const trimmed = code.trim()
  if (/\b(module\.exports|exports\.|require\s*\()/.test(trimmed)) {
    return `"use strict";\n${trimmed}`
  }
  return `"use strict";\nmodule.exports = (${trimmed});`
}

export interface RunNodeVmOptions {
  code: string
  /** 脚本绝对路径（用于 require 相对解析） */
  filename: string
  /** require.root = 工作区 */
  workspaceRoot: string
  timeoutMs?: number
  maxOutputChars?: number
  meta?: Record<string, string>
}

/** NodeVM：可 require 工作区 node_modules；builtin 仅 SAFE 列表 */
export function runJsInNodeVm(options: RunNodeVmOptions): RunJsResult {
  const code = options.code.trim()
  if (!code) {
    return { ok: false, error: 'code 不能为空', durationMs: 0, truncated: false }
  }
  const timeoutMs = Math.min(Math.max(options.timeoutMs ?? 5_000, 50), 30_000)
  const maxOutputChars = Math.min(Math.max(options.maxOutputChars ?? 8_000, 256), 64_000)
  const started = Date.now()

  try {
    const { NodeVM } = requireFromHere('vm2') as typeof import('vm2')
    const vm = new NodeVM({
      console: 'redirect',
      sandbox: buildSandbox(options.meta),
      timeout: timeoutMs,
      wasm: false,
      eval: false,
      wrapper: 'commonjs',
      require: {
        external: true,
        builtin: [...SAFE_NODE_BUILTINS],
        root: options.workspaceRoot,
        context: 'sandbox',
      },
    })

    const source = prepareModuleSource(code)
    const value = vm.run(source, options.filename)
    const { text, truncated } = stringifyResult(value, maxOutputChars)
    return {
      ok: true,
      result: text,
      durationMs: Date.now() - started,
      truncated,
      script: options.meta?.relativePath,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      ok: false,
      error: message.slice(0, maxOutputChars),
      durationMs: Date.now() - started,
      truncated: message.length > maxOutputChars,
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
): Promise<RunJsResult> {
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
      error: `不支持的脚本扩展名：${ext || '(无)'}（允许 .js / .cjs / .mjs）`,
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

  return runJsInNodeVm({
    code,
    filename: abs,
    workspaceRoot: root,
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
    return { root, scripts: [], error: `目录不存在：${subdir}（可先用文件工具创建）` }
  }

  await walk(dirAbs)
  out.sort()
  return { root, scripts: out }
}

export function runJsResultToText(result: RunJsResult): string {
  return JSON.stringify(result, null, 2)
}
