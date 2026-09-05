import type { StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import { defineBuiltinTool } from '../wrap'

const DEFAULT_TIMEOUT = 15_000
const DEFAULT_MAX = 20_000

export function createWebTools(options: {
  ids: Set<string>
  timeoutMs?: number
  maxOutputChars?: number
}): StructuredToolInterface[] {
  const out: StructuredToolInterface[] = []
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX

  if (options.ids.has('fetch_url')) {
    out.push(
      defineBuiltinTool({
        name: 'fetch_url',
        description:
          'Fetch a public http(s) URL and return approximate plain text (HTML tags stripped). Use for reading a page, not bulk crawling.',
        schema: z.object({
          url: z.string().url().describe('Absolute http(s) URL'),
        }),
        timeoutMs,
        maxOutputChars,
        invoke: async ({ url }) => {
          const u = new URL(url)
          if (u.protocol !== 'http:' && u.protocol !== 'https:') {
            throw new Error('Only http(s) URLs are allowed')
          }
          const res = await fetch(url, {
            redirect: 'follow',
            headers: { 'user-agent': 'chatvein-fetch_url/0.1' },
            signal: AbortSignal.timeout(timeoutMs),
          })
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
          const ctype = res.headers.get('content-type') ?? ''
          const body = await res.text()
          if (ctype.includes('html') || body.trimStart().startsWith('<')) {
            return stripHtml(body)
          }
          return body
        },
      }),
    )
  }

  return out
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
