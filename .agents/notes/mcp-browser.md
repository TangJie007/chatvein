# mcp-browser（进程内 Playwright）

## 为何不用 `@playwright/mcp` 子进程

与 `mcp-fs` / `mcp-web` 一致：桌面端走 `builtin://` 进程内 LangChain `@tool`，避免再依赖 Node/`npx`、多一份 MCP 传输与打包体积。工具名与参数对齐上游 Core + Tabs，语义上仍是「Playwright MCP 能力」。

## 为何不打包浏览器二进制

Chromium 等本体数百 MB，对桌面安装包不可接受。只依赖 `playwright` Python 包；用户本机执行 `playwright install chromium`（或设 `CHATVEIN_BROWSER_EXECUTABLE`）。探测失败则不注册 `mcp-browser` 分组。

## 安全偏离

不注册 `browser_run_code_unsafe`（上游标明 RCE-equivalent）。`browser_evaluate` 仅在页面上下文执行。上传与截图落盘限制在主空间 / `browser-output`。
