import type { StructuredToolInterface } from '@langchain/core/tools'
import { wrapToolGuards } from '../wrap'

const DEFAULT_TIMEOUT = 20_000
const DEFAULT_MAX = 12_000

export async function createKnowledgeTools(options: {
  ids: Set<string>
  timeoutMs?: number
  maxOutputChars?: number
}): Promise<StructuredToolInterface[]> {
  const out: StructuredToolInterface[] = []
  const guards = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT,
    maxOutputChars: options.maxOutputChars ?? DEFAULT_MAX,
  }

  if (options.ids.has('wikipedia')) {
    const { WikipediaQueryRun } = await import('@langchain/community/tools/wikipedia_query_run')
    out.push(
      wrapToolGuards(
        new WikipediaQueryRun({ topKResults: 2, maxDocContentLength: 4000 }),
        guards,
      ),
    )
  }

  if (options.ids.has('stackexchange')) {
    const { StackExchangeAPI } = await import('@langchain/community/tools/stackexchange')
    out.push(wrapToolGuards(new StackExchangeAPI({ maxResult: 3 }), guards))
  }

  return out
}
