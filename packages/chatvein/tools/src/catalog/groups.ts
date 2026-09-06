import type { ToolCatalogGroup } from '../types'

/** MCP server 级分组（6 个）：UI 折叠、整组白名单、连接信息、workspace 依赖 */
export const TOOL_CATALOG_GROUPS: readonly ToolCatalogGroup[] = [
  {
    id: 'mcp_filesystem',
    category: 'local_fs',
    title: '工作区文件系统（MCP）',
    description:
      '经 @modelcontextprotocol/server-filesystem 提供读/写/列/搜等；仅允许 workspaceRoot。',
    source: 'mcp:@modelcontextprotocol/server-filesystem',
    mcpServer: 'filesystem',
    requiresWorkspace: true,
    defaultEnabled: true,
    keywords: ['文件', '读取文件', '写文件', '目录', '列目录', '搜索文件', 'file', 'read', 'write', 'ls', 'folder'],
  },
  {
    id: 'mcp_openfile',
    category: 'local_fs',
    title: '打开文件夹（MCP）',
    description:
      '经 @chatvein/mcp-openfile-sdk 在系统文件管理器中打开目录；若路径是文件则打开其所在目录。',
    source: 'mcp:@chatvein/mcp-openfile-sdk',
    mcpServer: 'openfile',
    requiresWorkspace: true,
    defaultEnabled: true,
    keywords: ['打开文件夹', '资源管理器', '定位文件', 'open folder', 'explorer', 'reveal'],
  },
  {
    id: 'mcp_modsearch',
    category: 'search',
    title: '联网搜索（ModSearch MCP）',
    description:
      '经 @chatvein/mcp-modsearch-sdk：优先 ModSearch 引擎链，搜索失败兜底 DuckDuckGo。',
    source: 'mcp:@chatvein/mcp-modsearch-sdk',
    mcpServer: 'modsearch',
    defaultEnabled: true,
    keywords: ['联网搜索', '搜索', '查资料', '上网查', '资讯', 'web search', 'search', 'google'],
  },
  {
    id: 'mcp_vmsandbox',
    category: 'compute',
    title: '工作区 JS 沙箱（vm2 MCP）',
    description:
      '经 @chatvein/mcp-vmsandbox-sdk：绑定 workspace，NodeVM 跑 scripts/（可 require 工作区 node_modules）。',
    source: 'mcp:@chatvein/mcp-vmsandbox-sdk',
    mcpServer: 'vmsandbox',
    requiresWorkspace: true,
    defaultEnabled: true,
    keywords: ['执行脚本', '运行代码', '跑脚本', 'node', 'javascript', 'npm', '沙箱', 'run script'],
  },
  {
    id: 'mcp_pyodide',
    category: 'compute',
    title: '工作区 Python 沙箱（Pyodide MCP）',
    description:
      '经 @chatvein/mcp-pyodide-sdk：绑定 workspace，Pyodide 跑 scripts/**/*.py。',
    source: 'mcp:@chatvein/mcp-pyodide-sdk',
    mcpServer: 'pyodide',
    requiresWorkspace: true,
    defaultEnabled: true,
    keywords: ['执行脚本', '运行代码', '跑脚本', 'python', 'py', 'numpy', 'pandas', '沙箱', 'run script'],
  },
  {
    id: 'mcp_playwright',
    category: 'web',
    title: '浏览器自动化（Playwright MCP）',
    description:
      '经 @playwright/mcp：无障碍树快照驱动的浏览器导航/点击/填表等。默认 headless；需已安装浏览器二进制。',
    source: 'mcp:@playwright/mcp',
    mcpServer: 'playwright',
    defaultEnabled: true,
    keywords: ['浏览器', '网页', '点击', '填表', '截图', '自动化', 'browser', 'click', 'screenshot', 'navigate'],
  },
]

export function catalogGroupById(id: string): ToolCatalogGroup | undefined {
  return TOOL_CATALOG_GROUPS.find((g) => g.id === id)
}
