# `@chatvein/tools`

Agent 工具层：七大品类目录 + **MCP 优先**（默认挂 workspace 的 `server-filesystem`）+ builtin 后备。

## 默认 filesystem MCP

有 `workspaceRoot` 时自动注入：

```ts
import { resolveChatTools } from '@chatvein/tools'

const tools = await resolveChatTools({
  policy: 'full',
  workspaceRoot: 'D:/Chatvein/workspaces',
  // mcpFilesystem: false, // 可关；则只用 builtin 读/列/grep
  mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
})
// → filesystem__read_text_file / list_directory / search_files / write_file …
```

实现：`createMcpFilesystemServer(root)` → `node @modelcontextprotocol/server-filesystem/dist/index.js <root>`。

## 品类（catalog）

1. **search** — DuckDuckGo（过渡）；**优先其它 MCP**
2. **compute** — Calculator、`js_eval`
3. **local_fs** — **MCP filesystem**；builtin 读/列/grep 仅 MCP 失败时
4. **web** — `fetch_url`
5. **news_finance** — Google Trends
6. **database** — `sqlite_query`
7. **knowledge** — Wikipedia、Stack Exchange

设计见 `docs/design/12-Agent工具层.md`。
