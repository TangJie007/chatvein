# Prompt / MCP / Tool 挂载梳理

> 版本：v1.0 ｜ 日期：2026-09-05  
> **决策状态：已落地（现状地图）**  
> 上位：[11-L3](./11-L3-ReAct自适应循环推理层.md)、[12-Agent工具层](./12-Agent工具层.md)、[10-L2](./10-L2语义路由层.md)  
> 入口代码：`app/src/main/chat/chat.service.ts`

本文只记**已实现**的挂载点与数据流，方便改 Chat / 工具时对号入座。

---

## 0 总览（一轮 Chat）

```
用户消息
  │
  ├─① L1/L1.5 →（灰区）L2          【路由 prompt：独立于主对话】
  │     └─ RouteDecision.policy.{ tools, maxSteps, modelTier, … }
  │
  ├─② systemPromptForRoute          【主对话 system prompt】
  │     agent.systemPrompt + 路由短答约束
  │
  ├─③ resolveBoundTools              【工具 + MCP】
  │     policy ∩ 角色白名单 → resolveChatTools
  │       ├─ catalog 工厂（community / builtin）
  │       └─ MCP servers → loadMcpTools（含默认 filesystem）
  │
  └─④ createReactChatAgent({ model, tools, systemPrompt })
        → invokeReactChatAgent({ message, history, recursionLimit })
```

| 挂载物 | 谁组装 | 谁消费 |
|--------|--------|--------|
| L2 system/user prompt | `@chatvein/agents` `routing/l2/prompt.ts` | L2 分类器 LLM |
| 主对话 system prompt | `ChatService.systemPromptForRoute` | `createAgent({ systemPrompt })` |
| MCP servers | `withDefaultMcpFilesystem` + `CHATVEIN_MCP_SERVERS` | `MultiServerMCPClient.getTools()` |
| StructuredTool 列表 | `resolveChatTools` | `createAgent({ tools })` |

---

## 1 Prompt 挂载

### 1.1 主对话 System Prompt（L3 ReAct）

| 步骤 | 位置 | 做什么 |
|------|------|--------|
| 存储 | `AgentConfig.systemPrompt`（Agents UI / `agent.store`） | 角色人格；主 Agent 默认可空 |
| 组装 | `chat.service.ts` → `systemPromptForRoute(agent.systemPrompt, route)` | 拼路由约束 |
| 挂载 | `createReactChatAgent({ systemPrompt })` → LangChain `createAgent` | 图内固定 system |
| 用户/历史 | `invokeReactChatAgent` → `toLangChainMessages` | 本轮 user + history；**不再**单独塞一条 SystemMessage |

路由追加规则（仅 LLM 路径；本地短路不走这里）：

| 条件 | 追加文案 |
|------|----------|
| `route.band === 'trivial'` | 友好短答、不列清单 |
| 否则且 `modelTier === 'weak'` | 一两句、不列清单 |

代码：`app/src/main/chat/chat.service.ts`（`systemPromptForRoute`）、`packages/chatvein/agents/src/react-agent.ts`。

### 1.2 L2 路由 Prompt（与主对话解耦）

| 项 | 内容 |
|----|------|
| System | 常量 `L2_SYSTEM_PROMPT`（分类器身份，禁止回答用户） |
| User | `buildL2UserPrompt(ctx, l1)`：用户原文截断 + L1 决策 JSON + 关键特征 |
| 调用 | `StructuredL2Classifier`：`[SystemMessage, HumanMessage]` 或等价 structured 调用 |
| 挂载时机 | `ChatService.routerWithL2` → `router.setL2(createL2Classifier({ model }))` |

代码：`packages/chatvein/agents/src/routing/l2/prompt.ts`、`classifier.ts`。

### 1.3 不挂 Prompt 的路径

- L1 本地短路（`greeting_only` / `self_intro` + `maxSteps≤0`）：直接 `localReplyForRoute`，**不调**主模型、不挂 system。
- `policy.tools=none|unknown`：仍可挂 system 做纯问答；工具列表为空。

