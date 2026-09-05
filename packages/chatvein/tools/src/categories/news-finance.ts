import type { StructuredToolInterface } from '@langchain/core/tools'
import { wrapToolGuards } from '../wrap'
import type { ToolSecrets } from '../types'

const DEFAULT_TIMEOUT = 20_000
const DEFAULT_MAX = 8_000

export async function createNewsFinanceTools(options: {
  ids: Set<string>
  secrets?: ToolSecrets
  timeoutMs?: number
  maxOutputChars?: number
}): Promise<StructuredToolInterface[]> {
  const out: StructuredToolInterface[] = []
  const guards = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
    maxOutputChars: options.maxOutputChars ?? DEFAULT_MAX,
  }

  if (options.ids.has('google_trends') && options.secrets?.serpApiKey) {
    try {
      const { SERPGoogleTrendsTool } = await import('@langchain/community/tools/google_trends')
      out.push(
        wrapToolGuards(new SERPGoogleTrendsTool({ apiKey: options.secrets.serpApiKey }), guards),
      )
    } catch (err) {
      console.warn('[chatvein/tools] google_trends unavailable:', err)
    }
  }

  return out
}
