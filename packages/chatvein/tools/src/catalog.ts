import type { ToolCatalogEntry } from './types'

/** 稳定工具目录（id 供角色白名单 / UI；实现可换源） */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  // —— 1 搜索 / 联网 ——
  {
    id: 'duckduckgo_search',
    category: 'search',
    title: 'DuckDuckGo 搜索',
    description: '轻量联网检索（无密钥）；优先用已配置的 MCP 搜索服务器。',
    source: '@langchain/community/tools/duckduckgo_search',
    defaultEnabled: true,
  },
  {
    id: 'brave_search',
    category: 'search',
    title: 'Brave Search',
    description: 'Brave 联网搜索（需 BRAVE_SEARCH_API_KEY）。',
    source: '@langchain/community/tools/brave_search',
    defaultEnabled: false,
    requiresSecret: 'brave',
  },
  {
    id: 'serp_search',
    category: 'search',
    title: 'SerpAPI',
    description: 'Google 等结果聚合（需 SERPAPI_API_KEY）。',
    source: '@langchain/community/tools/serpapi',
    defaultEnabled: false,
    requiresSecret: 'serp',
  },

  // —— 2 计算 & 代码 ——
  {
    id: 'calculator',
    category: 'compute',
    title: '计算器',
    description: '求值数学表达式。',
    source: '@langchain/community/tools/calculator',
    defaultEnabled: true,
  },
  {
    id: 'js_eval',
    category: 'compute',
    title: '受限 JS 求值',
    description: '在 node:vm 沙箱中执行短 JS（无 IO / 无 require）。',
    source: 'builtin',
    defaultEnabled: true,
  },
  {
    id: 'wolfram_alpha',
    category: 'compute',
    title: 'Wolfram Alpha',
    description: '符号计算与知识问答（需 WOLFRAM_ALPHA_APPID）。',
    source: '@langchain/community/tools/wolframalpha',
    defaultEnabled: false,
    requiresSecret: 'wolfram',
  },

  // —— 3 本地文件 ——
  {
    id: 'read_file',
    category: 'local_fs',
    title: '读文件',
    description:
      '读取工作区内文本文件（builtin 后备）。有 workspace 时优先 MCP `filesystem__read_text_file`。',
    source: 'builtin',
    defaultEnabled: true,
  },
  {
    id: 'list_dir',
    category: 'local_fs',
    title: '列目录',
    description:
      '列出工作区内目录（builtin 后备）。优先 MCP `filesystem__list_directory`。',
    source: 'builtin',
    defaultEnabled: true,
  },
  {
    id: 'grep_search',
    category: 'local_fs',
    title: '文本检索',
    description:
      '工作区内内容检索（builtin 后备）。优先 MCP `filesystem__search_files`。',
    source: 'builtin',
    defaultEnabled: true,
  },

  // —— 4 网页解析 ——
  {
    id: 'fetch_url',
    category: 'web',
    title: '抓取网页文本',
    description: 'HTTP GET 后去标签截断；复杂抓取优先走 MCP。',
    source: 'builtin',
    defaultEnabled: true,
  },

  // —— 5 资讯 & 金融 ——
  {
    id: 'google_trends',
    category: 'news_finance',
    title: 'Google Trends',
    description: '兴趣趋势（经 SerpAPI，需密钥）。',
    source: '@langchain/community/tools/google_trends',
    defaultEnabled: false,
    requiresSecret: 'serp',
  },

  // —— 6 数据库 ——
  {
    id: 'sqlite_query',
    category: 'database',
    title: 'SQLite 只读查询',
    description: '对工作区内 .db/.sqlite 执行 SELECT（node:sqlite）。',
    source: 'builtin',
    defaultEnabled: true,
  },

  // —— 7 知识库 ——
  {
    id: 'wikipedia',
    category: 'knowledge',
    title: 'Wikipedia',
    description: '维基百科检索与摘要。',
    source: '@langchain/community/tools/wikipedia_query_run',
    defaultEnabled: true,
  },
  {
    id: 'stackexchange',
    category: 'knowledge',
    title: 'Stack Exchange',
    description: 'Stack Overflow 等站点问答检索。',
    source: '@langchain/community/tools/stackexchange',
    defaultEnabled: true,
  },
] as const

export function catalogById(id: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG.find((e) => e.id === id)
}

export function catalogByCategory(category: ToolCatalogEntry['category']): ToolCatalogEntry[] {
  return TOOL_CATALOG.filter((e) => e.category === category)
}
