# 决策笔记：接入官方 Playwright MCP

状态：已落地

## 背景

Chat Agent 需要真实浏览器交互（点选、填表、看动态页），`fetch_url` / modsearch `read_page` 只能拿静态 HTML，不够。官方 `@playwright/mcp` 以无障碍树快照驱动，适合 LLM 工具调用。

## 决策

- `@chatvein/tools` 依赖 `@playwright/mcp`；目录 id `mcp_playwright`（品类 `web`），server 名 `playwright`，默认启用。
- `createMcpPlaywrightServer`：`process.execPath` + 包内 `cli.js`，默认 `--headless`；不依赖 `workspaceRoot`（与 modsearch 同型）。
- 关闭：`mcpPlaywright: false` 或角色白名单不含 `mcp_playwright`；可用 `CHATVEIN_MCP_SERVERS` 覆盖同名连接。

## 备选方案

### 为什么不用自研浏览器 MCP？

官方包维护浏览器能力与 MCP 工具面，符合「优先成熟第三方」。

### 为什么不用 Selenium / Puppeteer MCP？

Playwright 跨浏览器与无障碍快照更适合 Agent；生态上 `@playwright/mcp` 已是主流。

## 影响

- 首次使用前需安装浏览器：`pnpm exec playwright install chromium`（或 chrome）。
- 工具面较大，可能增加 token；角色可收紧白名单。
- Electron 下仍走 `ELECTRON_RUN_AS_NODE`；headless 避免抢焦点。
