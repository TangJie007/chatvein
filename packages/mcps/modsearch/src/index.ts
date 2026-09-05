export type {
  ModsearchEnvelope,
  ModsearchItem,
  ModsearchResultEntry,
} from './types'

export {
  resolveModsearchCliEntry,
  runModsearchCli,
  mapDuckDuckGoResults,
  searchDuckDuckGo,
  fetchPageHttp,
  webSearch,
  readPage,
  envelopeToText,
} from './run'
export type { RunModsearchOptions } from './run'

export { createModsearchMcpServer, startModsearchServer } from './server'
export type { CreateModsearchServerOptions } from './server'
