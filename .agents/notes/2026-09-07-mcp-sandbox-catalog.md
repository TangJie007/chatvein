# 决策笔记：MCP sandbox 目录与 Forge 编码原语统一

状态：已落地（MCP 包名/暴露面已由 [2026-09-07-mcp-shellsandbox.md](./2026-09-07-mcp-shellsandbox.md) 取代；本文保留 coding-ops + Forge 进程内包装的依据）

## 背景

Chat 轨工具走 `@chatvein/tools` 目录 + MCP + 角色白名单；Forge（code 模式）长期维护一套进程内 `createForgeTools`（读/写/patch/list/exec/git）。两边语义相近但实现分叉，容易出现「Chat 能改仓 / Forge 能改仓」行为不一致（敏感路径、patch 规则、命令白名单）。产品方向要求编码能力进入统一目录，而不是永久双轨自研工具面。

## 决策

1. **共享原语落在 `@chatvein/sandbox`**：`coding-ops`（`assertNotSecretPath` / `applyExactReplace` / `readWorkspaceText` / `writeWorkspaceText` / `applyWorkspacePatch` / `splitArgv`）供 Forge 使用；包仍保持纯 Node、无 LangChain/MCP SDK。
2. ~~新增 `@chatvein/mcp-sandbox-sdk` 暴露全套编码工具~~ → **已取代**：见 [mcp-shellsandbox](./2026-09-07-mcp-shellsandbox.md)（仅 exec/git；读写走 filesystem）。
3. **Forge 仍进程内包装**：`createForgeTools` 调用 coding-ops，保留 LangChain StructuredTool + trace/截断/`AbortSignal`；不改为每轮拉起 MCP stdio。
4. Coder 默认白名单：`mcp_shellsandbox` + openfile / modsearch 等（文件读写走 Composite，见 [2026-09-07-deepagents-filesystem-composite.md](./2026-09-07-deepagents-filesystem-composite.md)）。

## 备选方案

### 为什么不用「Forge 也走 resolveChatTools + MCP」？

每节点 ReAct 步都会付 stdio 与工具名加前缀成本；Forge 已有 `SandboxProvider` 实例与 abort 管线。统一语义通过共享 coding-ops 即可，不必统一运输层。

### 为什么不用「删掉 createForgeTools、Chat/Forge 完全同一入口」？

短期会打断 harness/orchestrator 热路径与测试；当前决策是 Forge 热路径进程内、Chat 走 MCP 目录。若日后 Chat 侧也需要无 MCP 的同进程绑定，可再抽 `bindSandboxTools(sandbox)`。

## 影响

- **收益（仍有效）**：Forge 敏感路径与 patch 规则单点在 coding-ops。
- **已过时**：全套 MCP 编码工具与 filesystem 重叠的代价，见取代笔记。
