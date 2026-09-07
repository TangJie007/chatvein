# 决策笔记：Forge 优先 apply_patch 最小改动

状态：已落地

## 背景

Forge 内层 ReAct 原先只有全量 `write_file`。prompt 已要求「最小改动」，但工具契约迫使模型输出整文件，大文件修几行也会烧大量输出 token，且易截断/漏行。方案设计（phase1/02）已列出 `apply_patch`，需落到工具层。

## 决策

在 `@chatvein/orchestrator` 的 `createForgeTools` 增加 **`apply_patch`**：

- 精确 `old_string` → `new_string`（search-replace），默认要求唯一匹配；`replace_all` 可选。
- 仍经 PathJail + 敏感路径拒绝，直接写真实工作区（与现有策略一致，无临时 copy）。
- 返回极简 unified hunk 摘要，便于模型确认。
- `write_file` 保留，描述改为「新建或必须整文件重写」。
- implement / fix 的 system prompt 明确：**改已有文件优先 apply_patch**。

## 备选方案

**复用 MCP filesystem `edit_file`**：要起 stdio 子进程，与 sandbox/CLI 纯 Node 边界冲突；否决。

**完整 V4A/unified diff 解析器**：表达力更强，但解析与失败提示更复杂；一期精确字符串替换已覆盖主流 Agent 用法；否决先做重解析。

**只改 prompt 不加工具**：模型仍只能整文件写；否决。

## 影响

- 收益：修改路径输出 token 显著下降；与「最小改动」文案一致。
- 代价：old_string 必须与原文完全一致，匹配失败需再读文件；模型需学会扩上下文保证唯一。
- 后续：可按需加 `grep`/`glob`，减少为凑 patch 而整文件 read。
