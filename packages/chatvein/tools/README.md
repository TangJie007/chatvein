# `@chatvein/tools`

Agent 工具层：七大品类目录 + **MCP 优先**；本地文件经 MCP filesystem / openfile；联网经 MCP modsearch。

## 默认 MCP

```ts
const tools = await resolveChatTools({
  policy: 'full',
  workspaceRoot: 'D:/Chatvein/workspaces',
  mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
})
// → filesystem__* / openfile__* / modsearch__web_search / modsearch__read_page
```

| 目录 id | server | 包 |
| --- | --- | --- |
| `mcp_filesystem` | `filesystem` | `@modelcontextprotocol/server-filesystem` |
| `mcp_openfile` | `openfile` | `@chatvein/mcp-openfile-sdk` |
| `mcp_modsearch` | `modsearch` | `@chatvein/mcp-modsearch-sdk`（ModSearch → DuckDuckGo 兜底） |
| `mcp_vmsandbox` | `vmsandbox` | `@chatvein/mcp-vmsandbox-sdk`（工作区 JS + 可信 npm） |
| `mcp_pyodide` | `pyodide` | `@chatvein/mcp-pyodide-sdk`（工作区 Python + 可信包） |
| `mcp_playwright` | `playwright` | `@playwright/mcp`（浏览器自动化，默认 headless） |

## 品类

1. **search** — **MCP modsearch**（默认）；community DDG 默认关  
2. **compute** — Calculator、**MCP vmsandbox / pyodide**（工作区 `scripts/`）；builtin `js_eval` 默认关  
3. **local_fs** — **仅 MCP**（`mcp_filesystem`、`mcp_openfile`）  
4. **web** — `fetch_url`、**MCP playwright**  
5. **news_finance** — Google Trends  
6. **database** — `sqlite_query`  
7. **knowledge** — Wikipedia、Stack Exchange  

设计见 `docs/design/12-Agent工具层.md`。

## 调试 MCP

根目录：`pnpm mcp:inspect` / `mcp:inspect:openfile|modsearch|vmsandbox|pyodide|playwright|filesystem`。说明见 `packages/mcps/README.md`。

浏览器二进制（首次）：`pnpm exec playwright install chromium`
