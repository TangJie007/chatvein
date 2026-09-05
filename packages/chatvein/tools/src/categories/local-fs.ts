import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { resolveInWorkspace } from '../guards'
import { defineBuiltinTool } from '../wrap'

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX = 16_000

export function createLocalFsTools(options: {
  ids: Set<string>
  workspaceRoot: string
  timeoutMs?: number
  maxOutputChars?: number
}): StructuredToolInterface[] {
  const out: StructuredToolInterface[] = []
  const root = options.workspaceRoot
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX

  if (options.ids.has('read_file')) {
    out.push(
      defineBuiltinTool({
        name: 'read_file',
        description: 'Read a UTF-8 text file under the workspace. Path is relative to workspace root.',
        schema: z.object({
          path: z.string().describe('Relative path within workspace'),
        }),
        timeoutMs,
        maxOutputChars,
        invoke: async ({ path: rel }) => {
          const abs = resolveInWorkspace(root, rel)
          const buf = await readFile(abs)
          return buf.toString('utf8')
        },
      }),
    )
  }

  if (options.ids.has('list_dir')) {
    out.push(
      defineBuiltinTool({
        name: 'list_dir',
        description: 'List files and directories under a workspace-relative path.',
        schema: z.object({
          path: z.string().default('.').describe('Relative directory path'),
        }),
        timeoutMs,
        maxOutputChars,
        invoke: async ({ path: rel }) => {
          const abs = resolveInWorkspace(root, rel || '.')
          const entries = await readdir(abs, { withFileTypes: true })
          return entries
            .map((e) => `${e.isDirectory() ? 'dir' : 'file'}\t${e.name}`)
            .join('\n')
        },
      }),
    )
  }

  if (options.ids.has('grep_search')) {
    out.push(
      defineBuiltinTool({
        name: 'grep_search',
        description:
          'Search file contents under the workspace for a substring or regex. Returns path:line:snippet (capped).',
        schema: z.object({
          pattern: z.string().describe('Substring or JavaScript regex source'),
          path: z.string().default('.').describe('Subdirectory to search'),
          regex: z.boolean().default(false),
          maxMatches: z.number().int().min(1).max(100).default(40),
        }),
        timeoutMs: timeoutMs * 2,
        maxOutputChars,
        invoke: async ({ pattern, path: rel, regex, maxMatches }) => {
          const start = resolveInWorkspace(root, rel || '.')
          const re = regex ? new RegExp(pattern, 'i') : null
          const hits: string[] = []
          await walkFiles(start, async (fileAbs) => {
            if (hits.length >= maxMatches) return
            let text: string
            try {
              const st = await stat(fileAbs)
              if (!st.isFile() || st.size > 512_000) return
              text = await readFile(fileAbs, 'utf8')
            } catch {
              return
            }
            const lines = text.split(/\r?\n/)
            for (let i = 0; i < lines.length; i++) {
              if (hits.length >= maxMatches) break
              const line = lines[i]!
              const ok = re ? re.test(line) : line.includes(pattern)
              if (!ok) continue
              const relPath = relative(root, fileAbs).replace(/\\/g, '/')
              hits.push(`${relPath}:${i + 1}:${line.trim().slice(0, 200)}`)
            }
          })
          return hits.length ? hits.join('\n') : 'No matches.'
        },
      }),
    )
  }

  return out
}

async function walkFiles(dir: string, visit: (file: string) => Promise<void>): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue
    const abs = join(dir, e.name)
    if (e.isDirectory()) await walkFiles(abs, visit)
    else if (e.isFile()) await visit(abs)
  }
}
