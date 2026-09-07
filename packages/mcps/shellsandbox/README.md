# `@chatvein/mcp-shellsandbox-sdk`

经 `@chatvein/sandbox` `LocalSandboxProvider` 提供白名单 **exec_shell** / **git_op**（路径 jail + 命令白名单）。

读写/局部编辑请用 deepagents **Composite** middleware（工作区路径 `/workspace/...`；`ls` / `read_file` / `write_file` / `edit_file`）。Chat 目录组：`mcp_shellsandbox`。

```bash
pnpm --filter @chatvein/mcp-shellsandbox-sdk build
node packages/mcps/shellsandbox/dist/cli.js /path/to/workspace
```
