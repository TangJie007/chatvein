# Agent 工具层（`@chatvein/tools`）

> 版本：v0.2 ｜ 日期：2026-09-05  
> **决策状态：一期落地（目录 + builtin + MCP 优先接入）**  
> 上位：[`01-核心骨架.md`](./01-核心骨架.md)、[`02-agent循环方案.md`](./02-agent循环方案.md)、[`07-沙箱方案.md`](./07-沙箱方案.md)、[`11-L3-ReAct自适应循环推理层.md`](./11-L3-ReAct自适应循环推理层.md)  
> 实现：`packages/chatvein/tools`

---

## 1 定位一句话

**工具层 = L3 可调用能力的目录与治理壳**：按品类组织本地/过渡工具；**外部能力优先经 MCP** 接入；执行前做 `policy.tools ∩ role.tools` 求交、超时与输出截断；危险本地执行仍经沙箱（后续）。

| 做 | 不做 |
|----|------|
| 七大品类目录 + 工厂 + Chat 默认绑定 | 不替代 L1/L2 路由 |
| **MCP servers → LangChain tools**（`@langchain/mcp-adapters`） | 不为每个第三方再写专用适配包 |
| 本地文件路径 jail（workspaceRoot） | 一期不把 MCP filesystem 设为默认越权源 |

---

## 2 接入优先级：MCP 优先

```
resolveChatTools
  ├─ catalog / builtin / community（过渡）
  └─ loadMcpTools(mcpServers)   ← 同名覆盖 catalog
       → createReactChatAgent({ tools })
```

| 来源 | 用途 |
|------|------|
| **MCP**（`CHATVEIN_MCP_SERVERS` / 后续设置页） | 搜索、抓取、第三方集成、用户自带 server |
| **builtin** | workspace jail 内读文件 / 列目录 / grep / sqlite / 轻量 `fetch_url` / `js_eval` |
| **community（过渡）** | calculator / wikipedia / duckduckgo 等，待迁出或改由 MCP 替代 |

**否决**：再引入 `@tools/modsearch` 一类「CLI 包装包」作为默认联网；否决整包默认 MCP filesystem 绕过 [07](./07-沙箱方案.md) jail；否决自研 ReAct 循环。

配置示例（环境变量 JSON，与 `MultiServerMCPClient` 的 `mcpServers` 同形）：

```bash
CHATVEIN_MCP_SERVERS='{"brave":{"command":"npx","args":["-y","@modelcontextprotocol/server-brave-search"],"env":{"BRAVE_API_KEY":"..."}}}'
```

---

## 3 与 `@langchain/community` 的关系

| 事实 | 我们的做法 |
|------|------------|
| `@langchain/community` **已 sunset** | 仅作残余过渡；新外部能力走 MCP |
| 本地文件 / 受限 JS / SQLite | **自研** builtin + workspace jail |

---

## 4 七大品类

| 品类 id | 名称 | 一期默认可跑 | 需密钥 / 可选 |
|---------|------|--------------|---------------|
| `search` | 搜索 / 联网检索 | `duckduckgo_search`（过渡） | Brave / SerpAPI；**优先 MCP** |
| `compute` | 计算 & 代码执行 | `calculator`、`js_eval` | Wolfram；真 shell → sandbox |
| `local_fs` | 本地文件 & 系统 | `read_file` / `list_dir` / `grep_search` | write / shell（二期 + 沙箱） |
| `web` | 网页解析 & 爬虫 | `fetch_url` | **优先 MCP 读页** |
| `news_finance` | 资讯 & 金融 | — | `google_trends` |
| `database` | 数据库 & 查询 | `sqlite_query` | 远程（二期） |
| `knowledge` | 通用知识库 & 实体 | `wikipedia`、`stackexchange` | 向量检索（CP2） |

工具稳定 **id** 与实现源解耦。MCP 工具名默认带 `{server}__` 前缀。

---

## 5 契约

```ts
function resolveChatTools(options: {
  policy: 'none' | 'unknown' | 'full'
  allowIds?: string[] | 'all'
  workspaceRoot?: string
  secrets?: { serpApiKey?: string; braveApiKey?: string; tavilyApiKey?: string }
  mcpServers?: Record<string, McpServerConnection>
}): Promise<StructuredToolInterface[]>

function loadMcpTools(options: {
  servers: Record<string, McpServerConnection>
  onConnectionError?: 'throw' | 'ignore'
}): Promise<StructuredToolInterface[]>
```

横切：`timeoutMs`、`maxOutputChars`、workspace 路径 jail。

---

## 6 L3 绑定

```
RouteDecision.policy.tools
  none | unknown → tools=[]
  full           → resolveChatTools({ allowIds, workspaceRoot, mcpServers })
       → createReactChatAgent({ tools })
```

app 只调 `resolveChatTools` / `parseMcpServersJson`。

---

## 7 分期

| 阶段 | 内容 |
|------|------|
| **T0（今）** | 目录 + builtin + `loadMcpTools` + env 注入 |
| **T1** | MCP 设置页落盘（替换 mock UI）；密钥类少用 community |
| **T2** | 危险执行走 `SandboxProvider`；MCP filesystem 仅限 workspace |
| **T3** | community 残余迁出 |

---

## 8 相关链接

- L3：[11-L3-ReAct自适应循环推理层](./11-L3-ReAct自适应循环推理层.md)  
- 沙箱：[07-沙箱方案](./07-沙箱方案.md)  
- 依赖：[../phase1/04-依赖选型.md](../phase1/04-依赖选型.md)  
- 代码：`packages/chatvein/tools`
