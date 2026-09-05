# `@chatvein/tools`

Agent 工具层：七大品类目录 + **MCP 优先**；本地文件**仅** `@modelcontextprotocol/server-filesystem`（无 builtin 读/列/grep）。

## 默认 filesystem MCP

有 `workspaceRoot` 且目录含 `mcp_filesystem` 时自动注入：

```ts
const tools = await resolveChatTools({
  policy: 'full',
  workspaceRoot: 'D:/Chatvein/workspaces',
  mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
})
// → filesystem__read_text_file / list_directory / search_files / write_file …
```

## 品类

1. **search** — DuckDuckGo（过渡）；优先其它 MCP  
2. **compute** — Calculator、`js_eval`  
3. **local_fs** — **仅 MCP**（`mcp_filesystem`）  
4. **web** — `fetch_url`  
5. **news_finance** — Google Trends  
6. **database** — `sqlite_query`  
7. **knowledge** — Wikipedia、Stack Exchange  

设计见 `docs/design/12-Agent工具层.md`。
