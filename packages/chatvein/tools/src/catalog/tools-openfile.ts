import { defineMcpTools } from './build'
import { TOOL_CATALOG_GROUPS } from './groups'

const OPENFILE = TOOL_CATALOG_GROUPS.find((g) => g.id === 'mcp_openfile')!

export const OPENFILE_TOOLS = defineMcpTools(OPENFILE, [
  {
    tool: 'open_folder',
    description: '在系统文件管理器中打开文件夹；若给文件路径则打开其所在目录。reveal in explorer, show folder, open directory UI.',
  },
  {
    tool: 'list_allowed_directories',
    description: '列出 openfile MCP 允许打开的根目录；空表示未限制。openfile allowed roots path jail.',
    defaultEnabled: false,
  },
])
