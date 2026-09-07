# 决策笔记：文件操作统一 deepagents StateBackend

状态：已落地

## 背景

本地文件原先双轨：办公主 Agent 走 MCP `@modelcontextprotocol/server-filesystem`，编程 Forge 走 `createForgeTools` + `coding-ops`。工具名、语义与 jail 不一致，模型与维护成本都高。deepagents 提供成熟的 `createFilesystemMiddleware` + `StateBackend`，可挂到 LangChain `createAgent` middleware。文件工具还需要参与 C1/C2 向量筛选与中文描述治理。

## 决策

- `@chatvein/tools` 目录组 **`state_filesystem`**：条目 id = 运行时名（`ls` / `read_file` / `write_file` / `edit_file` / `glob` / `grep`），含描述与 keywords，进工具向量索引。
- 导出 `stateFilesystemCustomDescriptions` / `normalizeStateFilesystemAllowlist` / `selectStateFilesystemCatalogEntries`；**不**在 tools 里装 deepagents。
- `@chatvein/agents` 的 `createStateFilesystemMiddleware` 默认注入目录描述；`createReactChatAgent({ filesystem: string[] | true })` 收窄 allowlist。
- 办公 `resolveBoundTools` 返回 `{ tools, filesystemTools }`：C1/C2 对 StructuredTool + FS 目录联合筛选；FS 不进 C3 预算；空 allowlist 不挂 middleware。
- Forge implement/fix 仍 `filesystem: true`（全套 + 目录描述）；shell/git 仍 `createForgeTools`。
- **已删除** MCP filesystem 目录与依赖。

## 备选方案

**继续 MCP filesystem + Forge coding-ops 双轨**：工具面分裂。

**把 createFilesystemMiddleware 搬进 tools**：会把 deepagents 运行时拖进目录包，边界混乱。

**编程轨改用 FilesystemBackend**：与主 Agent StateBackend 不同步。

## 影响

- 收益：主/编程共用工具面；描述可进向量库过滤；去掉 MCP FS 进程。
- 代价：大仓库需 seed 上限；未种子化路径对 StateBackend 不可见。
- 后续注意：超大项目可考虑 CompositeBackend / FilesystemBackend。
