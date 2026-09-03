# `@chatvein/common`

Harness 共享契约包：类型、错误、日志、配置 schema。所有 `@chatvein/*` 包、app、CLI 都只依赖这里的**接口与数据结构**，不放业务实现。

**包含：** `Task` / `TraceEvent` / `ChatModelLike` / `SandboxProvider`、图状态、校验器结果、`ForgeConfig`、结构化错误。

**红线：** 纯 Node，零 `electron`；不依赖 LangGraph / Cordis。
