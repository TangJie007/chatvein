# `@chatvein/orchestrator`

Forge 自动编码编排：LangGraph **`StateGraph`**（plan → implement → verify → diagnose → fix → integrate），带 checkpoint 与预算护栏。

P0 串行；`dispatch` 预留 `parallel_group` 给 P1。不自研状态机循环。

**不是**对话循环——普通对话用 `@chatvein/agents` 的 `createReactAgent`。详见 [`docs/phase1/03-开发计划书.md`](../../../docs/phase1/03-开发计划书.md) §1.1。
