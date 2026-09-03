# `@chatvein/service`

无头 **调用者**：`forge` CLI（run / resume / preview / regression）和 sidecar（stdio JSON-RPC），给 Electron 做崩溃隔离与无人值守。

**不含** Agent 业务逻辑——一律调 `@chatvein/core`。持 Cordis 根 Context 与 LangGraph sqlite checkpoint（原生 sqlite 只在 sidecar，不进 Electron 主进程 bundle）。Chat 轨可加 `forge chat` / `forge group`（CP2+）。
