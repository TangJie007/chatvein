# `@chatvein/observability`

可观测：运行事件总线 + `trace.jsonl` 落盘（大 payload 外置为 `payloadRef`）+ 运行目录布局。PGlite 查询层后置。

Forge 任务图、对话 ReAct、群消息都应往这里打事件；UI 订阅同一总线。不负责编排或模型调用。
