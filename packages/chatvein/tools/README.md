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

## 品类

1. **search** — **MCP modsearch**（默认）；community DDG 默认关  
2. **compute** — Calculator、`js_eval`  
3. **local_fs** — **仅 MCP**（`mcp_filesystem`、`mcp_openfile`）  
4. **web** — `fetch_url`  
5. **news_finance** — Google Trends  
6. **database** — `sqlite_query`  
7. **knowledge** — Wikipedia、Stack Exchange  

设计见 `docs/design/12-Agent工具层.md`。

## 调试 MCP

根目录：`pnpm mcp:inspect` / `mcp:inspect:openfile|modsearch|filesystem`（`@modelcontextprotocol/inspector`）。说明见 `packages/mcps/README.md`。