---

## 2 MCP 挂载

### 2.1 配置来源（合并顺序）

```
withDefaultMcpFilesystem(...) → withDefaultMcpOpenfile(...) → withDefaultMcpModsearch(...)
  = { filesystem?, openfile?, modsearch? }  ∪  envServers
    （后者同名覆盖前者）
```

| 来源 | 键 | 说明 |
|------|-----|------|
| 自动 | `filesystem` | 有 `workspaceRoot` 且目录选中 `mcp_filesystem` 且未 `mcpFilesystem:false` |
| 自动 | `openfile` | 有 `workspaceRoot` 且目录选中 `mcp_openfile` 且未 `mcpOpenfile:false` |
| 自动 | `modsearch` | 目录选中 `mcp_modsearch` 且未 `mcpModsearch:false`（**不依赖** workspace） |
| 自动 | `vmsandbox` | 有 `workspaceRoot` 且目录选中 `mcp_vmsandbox` 且未 `mcpVmsandbox:false`（NodeVM 跑 `scripts/`） |
| 自动 | `pyodide` | 有 `workspaceRoot` 且目录选中 `mcp_pyodide` 且未 `mcpPyodide:false`（Pyodide 跑 `scripts/**/*.py`） |
| 环境变量 | `CHATVEIN_MCP_SERVERS` JSON | `parseMcpServersJson`；可覆盖同名 server |
| （未落地） | 设置页 MCP UI | 现为 mock，未写入 `resolveChatTools` |

### 2.2 默认如何起进程

`createMcpFilesystemServer(root)` / `createMcpOpenfileServer(root)` / `createMcpModsearchServer()`：

- `command` = `process.execPath`
- filesystem `args` = `[server-filesystem dist/index.js, workspaceRoot]`
- openfile `args` = `[@chatvein/mcp-openfile-sdk dist/cli.js, workspaceRoot]`
- modsearch `args` = `[@chatvein/mcp-modsearch-sdk dist/cli.js]`（可选 `--timeout=` / `--no-fallback`）
- vmsandbox `args` = `[@chatvein/mcp-vmsandbox-sdk dist/cli.js, workspaceRoot]`（可选 `--timeout=` / `--max-output=` / `--allow-any-js`）
- pyodide `args` = `[@chatvein/mcp-pyodide-sdk dist/cli.js, workspaceRoot]`（可选 `--timeout=` / `--max-output=` / `--allow-any-py`）
- Electron：`ELECTRON_RUN_AS_NODE=1`

### 2.3 拉工具

`loadMcpTools({ servers })` → `@langchain/mcp-adapters` `MultiServerMCPClient` → `getTools()`  
工具名默认带前缀：`{server}__{tool}`（如 `filesystem__read_text_file`、`openfile__open_folder`、`modsearch__web_search`、`vmsandbox__run_workspace_script`、`pyodide__run_workspace_script`）。

连接失败默认 `onConnectionError: 'ignore'`，不拖垮整轮 Chat；**无 builtin FS 后备**。

代码：`packages/chatvein/tools/src/mcp.ts`、`resolve.ts`；Chat 注入在 `resolveBoundTools`。

---

## 3 Tool 挂载

### 3.1 决策门闸（谁决定「要不要工具」）

```
L1/L2 → route.policy.tools ∈ { none, unknown, full }
  none | unknown → resolveChatTools 直接 []
  full           → 继续求交与工厂
```

### 3.2 白名单求交

```
allowIds =
  agent.tools.length > 0 ? agent.tools : 'all'
  // 空数组 = 未配置 → 视为目录默认集

selected = TOOL_CATALOG ∩ allowIds ∩ defaultEnabled/密钥/workspace 条件
```

