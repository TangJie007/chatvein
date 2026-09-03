# `@chatvein/sandbox`

内嵌沙箱（**已锁定**）：独立工作区 + 受限 Node `child_process`（`local`）。零外部服务，不依赖 Docker。

工作区在 `runs/<run_id>/workspace/`，带路径 jail、cwd/env/命令白名单、超时与输出截断。`tools` 与 `verifier` 一律经 `SandboxProvider` 执行。

Docker 仅 P1，作为可选 `SandboxProviderKind = 'docker'`。详见 [`docs/design/07-沙箱方案.md`](../../../docs/design/07-沙箱方案.md)。
