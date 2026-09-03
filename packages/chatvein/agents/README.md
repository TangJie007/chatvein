# `@chatvein/agents`

Chat 产品轨的 **Agent 运行时**：单个角色的 LangGraph **`createReactAgent`** + 角色/persona 加载 + 工具绑定。普通对话与群成员单次发言都由本包驱动。

不从零写 ReAct while 循环。app 的 `chat/*` 只调本包（经 core），不得内嵌 LangGraph。排期 CP0；`astream` → `ChatEvent` 见 [`docs/design/08-流式对话与Markdown渲染.md`](../../../docs/design/08-流式对话与Markdown渲染.md)。
