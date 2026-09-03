# 决策笔记：Forge 轨与 Chat 产品轨双轨排期 + LangGraph 分工写入工程文档

状态：已落地

## 背景

`docs/design/01` 定义了 `@chatvein/agents|groups|memory|vector` 与普通对话/拉群能力，且明确 ReAct 应用 LangGraph；但 `docs/phase1/03-开发计划书` 仅排 Forge 初赛轨（M0–M3），agents 等包在计划书中缺失，造成「设计有、计划无」与「是否要从零写循环」的误解。用户要求全部相关文档同步补上，并确认不能抛弃 LangChain/LangGraph。

## 决策

- **双轨里程碑**：Forge 轨 **M0–M3**（自动编码参赛）；Chat 产品轨 **CP0–CP2**（agents 对话 → 流式 UI → 群聊记忆），与 M1 末/M2 **并行、不阻塞初赛**。
- **LangGraph 分工（不自研循环）**：
  - `orchestrator`：`StateGraph`（plan→implement→verify→…），M1-7；
  - `agents`：`createReactAgent` + `astream`，CP0；
  - `groups`：supervisor/群图，CP2+。
- **模型层双路径**：`ChatModelLike` + fetch（可测）与 `@langchain/openai` 桥接（给 LangGraph）并存。
- **app 模块分工**：`forge/*` 只调 core；`chat/*` 只调 agents（CP1 替换临时 fetch 双轨）；均不 import `@langchain/*`。
- **已同步文档**：`phase1/01`（C1–C8 + 红线）、`phase1/02`（包结构/Cordis/app 双模块）、`phase1/03`（CP WBS）、`phase1/04`（依赖图）、`design/index` 及 01–08 排期列、`docs/index`、`06-Cordis` 红线。

## 备选方案

**把 agents 塞进 M1 阻塞初赛**：会挤占 orchestrator 关键路径，违背「M1 收口能跑通」原则；改为 CP 并行。

**Chat 轨推迟到第二期整包再做**：设计/ app 已部分实现对话 UI，无排期更易继续临时直连 tech debt；CP0–CP1 明确替换路径。

**完全依赖 LangChain、去掉 fetch 直连**：牺牲 R1 可测性与 mock 友好；保留双路径。

## 影响

- 收益：设计↔计划↔依赖一览可追溯；团队明确「用 LangGraph、不写 ReAct 循环」；初赛与产品对话目标不互相绑架。
- 代价：文档维护两套里程碑符号（M* vs CP*）；Chat 四包尚未在仓库创建骨架（CP0-1 待做）。
- 后续注意：实现 CP0 时创建 `packages/chatvein/agents` 等并更新 `pnpm-workspace`；`check-boundaries` 可扩展禁止 app/chat import langchain（与 forge 对称）。
