# 工具选用（Tool Selection）设计方案

> 目标：在不损失任务成功率的前提下，显著降低每轮对话里「工具描述」占用的 token。
> 当前痛点是**全量加载**——路由一旦不是 trivial/simple，就把整个目录默认集（含 MCP 展开后的 30–50 个工具实例）全量塞给模型，且每轮重复发送。

---

## 1. 现状诊断

### 1.1 工具供给链

```
RouteDecision.policy.tools ('none'|'unknown'|'full')
        │
        ▼
ChatService.resolveBoundTools(agent, toolPolicy, ws)
        │  allowIds = agent.tools.length>0 ? agent.tools : 'all'
        ▼
resolveChatTools({ policy, allowIds, workspaceRoot, secrets, mcpServers })
        │  policy==='full' → 绑定目录 defaultEnabled 全集 + 有密钥工具
        │  policy==='none' → []
        ▼
LangChain createReactChatAgent({ tools: boundTools, ... })
        │  所有工具 name+description+JSON Schema 进每轮请求
        ▼
模型（每轮重复收到全部工具描述）
```

### 1.2 token 成本来源

- **目录条目 16 个**：其中 `defaultEnabled` 约 11 个（搜索 / 计算 / 本地文件 / 网页 / 数据库 / 知识库）。
- **MCP 子工具膨胀**（关键）：每个 MCP server 展开成**多个子工具实例**，且每个都带独立 JSON Schema：
  - `modsearch__*`（2）、`vmsandbox__*`（~4）、`pyodide__*`（~4）、`openfile__*`（~2）、`shellsandbox__*`（2）、`playwright__*`（~12）。
  - 实际绑定实例常达 **35–55 个**。
- 每个工具描述 + schema 约 50–200 token，合计 **每轮 2k–6k token 仅用于工具**，且**每轮重复**。

### 1.3 为什么全量

1. `ToolPolicy` 只有 `none | full` 两档（`common/src/chat/route.ts`）。`bandPolicy` 中 `standard/complex/unknown → 'full'`，即一旦需要工具就全给。
2. `resolveBoundTools` 在 `agent.tools` 未配置白名单时直接传 `'all'`，绕过任何裁剪。
3. **没有 per-turn / per-query 的工具选用**：工具集合只与「复杂度 band」有关，与「用户这轮具体要做什么」无关。

---

## 2. 设计目标

| 目标 | 量化 |
| --- | --- |
| 降低每轮工具描述 token | 综合下降 50–80% |
| 不损失任务成功率 | 需要的工具在该轮**可用**（漏选有回退） |
| 复用现有架构 | 路由 / `catalogByCategory` / `agent.tools` 白名单 / `@chatvein/context` 预算能力 |
| 行为可控、可灰度 | 分层落地，每步可独立开关与度量 |

---

## 3. 总体架构：分层选用

```
                ┌─────────────────────────────────────────┐
 query + 路由    │ 层 A 静态策略档 (none/core/full)         │  ← 已有 band，细化
                └───────────────┬─────────────────────────┘
                                │ 候选集（仍可能 30+）
                ┌───────────────▼─────────────────────────┐
 category 白名单 │ 层 B 类别过滤 (allowCategories)          │  ← agent 关注域
                └───────────────┬─────────────────────────┘
                                │ 候选集（按类缩减）
                ┌───────────────▼─────────────────────────┐
 per-turn 选用  │ 层 C Tool Selector: Top-K 相关工具         │  ← 核心降 token
                │   + BudgetGuard 预算裁剪                   │
                └───────────────┬─────────────────────────┘
                                │ 本轮实际绑定集（~6–12）
                ┌───────────────▼─────────────────────────┐
 描述压缩       │ 层 D 短描述 + MCP 子工具前缀合并           │  ← cheap win
                └───────────────┬─────────────────────────┘
                                │
                ┌───────────────▼─────────────────────────┐
 进阶（可选）   │ 层 E 按需/延迟挂载（先无工具，模型请求再挂）│
                └─────────────────────────────────────────┘
```

---

## 4. 各层设计

### 层 A — 静态策略档细化（none / core / full）

把 `ToolPolicy` 从两档扩为三档，band 映射更精细：

```ts
// common/src/chat/route.ts
export type ToolPolicy = 'none' | 'unknown' | 'core' | 'full'

// agents/src/routing/l1/defaults.ts :: bandPolicy
case 'trivial':
case 'simple':   return { ..., tools: 'none',  ... }      // 闲聊，不绑工具
case 'standard': return { ..., tools: 'core',  ... }      // 日常，只绑核心集
case 'complex':
case 'unknown':  return { ..., tools: 'full',  ... }      // 重任务，全量
```

`core` 含义（在 `resolveChatTools` 内解释为「核心类别集」）：

```ts
const CORE_CATEGORIES: ToolCategory[] = ['search', 'local_fs', 'web', 'compute']
// core = 目录中属于核心类别且 defaultEnabled 的工具（约 8–12 个，剔除冷门/密钥类）
```

`synthesizeTools` / `maxToolPolicy` 增加 `'core'` 排序：`none < core < full`。

> 影响：standard 任务工具数从 ~40 降到 ~10，**约 -50% token**，行为仅轻微变化（少了 news_finance/knowledge/database 等冷门工具）。

### 层 B — 类别白名单（allowCategories）

复用已有的 `catalogByCategory`，让 agent 配置声明「关注哪些类别」，做粗筛：

```ts
// resolveChatTools 选项新增
interface ResolveChatToolsOptions {
  policy: ToolPolicy
  allowIds?: string[] | 'all'
  allowCategories?: ToolCategory[]   // 新增：只绑这些类
  workspaceRoot?: string
  secrets?: ToolSecrets
  mcpServers?: ...
}
```

