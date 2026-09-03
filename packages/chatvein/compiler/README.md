# `@chatvein/compiler`

需求编译器（Forge M2）：把需求文档变成 orchestrator 可消费的 `Task[]`。

本地 Markdown 切分（不调模型）+ 模型抽取功能点/验收标准 → JSON 校验与失败重试/降级 → 拓扑排序与并行分组。产出带验收标准的任务树，供 LangGraph `plan` 节点使用。
