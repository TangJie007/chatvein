# `@chatvein/core`

Harness **门面**：Electron app 与 `@chatvein/service` 应只通过本包启动/暂停/续跑一次运行。

内部用 `@deepseek-ai/cordis` 持根 `Context`，把 models / tools / sandbox / orchestrator / agents 等能力包挂成插件服务。**Cordis 不管任务边条件**——Forge 图在 `orchestrator`，对话 ReAct 在 `agents`。

**红线：** Cordis 只出现在纯 Node（sidecar / in-process）；`@electrum/*` 与渲染进程不得 import Cordis。本包再导出 `Context` / `Service` / `Fiber`。
