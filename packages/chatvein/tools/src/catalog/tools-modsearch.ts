import { defineMcpTools } from './build'
import { TOOL_CATALOG_GROUPS } from './groups'

const MODSEARCH = TOOL_CATALOG_GROUPS.find((g) => g.id === 'mcp_modsearch')!

export const MODSEARCH_TOOLS = defineMcpTools(MODSEARCH, [
  {
    tool: 'web_search',
    description: '联网搜索网页/资讯，返回摘要与结果列表（可 DuckDuckGo 兜底）。搜索、查资料、google。web search internet query.',
  },
  {
    tool: 'read_page',
    description: '抓取单个网页正文（可带关注点 query）。打开链接、读文章、爬页面。fetch url read webpage scrape page.',
  },
])
