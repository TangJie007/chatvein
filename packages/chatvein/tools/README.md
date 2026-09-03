# `@chatvein/tools`

Agent 工具层：读/写文件、补丁、目录与检索、受限 shell、git、服务启动与冒烟探测。

每条工具必须超时、输出截断（经 `@chatvein/context`）、命令白名单，并写 trace。实际进程执行只走 `@chatvein/sandbox` 的 `SandboxProvider`，禁止直接 spawn 宿主任意路径。

Chat 轨由 `@chatvein/agents` 按角色白名单绑定本包工具。
