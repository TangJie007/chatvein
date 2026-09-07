# 决策笔记：文件操作统一 deepagents StateBackend

状态：已落地

## 背景

本地文件原先双轨：办公主 Agent 走 MCP `@modelcontextprotocol/server-filesystem`，编程 Forge 走 `createForgeTools` + `coding-ops`。工具名、语义与 jail 不一致，模型与维护成本都高。deepagents 提供成熟的 `createFilesystemMiddleware` + `StateBackend`，可挂到 LangChain `createAgent` middleware。

## 决策

- `@chatvein/agents` 依赖 `deepagents`；导出 `createStateFilesystemMiddleware`（默认 `new StateBackend()`，工具：`ls` / `read_file` / `write_file` / `edit_file` / `glob` / `grep`，**不含** `execute`）。
- `createReactChatAgent({ filesystem: true })` 挂载上述中间件；主 Agent（`office-turn`）与编程 Agent（Forge `implement` / `fix`）同步启用。
- StateBackend 文件存在 LangGraph `state.files`；需要落盘产物或 verify 时用 `seedFilesFromDisk` / `flushFilesToDisk` 与工作区同步。
- MCP `mcp_filesystem` 默认关闭（`mcpFilesystem` 默认 false、目录 `defaultEnabled: false`）；shell/git 仍用 `mcp_shellsandbox` / Forge `exec_shell`+`git_op`。
- 敏感路径经 middleware `permissions` deny（对齐原 coding-ops basename 规则）。

## 备选方案

**继续 MCP filesystem + Forge coding-ops 双轨**：工具面分裂，与「优先成熟第三方」不符。

**编程轨改用 FilesystemBackend 直写磁盘**：verify 更直接，但与主 Agent 的 StateBackend 语义不一致；本期要求两轨同步，故统一 StateBackend + seed/flush。

**把 shell 也并进 middleware `execute`**：会绕开 `LocalSandboxProvider` 白名单；保留沙箱 exec。

## 影响

- 收益：主/编程共用同一文件工具面；去掉自研 FS LangChain 包装与默认 MCP FS 进程。
- 代价：大仓库需 seed 上限（默认 400 文件 / 256KiB）；未种子化的路径对 StateBackend 不可见。
- 后续注意：超大项目可考虑 CompositeBackend / FilesystemBackend；旧白名单 id `mcp_filesystem` 仅兼容保留。