配合 `agent.tools`（已有的 id 级白名单），形成「类别粗筛 + id 精筛」两级静态过滤。

### 层 C — 动态 per-turn 选用（Tool Selector）★核心

按**当前 query + 近期上下文**从候选集里挑 Top-K 相关工具，是降 token 的最大头。

**C1 轻量规则/关键词预筛（零成本，先做）**

```ts
// @chatvein/tools/src/select.ts
export function keywordSelect(query: string, candidates: ToolCatalogEntry[]): string[] {
  // 每个 category / 工具带关键词词典，命中即入选；未命中回退全选
}
```

**C2 廉价模型分类器（复用 L1/L2 的 weak 通道）**

```ts
// 输入：query + 候选工具的 {name, shortDescription}
// 输出：相关工具 id 列表（限制 K=6~10）
export async function llmSelectTools(query: string, candidates, llmWeak): Promise<string[]>
```

复用 `ChatService.routerWithL2` 已建立的 weak 模型通道，不新增模型依赖。

**C3 预算硬裁剪（复用 `@chatvein/context`）**

```ts
import { estimateMessagesTokens } from '@chatvein/context'

export function fitToolsWithinBudget(tools: StructuredToolInterface[], budgetTokens: number) {
  // 按相关度排序，逐個加入，直到 estimateMessagesTokens(已选) 逼近 budgetTokens
  // 超出则截断（或用 truncateFolded 折叠最长描述）
}
```

`ChatService.resolveBoundTools` 改为：先 `resolveChatTools`（得候选）→ 再 `selectToolsForQuery`（得本轮绑定集）。

### 层 D — 工具描述压缩（cheap win，先做）

1. catalog 增 `shortDescription?`：给模型用**一句精简描述**，长描述留作调试/UI。
2. **MCP 子工具前缀合并**：`openfile__*` / `modsearch__*` 等各自长描述，改为「一个前缀说明 + 子命令名」即可，避免重复。
3. 过长 description 用 `truncateFolded`（已具备）折叠。

> 预计单独降 15–25%。

### 层 E — 按需/延迟挂载（进阶，行为变更）

agent 先以「无工具」运行；若模型显式声明需要某能力（如返回 `__NEED_TOOL__:<id>` 信号），再动态挂载并重跑。改动大、回复行为变，列为**可选/后续**，需单独评估与灰度。

---

## 5. 复用现有能力

| 能力 | 位置 | 用途 |
| --- | --- | --- |
| `catalogByCategory` | `@chatvein/tools` | 层 B 类别过滤 |
| `agent.tools` 白名单（id 级） | 已有 | 层 B 精筛 |
| `routerWithL2` / weak 模型通道 | `ChatService` | 层 C2 分类器 |
| `estimateMessagesTokens` / `truncateFolded` | `@chatvein/context` | 层 C3 预算裁剪 / 层 D 描述折叠 |
| `summarizeToolsForDebug` | `@chatvein/tools` | 度量：输出每轮绑定工具描述 |

> 注：`@chatvein/context` 的 `BudgetGuard` 目前仅在文档注释中规划、尚无实现，本方案用已落地的 `estimateMessagesTokens` 替代，待 BudgetGuard 落地后可无缝替换。

---

## 6. 关键度量（务必先埋点）

在 `ChatService` 现有 `toolsBound` 日志基础上，增加：

```ts
import { estimateMessagesTokens } from '@chatvein/context'
const toolsTokens = estimateMessagesTokens(
  summarizeToolsForDebug(boundTools).map((t) => ({ role:'system', content: `${t.name}: ${t.description}` }))
)
// 记录到 run artifacts：toolsCount / toolsTokens / policy / selectorUsed
```

指标：每轮 `toolsTokens`、绑定工具数、selector 命中率、任务成功率。用于 A/B 对比 `full` vs `core` vs `selector`。

---

## 7. 落地步骤（风险递增，建议顺序）

| 步骤 | 内容 | 风险 | 预期收益 |
| --- | --- | --- | --- |
| 1 | **层 D 描述压缩 + MCP 子工具前缀合并** | 极低 | -15~25% |
| 2 | **层 A core 档**（standard→core） | 低 | standard 任务 -50% |
| 3 | **层 B allowCategories** | 低 | agent 级进一步缩减 |
| 4 | **层 C1 关键词预筛 + C3 预算裁剪** | 中 | 综合 -60~80% |
| 5 | **层 C2 weak 模型分类器** | 中 | 精准度提升 |
| 6 | 层 E 按需挂载 | 高 | 极致省 token（可选） |

> 步骤 1–3 可在一个 PR 内完成且零行为回归风险；步骤 4–5 引入动态选用，需配回退与灰度。

---

## 8. 回退与风险

- **漏选回退**：Tool Selector 失败 / 置信度低 → 回退 `full`（保底不丢能力）。
- **core 档漏冷门工具**：standard 任务监控成功率；必要时把高频冷门工具升入 core。
- **行为变更评估**：层 A/C 改变模型可见工具集，需在灰度环境对比任务成功率后再全量。
- **延迟**：层 C2 引入一次 weak 模型调用，增加 ~100–300ms；可用层 C1 规则预筛兜底，避免每轮都调模型。

---

## 9. 一句话总结

> 把「全量 full」拆成 **none / core / full 三档静态策略** + **per-turn Top-K 动态选用** + **描述压缩**，并用 `estimateMessagesTokens` 做预算裁剪；先落地零风险的 D/A/B，再上动态 C，配回退与度量，可把每轮工具 token 砍掉一半以上而不丢能力。
