# `@chatvein/tools`

Agent 工具层：七大品类目录 + **MCP 优先**外部工具 + builtin jail；经 `resolveChatTools` 与路由 / 角色白名单求交后交给 L3 ReAct。

## 品类（catalog）

1. **search** — DuckDuckGo（过渡）；Brave / SerpAPI；**联网优先 MCP**
2. **compute** — Calculator、受限 `js_eval`；Wolfram（密钥）
3. **local_fs** — `read_file` / `list_dir` / `grep_search`（workspace jail）
4. **web** — `fetch_url`；复杂抓取优先 MCP
5. **news_finance** — Google Trends（SerpAPI）
6. **database** — `sqlite_query`（只读）
7. **knowledge** — Wikipedia、Stack Exchange

## MCP

```ts
import { resolveChatTools, parseMcpServersJson } from '@chatvein/tools'

const tools = await resolveChatTools({
  policy: 'full',
  workspaceRoot: '...',
  mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
})
```

设计见 `docs/design/12-Agent工具层.md`。