| catalog id | 实现来源 |
|------------|----------|
| `mcp_filesystem` | **不**经工厂造同名工具；只作开关，触发 MCP `filesystem` |
| `mcp_openfile` | 同上，触发 MCP `openfile`（`open_folder`） |
| `duckduckgo_search` / `calculator` / … | community 动态 import |
| `vmsandbox__run_workspace_script` / `ensure_trusted_packages` 等 | MCP `vmsandbox`（NodeVM + 可信包安装） |
| `pyodide__run_workspace_script` / `ensure_trusted_packages` 等 | MCP `pyodide`（Pyodide + 可信包安装） |
| `fetch_url` / `sqlite_query` / `js_eval`(默认关) | builtin |

### 3.3 组装与挂到 Agent

```
resolveChatTools
  → catalog 各品类工厂 + MCP tools
  → 同名 Map：MCP 覆盖 catalog
  → StructuredToolInterface[]

ChatService:
  boundTools = resolveBoundTools(agent, policy.tools)
  createReactChatAgent({ model: llm, tools: boundTools, systemPrompt, name })
  invokeReactChatAgent(agent, { message, history, recursionLimit })
```

`recursionLimit = max(1, route.policy.maxSteps)`（trivial 本地短路除外）。

### 3.4 调试可见性

`react:request` 的 `tools` / `toolsBound` / `systemPrompt` 经 `llm_debug` 推到渲染进程 DevTools。

### 3.5 MCP Inspector（进程外调试）

根 `devDependency`：`@modelcontextprotocol/inspector`。不经过 Chat / LangChain，直接连 stdio server：

| 脚本 | 目标 |
|------|------|
| `pnpm mcp:inspect` | 空 UI，手动选 server |
| `pnpm mcp:inspect:openfile` | `packages/mcps/openfile/dist/cli.js` |
| `pnpm mcp:inspect:modsearch` | `packages/mcps/modsearch/dist/cli.js` |
| `pnpm mcp:inspect:filesystem` | 官方 `server-filesystem`，jail=`.` |
| `pnpm mcp:inspect:vmsandbox` | `packages/mcps/vmsandbox/dist/cli.js` |
| `pnpm mcp:inspect:pyodide` | `packages/mcps/pyodide/dist/cli.js` |

详见 [`packages/mcps/README.md`](../../packages/mcps/README.md)。

---

## 4 一张表：改哪里

| 你想改… | 改这里 |
|--------|--------|
| 角色人设文案 | Agents UI → `AgentConfig.systemPrompt` |
| 闲聊短答约束 | `systemPromptForRoute` 常量 |
| L2 分类规则文案 | `agents/.../l2/prompt.ts` |
| 默认有哪些 catalog 工具 | `tools/src/catalog.ts` |
| 某品类如何构造 | `tools/src/categories/*` |
| 默认 FS / openfile / modsearch MCP | `tools/src/mcp.ts` |
| 额外 MCP server | 环境变量 `CHATVEIN_MCP_SERVERS` |
| 本机调试 MCP 工具 | `pnpm mcp:inspect*` / 子包 `inspect` |
| policy → 空工具 / 满工具 | L1 rules / L2 schema 与 merge |
| 最终 bind 到图 | `react-agent.ts` `createAgent({ tools, systemPrompt })` |

---

## 5 相关链接

- 工具目录与 MCP：[12-Agent工具层](./12-Agent工具层.md)  
- L3 执行：[11-L3-ReAct自适应循环推理层](./11-L3-ReAct自适应循环推理层.md)  
- L2 路由：[10-L2语义路由层](./10-L2语义路由层.md)  
- 自研 MCP 包：[packages/mcps/README.md](../../packages/mcps/README.md)  
- 笔记：[mcp-first](../../.agents/notes/2026-09-05-mcp-first-tools.md)、[mcp-filesystem](../../.agents/notes/2026-09-05-mcp-filesystem-workspace.md)、[mcp-modsearch](../../.agents/notes/2026-09-05-mcp-modsearch.md)、[mcp-inspector](../../.agents/notes/2026-09-05-mcp-inspector.md)
