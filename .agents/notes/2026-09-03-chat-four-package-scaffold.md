# 决策笔记：Chat 四包骨架（agents / groups / memory / vector）

状态：已落地

## 背景

`docs/design/01` 定义了四个 Chat 能力包，计划书 M0-4 / CP0-1 要求创建骨架，但仓库此前只有 Forge 11 包，导致设计与代码不一致。

## 决策

在 `packages/chatvein/` 下新增四包，结构与既有包一致（tsup 双格式 + vitest + `src/__tests__/`）：

| 包 | 依赖（骨架期） |
|----|----------------|
| `@chatvein/agents` | common, models, tools, context, observability, @langchain/core, @langchain/langgraph |
| `@chatvein/groups` | common, agents, observability, @langchain/langgraph |
| `@chatvein/memory` | common, observability |
| `@chatvein/vector` | common, @electric-sql/pglite |

- **暂不**在 `@chatvein/core` 挂载 Cordis 插件（留 CP0-6）。
- **暂不**实现业务 API（`recall` / `createReactAgent` 等留 CP0–CP2）。

## 备选方案

**只建 agents、其余等 CP2 再说**：groups 依赖 agents，memory/vector 文档已排 CP2，但 M0-4 要求四包并列；一次建齐避免后续 workspace/文档再次漂移。

## 影响

- 收益：`pnpm verify:harness` 覆盖 15 包；依赖图与 `04-依赖选型` 一致。
- 代价：LangGraph 依赖提前进入 agents/groups（仅 package.json，无运行时代码）。
- 后续：CP0-2 起在 agents 内接 `createReactAgent`；CP0-6 在 core 挂载 `ctx.agents`。
