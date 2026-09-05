# Agent 工具层（`@chatvein/tools`）

> 版本：v0.3 ｜ 日期：2026-09-05  
> **决策状态：一期落地（目录 + MCP filesystem 唯一本地文件源）**  
> 上位：[`01-核心骨架.md`](./01-核心骨架.md)、[`02-agent循环方案.md`](./02-agent循环方案.md)、[`07-沙箱方案.md`](./07-沙箱方案.md)、[`11-L3-ReAct自适应循环推理层.md`](./11-L3-ReAct自适应循环推理层.md)  
> 实现：`packages/chatvein/tools`

---

## 1 定位一句话

**工具层 = L3 可调用能力的目录与治理壳**：按品类组织；**外部与文件系统能力优先经 MCP**；执行前做 `policy.tools ∩ role.tools` 求交、超时与输出截断；危险执行仍经沙箱（后续）。

| 做 | 不做 |
|----|------|
| 七大品类目录 + Chat 绑定 | 不替代 L1/L2 路由 |
| **MCP → LangChain tools**（`@langchain/mcp-adapters`） | 不为每个第三方再写专用适配包 |
| MCP filesystem **仅允许 `workspaceRoot`** | 不把宿主任意路径暴露给模型 |

---

## 2 接入优先级：MCP 优先

```
resolveChatTools({ workspaceRoot, mcpServers, mcpFilesystem? })
  ├─ withDefaultMcpFilesystem(workspaceRoot)  → server `filesystem`
  ├─ loadMcpTools(mcpServers)
  └─ catalog / community / 其它 builtin（计算、sqlite、fetch…）
       → createReactChatAgent({ tools })
```

| 来源 | 用途 |
|------|------|
| **MCP `filesystem`** | **唯一**本地文件能力：`@modelcontextprotocol/server-filesystem`，args=`[workspaceRoot]` |
| **其它 MCP**（`CHATVEIN_MCP_SERVERS`） | 搜索、抓取、用户自带 server；可覆盖同名 `filesystem` |
| **builtin** | `js_eval` / `fetch_url` / `sqlite_query`（非 local_fs） |
| **community（过渡）** | calculator / wikipedia / duckduckgo 等 |

### 2.1 默认 MCP filesystem

- 包：`@modelcontextprotocol/server-filesystem`（workspace 依赖）
- 启动：`process.execPath` + 包内 `dist/index.js` + `workspaceRoot`（Electron 设 `ELECTRON_RUN_AS_NODE=1`）
- 工具名前缀：`filesystem__*`
- 目录项：`mcp_filesystem`（白名单用）；**无** builtin `read_file` / `list_dir` / `grep_search`
- 关闭：`resolveChatTools({ mcpFilesystem: false })` 或 env 覆盖 `filesystem` 连接

**否决**：专用 CLI 包装包作默认联网；MCP filesystem **不带** workspace 根；local_fs builtin 后备（干扰模型选型）。

其它 MCP 示例：

```bash
CHATVEIN_MCP_SERVERS='{"brave":{"command":"npx","args":["-y","@modelcontextprotocol/server-brave-search"],"env":{"BRAVE_API_KEY":"..."}}}'
```

---

## 3 与 `@langchain/community` 的关系

| 事实 | 我们的做法 |
|------|------------|
| `@langchain/community` **已 sunset** | 仅作残余过渡；新外部能力走 MCP |
| 本地文件 | **仅 MCP filesystem（限 workspace）**；无 builtin 读/列/grep |

---

## 4 七大品类

| 品类 id | 名称 | 一期默认可跑 | 需密钥 / 可选 |
|---------|------|--------------|---------------|
| `search` | 搜索 / 联网检索 | `duckduckgo_search`（过渡） | Brave / SerpAPI；**优先 MCP** |
| `compute` | 计算 & 代码执行 | `calculator`、`js_eval` | Wolfram；真 shell → sandbox |
| `local_fs` | 本地文件 & 系统 | **仅 MCP `filesystem__*`**（目录 id `mcp_filesystem`） | shell → 沙箱 |
| `web` | 网页解析 & 爬虫 | `fetch_url` | **优先 MCP 读页** |
| `news_finance` | 资讯 & 金融 | — | `google_trends` |
| `database` | 数据库 & 查询 | `sqlite_query` | 远程（二期） |
| `knowledge` | 通用知识库 & 实体 | `wikipedia`、`stackexchange` | 向量检索（CP2） |

---

## 5 契约

```ts
function resolveChatTools(options: {
  policy: 'none' | 'unknown' | 'full'
  allowIds?: string[] | 'all'
  workspaceRoot?: string
  secrets?: { … }
  mcpServers?: Record<string, McpServerConnection>
  /** 默认 true：有 workspaceRoot 时自动挂 filesystem MCP */
  mcpFilesystem?: boolean
}): Promise<StructuredToolInterface[]>

function createMcpFilesystemServer(workspaceRoot: string): McpServerConnection
function withDefaultMcpFilesystem(
  workspaceRoot: string | undefined,
  servers: Record<string, McpServerConnection> | undefined,
  enabled?: boolean,
): Record<string, McpServerConnection> | undefined
```

横切：`timeoutMs`、`maxOutputChars`；MCP filesystem 用上游目录白名单；builtin 路径 jail。

---

## 6 L3 绑定

```
RouteDecision.policy.tools = full
  → resolveChatTools({
      allowIds, workspaceRoot: settings.effectiveWorkspaceRoot,
      mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
    })
  → createReactChatAgent({ tools })
```

---

## 7 分期

| 阶段 | 内容 |
|------|------|
| **T0（今）** | 目录 + **唯一 MCP filesystem（workspace）** + env 其它 MCP |
| **T1** | MCP 设置页落盘；写操作与 `confirmWrites` 对齐 |
| **T2** | 危险执行走 `SandboxProvider`；MCP 与沙箱 cwd 统一 |
| **T3** | community 残余迁出 |

---

## 8 相关链接

- **挂载地图**：[13-Prompt-MCP-Tool挂载](./13-Prompt-MCP-Tool挂载.md)  
- L3：[11-L3-ReAct自适应循环推理层](./11-L3-ReAct自适应循环推理层.md)  
- 沙箱：[07-沙箱方案](./07-沙箱方案.md)  
- 依赖：[../phase1/04-依赖选型.md](../phase1/04-依赖选型.md)  
- 代码：`packages/chatvein/tools`
