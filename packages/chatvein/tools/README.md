# `@chatvein/tools`

Agent 工具层：七大品类目录 + **MCP 优先（外部能力）**；**本地文件读写由 deepagents Composite middleware**（`/workspace/` → 盘，见 `@chatvein/agents`）；openfile / shell / 搜索等仍走 MCP。

## 默认 MCP

```ts
const tools = await resolveChatTools({
  policy: 'full',
  workspaceRoot: 'D:/Chatvein/workspaces',
  mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
})
// → openfile__* / modsearch__* / shellsandbox__* …
```

| 目录 id | server | 包 |
| --- | --- | --- |
| `state_filesystem` | — | deepagents Composite（目录描述进向量索引；组 id 保留） |
| `mcp_openfile` | `openfile` | `@chatvein/mcp-openfile-sdk` |
| `mcp_modsearch` | `modsearch` | `@chatvein/mcp-modsearch-sdk`（ModSearch → DuckDuckGo 兜底） |
| `mcp_shellsandbox` | `shellsandbox` | `@chatvein/mcp-shellsandbox-sdk`（白名单 shell/git） |
| `mcp_vmsandbox` | `vmsandbox` | `@chatvein/mcp-vmsandbox-sdk`（工作区 JS + 可信 npm） |
| `mcp_pyodide` | `pyodide` | `@chatvein/mcp-pyodide-sdk`（工作区 Python + 可信包） |
| `mcp_playwright` | `playwright` | `@playwright/mcp`（浏览器自动化，默认 headless） |

## 品类

1. **search** — **MCP modsearch**（默认）；community DDG 默认关  
2. **compute** — Calculator、**MCP vmsandbox / pyodide / shellsandbox**（工作区 scripts/ 与白名单命令）；builtin `js_eval` 默认关  
3. **local_fs** — **Composite**（`state_filesystem` 目录 + middleware）；MCP 仅 `mcp_openfile` 
4. **web** — `fetch_url`、**MCP playwright**  
5. **news_finance** — Google Trends  
6. **database** — `sqlite_query`  
7. **knowledge** — Wikipedia、Stack Exchange  

设计见 `docs/design/12-Agent工具层.md`；决策见 `.agents/notes/2026-09-07-deepagents-filesystem-composite.md`。

## 调试 MCP

根目录：`pnpm mcp:inspect` / `mcp:inspect:openfile|modsearch|shellsandbox|vmsandbox|pyodide|playwright`。说明见 `packages/mcps/README.md`。
