# 决策笔记：文件操作改 CompositeBackend（State + /workspace/ 盘）

状态：已落地

## 背景

纯 `StateBackend` + seed/flush 在编程大仓上吃力：默认最多灌约 400 个文件、单文件 256KB，未种子化路径对 Agent 不可见；checkpoint 体积膨胀；shell 直写盘与 state.files 易脱节。官方 deepagents 推荐用 `CompositeBackend` 把工作区挂到 `FilesystemBackend`，内部 offload 仍留在 State。

前序决策见 [2026-09-07-deepagents-filesystem-statebackend.md](./2026-09-07-deepagents-filesystem-statebackend.md)（已被本笔记取代）。

## 决策

- `@chatvein/agents` `createStateFilesystemMiddleware({ rootDir })` 默认：
  - `CompositeBackend(new StateBackend(), { '/workspace/': new FilesystemBackend({ rootDir, virtualMode: true }) })`
  - 工作区路径前缀常量 `WORKSPACE_ROUTE_PREFIX = '/workspace/'`
- `createReactChatAgent({ filesystem, workspaceRoot })`：`filesystem: true | string[]` 时 **必须** 传 `workspaceRoot`
- 办公 `office-turn` / Forge implement·fix：**去掉** seed/flush；产物扫描仍靠磁盘 mtime diff
- Prompt / 目录描述约定：工作区用 `/workspace/...`；其它路径为 State 草稿
- 目录组 id 仍为 `state_filesystem`（allowlist / 向量索引稳定）；文案改为 Composite

## 备选方案

**继续纯 StateBackend + 提高 seed 上限**：checkpoint 与灌盘成本随仓变大，shell 不同步问题仍在。

**裸 FilesystemBackend**：内部 `/large_tool_results/` 等会写进项目根；官方明确不推荐。

**仅 Forge 上 Composite、办公仍 State**：主/编程工具面与路径语义再次分裂。

## 影响

- 收益：大仓按需读盘；写盘与 shell 一致；无 seed 上限；内部产物仍不污染工作区。
- 代价：工作区写入即时落盘（失去回合末 flush 闸门）；模型须使用 `/workspace/` 前缀。
- 后续注意：HITL / 敏感路径仍靠 `CHATVEIN_FS_DENY_PERMISSIONS`；`virtualMode: true` 防出 jail。
