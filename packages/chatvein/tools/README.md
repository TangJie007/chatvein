# `@chatvein/tools`

Agent 工具层：按七大品类组织目录，经 `resolveChatTools` 与 `RouteDecision.policy.tools` / 角色白名单求交后交给 L3 ReAct。

## 品类

1. **search** — DuckDuckGo（默认）；Brave / SerpAPI（密钥）
2. **compute** — Calculator、受限 `js_eval`；Wolfram（密钥）
3. **local_fs** — `read_file` / `list_dir` / `grep_search`（workspace jail）
4. **web** — `fetch_url`
5. **news_finance** — Google Trends（SerpAPI）
6. **database** — `sqlite_query`（只读）
7. **knowledge** — Wikipedia、Stack Exchange

社区实现优先来自 `@langchain/community`（已 sunset，作过渡锚点）；本地危险能力自研薄封装。设计见 `docs/design/12-Agent工具层.md`。

## API

```ts
import { resolveChatTools, TOOL_CATALOG } from '@chatvein/tools'

const tools = await resolveChatTools({
  policy: 'full',
  allowIds: 'all',
  workspaceRoot: 'D:/Chatvein/workspaces',
})
```

横切：超时、输出截断、路径越界拒绝。Shell / 写文件走后续沙箱（见 `docs/design/07-沙箱方案.md`）。
