import { defineMcpTools } from './build'
import { TOOL_CATALOG_GROUPS } from './groups'

const VMSANDBOX = TOOL_CATALOG_GROUPS.find((g) => g.id === 'mcp_vmsandbox')!

/** 默认集 3 个（run/list/install）；check_package_trust 与 run_js 按需 */
export const VMSANDBOX_TOOLS = defineMcpTools(VMSANDBOX, [
  {
    tool: 'run_workspace_script',
    description: '用 NodeVM 执行工作区 scripts/ 下 JS，可 require 已装 npm 包。跑 node 脚本、本地计算。run workspace js script vm2.',
  },
  { tool: 'list_workspace_scripts', description: '列出工作区 scripts/ 下 .js/.cjs/.mjs。list node scripts in workspace.' },
  {
    tool: 'ensure_trusted_packages',
    description: '校验并 npm install 可信包到工作区（白名单或高周下载量）。安装依赖、加 lodash。install trusted npm packages.',
  },
  {
    tool: 'check_package_trust',
    description: '只校验 npm 包是否可信，不安装。check npm package trust downloads allowlist.',
    defaultEnabled: false,
  },
  {
    tool: 'run_js',
    description: '内联短 JavaScript（无 require）。算表达式、小段 JS。eval inline js no require.',
    defaultEnabled: false,
  },
])
