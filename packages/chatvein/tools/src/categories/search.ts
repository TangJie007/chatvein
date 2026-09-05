import type { StructuredToolInterface } from '@langchain/core/tools'
import { wrapToolGuards } from '../wrap'
import type { ToolSecrets } from '../types'

const DEFAULT_TIMEOUT = 20_000
const DEFAULT_MAX = 12_000

export async function createSearchTools(options: {
  ids: Set<string>
  secrets?: ToolSecrets
  timeoutMs?: number
  maxOutputChars?: number
}): Promise<StructuredToolInterface[]> {
  const out: StructuredToolInterface[] = []
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX
  const guards = { timeoutMs, maxOutputChars }

  if (options.ids.has('duckduckgo_search')) {
    try {
      const { DuckDuckGoSearch } = await import('@langchain/community/tools/duckduckgo_search')
      out.push(wrapToolGuards(new DuckDuckGoSearch({ maxResults: 5 }), guards))
    } catch (err) {
      console.warn('[chatvein/tools] duckduckgo_search unavailable:', err)
    }
  }

  if (options.ids.has('brave_search') && options.secrets?.braveApiKey) {
    try {
      const { BraveSearch } = await import('@langchain/community/tools/brave_search')
      out.push(
        wrapToolGuards(
          new BraveSearch({ apiKey: options.secrets.braveApiKey }),
          guards,
        ),
      )
    } catch (err) {
      console.warn('[chatvein/tools] brave_search unavailable:', err)
    }
  }

  if (options.ids.has('serp_search') && options.secrets?.serpApiKey) {
    try {
      const { SerpAPI } = await import('@langchain/community/tools/serpapi')
      out.push(wrapToolGuards(new SerpAPI(options.secrets.serpApiKey), guards))
    } catch (err) {
      console.warn('[chatvein/tools] serp_search unavailable:', err)
    }
  }

  return out
}
