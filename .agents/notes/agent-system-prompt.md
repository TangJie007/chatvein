# Agent system prompt（生产标准）

## 文件

`backend/agents/graphs/prompts.py` → `build_agent_system(tier=...)`

## 组装顺序（固定）

1. `# Role`（可选，角色人设）
2. `# Identity`
3. `# Environment`（**动态**，含 `session_root` 绝对路径；必须靠前）
4. `# Workspace`（路径硬规则 + 正反例）
5. `# Tooling`（策略，不列工具名单）
6. `# Stopping`
7. `# Response`
8. `# Tier: medium|hard`
9. `# Plan`（仅 hard，执行时注入）

## 原则

- 工具细节只靠本轮绑定的 tool schema，system 不维护工具目录。
- medium / hard 共用同一份宪法，只差 Tier（与 Plan）。
- 改规则只改 `prompts.py`，不要在 medium.py / hard.py 再写长文案。
