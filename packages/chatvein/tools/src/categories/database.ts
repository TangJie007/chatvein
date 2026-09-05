import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { resolveInWorkspace } from '../guards'
import { defineBuiltinTool } from '../wrap'

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_MAX = 16_000

export function createDatabaseTools(options: {
  ids: Set<string>
  workspaceRoot: string
  timeoutMs?: number
  maxOutputChars?: number
}): StructuredToolInterface[] {
  const out: StructuredToolInterface[] = []
  const root = options.workspaceRoot
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX

  if (options.ids.has('sqlite_query')) {
    out.push(
      defineBuiltinTool({
        name: 'sqlite_query',
        description:
          'Run a read-only SQL query (SELECT/WITH/PRAGMA) against a SQLite file under the workspace. Path is workspace-relative.',
        schema: z.object({
          path: z.string().describe('Relative path to .db / .sqlite file'),
          sql: z.string().describe('Read-only SQL statement'),
        }),
        timeoutMs,
        maxOutputChars,
        invoke: async ({ path: rel, sql }) => {
          const trimmed = sql.trim()
          if (!isReadOnlySql(trimmed)) {
            throw new Error('Only read-only SQL (SELECT / WITH / PRAGMA) is allowed')
          }
          const abs = resolveInWorkspace(root, rel)
          // Node 24+ 内置；动态 import 便于测试环境探测
          const { DatabaseSync } = await import('node:sqlite')
          const db = new DatabaseSync(abs, { readOnly: true })
          try {
            const rows = db.prepare(trimmed).all()
            return JSON.stringify(rows, null, 2)
          } finally {
            db.close()
          }
        },
      }),
    )
  }

  return out
}

function isReadOnlySql(sql: string): boolean {
  const head = sql.replace(/^\s*\(*/, '').trimStart().toUpperCase()
  return /^(SELECT|WITH|PRAGMA)\b/.test(head) && !/\b(INSERT|UPDATE|DELETE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX)\b/i.test(sql)
}
