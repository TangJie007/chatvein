/** 对齐 ModSearch 输出契约的精简形状（见 upstream output-schema） */

export interface ModsearchItem {
  title: string
  url: string
  snippet?: string
  source?: string
  published_at?: string
}

export interface ModsearchResultEntry {
  source: string
  requestedSource?: string
  engine: string | null
  status?: string
  summary?: string
  items?: ModsearchItem[]
  content?: string
  links?: Array<{ text?: string; url: string }>
  uncertainty?: string[]
  warnings?: string[]
  durationSeconds?: number | null
}

export interface ModsearchEnvelope {
  mode: 'search' | 'fetch' | string
  query?: string | null
  url?: string | null
  results: ModsearchResultEntry[]
  meta?: { generatedAt?: string; durationSeconds?: number }
  /** 本 MCP 附加：是否走了 DuckDuckGo / 本地 fetch 兜底 */
  fallback?: {
    used: boolean
    engine: 'duckduckgo' | 'http_fetch' | null
    reason?: string
  }
}
