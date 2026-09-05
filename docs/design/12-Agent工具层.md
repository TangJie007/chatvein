# Agent 工具层（`@chatvein/tools`）

> 版本：v0.1 ｜ 日期：2026-09-05  
> **决策状态：一期落地（目录 + 默认可跑子集 + policy 求交）**  
> 上位：[`01-核心骨架.md`](./01-核心骨架.md)、[`02-agent循环方案.md`](./02-agent循环方案.md)、[`07-沙箱方案.md`](./07-沙箱方案.md)、[`11-L3-ReAct自适应循环推理层.md`](./11-L3-ReAct自适应循环推理层.md)  
> 实现：`packages/chatvein/tools`

---

## 1 定位一句话

**工具层 = L3 可调用能力的目录与治理壳**：按品类组织工具；执行前做 `policy.tools ∩ role.tools` 求交、超时与输出截断；危险执行仍经沙箱（后续）。

| 做 | 不做 |
|----|------|
| 七大品类目录 + 工厂 + Chat 默认绑定 | 不替代 L1/L2 路由 |
| 用成熟 LangChain 集成（community / 专用包） | 不让模型「发明」工具 |
| 本地文件路径 jail（workspaceRoot） | 一期不开放任意 shell |

---

## 2 与 `@langchain/community` 的关系

| 事实 | 我们的做法 |
|------|------------|
| `@langchain/community` **已 sunset**（不再接受新集成） | 仍作一期**目录锚点**与现成实现来源（Calculator / DuckDuckGo / Wikipedia / StackExchange / Google Trends…） |
| 重要能力正向**独立包**迁移（如 `@langchain/tavily`） | 目录里标注 `source`；日后可替换实现而不改工具 id |
| 本地文件 / 受限 JS / SQLite 无合适社区工具 | **自研**薄工具，仍导出为 LangChain `StructuredTool` |

否决：整包 MCP filesystem 作为默认实现（与 [07](./07-沙箱方案.md) 工作区/白名单红线冲突）；否决自研 ReAct 循环。

---

## 3 七大品类

| 品类 id | 名称 | 一期默认可跑 | 需密钥 / 可选 |
|---------|------|--------------|---------------|
| `search` | 搜索 / 联网检索 | `duckduckgo_search` | Brave / SerpAPI / Tavily（独立包演进） |
| `compute` | 计算 & 代码执行 | `calculator`、`js_eval`（`node:vm` 受限） | Wolfram；真 shell → sandbox |
| `local_fs` | 本地文件 & 系统 | `read_file` / `list_dir` / `grep_search` | `write_file` / `exec_shell`（二期 + 沙箱） |
| `web` | 网页解析 & 爬虫 | `fetch_url`（HTTP + 去标签截断） | Cheerio/Playwright/Firecrawl |
| `news_finance` | 资讯 & 金融 | — | `google_trends`（SerpAPI key） |
| `database` | 数据库 & 查询 | `sqlite_query`（只读 SQL + 路径 jail） | Postgres/远程（二期） |
| `knowledge` | 通用知识库 & 实体 | `wikipedia`、`stackexchange` | 向量检索（CP2 memory/vector） |

工具稳定 **id**（绑定 / 白名单用）与 community 类名解耦，避免上游改名冲击路由。

---

## 4 契约

```ts
type ToolCategory =
  | 'search' | 'compute' | 'local_fs' | 'web'
  | 'news_finance' | 'database' | 'knowledge'

interface ToolCatalogEntry {
  id: string
  category: ToolCategory
  title: string
  description: string
  /** community | builtin | dedicated:<pkg> */
  source: string
  /** 无密钥时是否进入 Chat 默认集 */
  defaultEnabled: boolean
  requiresSecret?: 'serp' | 'brave' | 'tavily' | 'wolfram'
}

/** policy.none|unknown → []；full → allowIds ∩ 可构造实例 */
function resolveChatTools(options: {
  policy: 'none' | 'unknown' | 'full'
  allowIds?: string[] | 'all'
  workspaceRoot?: string
  secrets?: { serpApiKey?: string; braveApiKey?: string; tavilyApiKey?: string }
}): StructuredToolInterface[]
```

横切（一期最小）：

1. `timeoutMs`（默认按品类）  
2. `maxOutputChars` 截断  
3. 本地路径必须落在 `workspaceRoot` 内  

BudgetGuard / sandbox `exec`：L3-1 后续接满。

---

## 5 L3 绑定

```
RouteDecision.policy.tools
  none | unknown → tools=[]
  full           → resolveChatTools({ allowIds: role.tools ?? 'all', workspaceRoot })
       → createReactChatAgent({ tools })
```

app 只调 `resolveChatTools`，不散落 import community。

---

## 6 分期

| 阶段 | 内容 |
|------|------|
| **T0（今）** | 目录 + 默认可跑子集 + policy 求交 + Chat 接线 |
| **T1** | 密钥类工厂（Brave/Serp/Tavily）设置页；write 工具 + HumanConfirm |
| **T2** | 全部危险执行走 `SandboxProvider`；trace 逐步级 |
| **T3** | community 日落项迁独立包；MCP 作可选插件源 |

---

## 7 相关链接

- L3：[11-L3-ReAct自适应循环推理层](./11-L3-ReAct自适应循环推理层.md)  
- 沙箱：[07-沙箱方案](./07-沙箱方案.md)  
- 依赖：[../phase1/04-依赖选型.md](../phase1/04-依赖选型.md)  
- 代码：`packages/chatvein/tools`
