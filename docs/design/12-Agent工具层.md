# Agent 工具层（`@chatvein/tools`）

> 版本：v0.5 ｜ 日期：2026-09-05  
> **决策状态：一期落地（目录 + MCP filesystem / openfile / modsearch）**  
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
resolveChatTools({ workspaceRoot, mcpServers, mcpFilesystem?, mcpOpenfile?, mcpModsearch?, mcpVmsandbox?, mcpPyodide? })
  ├─ withDefaultMcpFilesystem(workspaceRoot)  → server `filesystem`
  ├─ withDefaultMcpOpenfile(workspaceRoot)    → server `openfile`
  ├─ withDefaultMcpModsearch()                → server `modsearch`（不依赖 workspace）
  ├─ withDefaultMcpVmsandbox(workspaceRoot)   → server `vmsandbox`（vm2 NodeVM；需 workspace）
  ├─ withDefaultMcpPyodide(workspaceRoot)     → server `pyodide`（Pyodide；需 workspace）
  ├─ loadMcpTools(mcpServers)
  └─ catalog / community / 其它 builtin（计算、sqlite、fetch…）
       → createReactChatAgent({ tools })
```

| 来源 | 用途 |
|------|------|
| **MCP `filesystem`** | 本地读写/列/搜：`@modelcontextprotocol/server-filesystem`，args=`[workspaceRoot]` |
| **MCP `openfile`** | 系统文件管理器打开目录：`@chatvein/mcp-openfile-sdk`（文件 → 父目录） |
| **MCP `modsearch`** | 联网搜索 / 读页：`@chatvein/mcp-modsearch-sdk`（ModSearch → DuckDuckGo 兜底） |
| **MCP `vmsandbox`** | 工作区 JS：`@chatvein/mcp-vmsandbox-sdk`（NodeVM + 可信 npm；需 workspaceRoot） |
| **MCP `pyodide`** | 工作区 Python：`@chatvein/mcp-pyodide-sdk`（Pyodide + 可信包；需 workspaceRoot） |
| **其它 MCP**（`CHATVEIN_MCP_SERVERS`） | 用户自带 server；可覆盖同名 server |
| **builtin** | `fetch_url` / `sqlite_query`；`js_eval` 默认关 |
| **community（过渡）** | calculator / wikipedia；`duckduckgo_search` 默认关 |

### 2.1 默认 MCP filesystem / openfile / modsearch / vmsandbox / pyodide

- filesystem：`@modelcontextprotocol/server-filesystem` → `filesystem__*`；目录 id `mcp_filesystem`
- openfile：`@chatvein/mcp-openfile-sdk`（`packages/mcps/openfile`）→ `openfile__*`；目录 id `mcp_openfile`
- modsearch：`@chatvein/mcp-modsearch-sdk`（`packages/mcps/modsearch`）→ `modsearch__*`；目录 id `mcp_modsearch`；**不依赖** workspace
- vmsandbox：`@chatvein/mcp-vmsandbox-sdk` → `vmsandbox__*`；目录 id `mcp_vmsandbox`；**需** workspace；默认仅 `scripts/`；require 仅工作区 node_modules，安装须过信任校验
- pyodide：`@chatvein/mcp-pyodide-sdk` → `pyodide__*`；目录 id `mcp_pyodide`；**需** workspace；默认仅 `scripts/**/*.py`；安装须过信任校验（loadPackage/micropip）
- 启动：`process.execPath` + 包内 CLI/entry（Electron 设 `ELECTRON_RUN_AS_NODE=1`）
- **无** builtin `read_file` / `list_dir` / `grep_search` / `shell.openPath`
- 关闭：`mcpFilesystem` / `mcpOpenfile` / `mcpModsearch` / `mcpVmsandbox` / `mcpPyodide: false`，或 env 覆盖同名连接

**否决**：专用 CLI 包装包作默认联网（改走 MCP modsearch）；MCP filesystem **不带** workspace 根；local_fs builtin 后备；Electron `shell.openPath` 直接绑工具。  
**注意**：vmsandbox / pyodide ≠ design/07 工作区沙箱；vm2 已停维；Pyodide 为 WASM 软隔离。

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
| `search` | 搜索 / 联网检索 | **MCP `modsearch__*`**（`mcp_modsearch`） | Brave / SerpAPI；community DDG 默认关 |
| `compute` | 计算 & 代码执行 | `calculator`、**MCP `vmsandbox__*` / `pyodide__*`** | Wolfram；builtin `js_eval` 默认关；真 shell → sandbox |
| `local_fs` | 本地文件 & 系统 | MCP `filesystem__*` + `openfile__*`（`mcp_filesystem` / `mcp_openfile`） | shell → 沙箱 |
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
  /** 默认 true：有 workspaceRoot 时自动挂 openfile MCP */
  mcpOpenfile?: boolean
  /** 默认 true：自动挂 modsearch MCP（不依赖 workspace） */
  mcpModsearch?: boolean
  /** 默认 true：有 workspaceRoot 时自动挂 vmsandbox MCP */
  mcpVmsandbox?: boolean
  /** 默认 true：有 workspaceRoot 时自动挂 pyodide MCP */
  mcpPyodide?: boolean
}): Promise<StructuredToolInterface[]>

function createMcpFilesystemServer(workspaceRoot: string): McpServerConnection
function createMcpOpenfileServer(workspaceRoot: string): McpServerConnection
function createMcpModsearchServer(opts?: { timeoutMs?: number; fallback?: boolean }): McpServerConnection
function createMcpVmsandboxServer(workspaceRoot: string, opts?: { timeoutMs?: number; maxOutputChars?: number; allowAnyJs?: boolean }): McpServerConnection
function createMcpPyodideServer(workspaceRoot: string, opts?: { timeoutMs?: number; maxOutputChars?: number; allowAnyPy?: boolean }): McpServerConnection
function withDefaultMcpFilesystem(...): ...
function withDefaultMcpOpenfile(...): ...
function withDefaultMcpModsearch(...): ...
function withDefaultMcpVmsandbox(workspaceRoot, ...): ...
```
横切：`timeoutMs`、`maxOutputChars`；MCP 用上游目录白名单；builtin 路径 jail。

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
| **T0（今）** | 目录 + MCP filesystem / openfile（workspace）+ env 其它 MCP |
| **T1** | MCP 设置页落盘；写操作与 `confirmWrites` 对齐 |
| **T2** | 危险执行走 `SandboxProvider`；MCP 与沙箱 cwd 统一 |
| **T3** | community 残余迁出 |

---

## 8 相关链接

- **挂载地图**：[13-Prompt-MCP-Tool挂载](./13-Prompt-MCP-Tool挂载.md)  
- L3：[11-L3-ReAct自适应循环推理层](./11-L3-ReAct自适应循环推理层.md)  
- 沙箱：[07-沙箱方案](./07-沙箱方案.md)  
- 依赖：[../phase1/04-依赖选型.md](../phase1/04-依赖选型.md)  
- 自研 MCP：`packages/mcps/`（[README](../../packages/mcps/README.md)）  
- **调试**：根目录 `pnpm mcp:inspect` / `mcp:inspect:openfile|modsearch|filesystem`（`@modelcontextprotocol/inspector`）  
- 代码：`packages/chatvein/tools`
