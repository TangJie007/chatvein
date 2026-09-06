import { defineMcpTools } from './build'
import { TOOL_CATALOG_GROUPS } from './groups'

const PYODIDE = TOOL_CATALOG_GROUPS.find((g) => g.id === 'mcp_pyodide')!

/** 默认集 3 个（run/list/install）；check_package_trust 与 run_py 按需 */
export const PYODIDE_TOOLS = defineMcpTools(PYODIDE, [
  {
    tool: 'run_workspace_script',
    description: '用 Pyodide 执行工作区 scripts/ 下 Python。跑 py 脚本、数据分析。run workspace python script pyodide.',
  },
  { tool: 'list_workspace_scripts', description: '列出工作区 scripts/ 下 .py。list python scripts in workspace.' },
  {
    tool: 'ensure_trusted_packages',
    description: '校验并安装可信 PyPI 包到 Pyodide（loadPackage/micropip）。装 numpy pandas。install trusted python packages.',
  },
  {
    tool: 'check_package_trust',
    description: '只校验 PyPI 包是否可信，不安装。check pypi package trust downloads allowlist.',
    defaultEnabled: false,
  },
  {
    tool: 'run_py',
    description: '内联短 Python（Pyodide）。算数、小段代码。eval inline python pyodide.',
    defaultEnabled: false,
  },
])
