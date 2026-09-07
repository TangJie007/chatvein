import { defineMcpTools } from './build'
import { TOOL_CATALOG_GROUPS } from './groups'

const SHELLSANDBOX = TOOL_CATALOG_GROUPS.find((g) => g.id === 'mcp_shellsandbox')!

/** 白名单 shell/git；读写走 mcp_filesystem */
export const SHELLSANDBOX_TOOLS = defineMcpTools(SHELLSANDBOX, [
  {
    tool: 'exec_shell',
    description:
      '白名单命令：npm/pnpm/node/git/测试构建。跑测试、安装依赖、build。exec shell npm test.',
  },
  {
    tool: 'git_op',
    description: '工作区 git status/diff/add/commit/log。git status diff commit.',
  },
])
