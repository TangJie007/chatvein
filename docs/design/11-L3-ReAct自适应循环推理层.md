# L3：ReAct 自适应循环推理层（核心执行层）

> 版本：v0.1 ｜ 日期：2026-09-05  
> **决策状态：部分落地（基线 ReAct）；多阶段 / 人机确认 / 子 Agent 为演进**  
> 上位：[`02-agent循环方案.md`](./02-agent循环方案.md)、[`01-核心骨架.md`](./01-核心骨架.md)  
> 路由：[`09-启发式规则路由.md`](./09-启发式规则路由.md)、[`10-L2语义路由层.md`](./10-L2语义路由层.md)  
> 实现现状：`@chatvein/agents` `createAgent` + app `chat.service` 按 `RouteDecision` 裁剪

---

## 1 定位一句话

**L3 = 核心执行层**：在 L1/L2 给出的 `RouteDecision` 约束下，由**主模型**完成语义理解与作答，并在需要时通过 **ReAct（及后续 StateGraph）** 调用工具、派生执行。

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| L1 | 确定性分流；硬寒暄/自我介绍可本地模板 | 不理解开放域意图 |
| L2 | 灰区策略 JSON（图外） | 不回答用户、不增加 ReAct 轮次 |
| **L3** | **意图 + 推理 + 工具 + 作答** | 不自动建群；**不**由模型运行时「画任意边」 |

---

## 2 在流水线中的位置

```
用户消息
  → L1 / L1.5（± L2）
  → RouteDecision
  → app 消费 policy
       ├─ L1 greeting_only / self_intro + maxSteps=0
       │     → 本地模板（非 L3）
       └─ 否则进入 L3
            → 按 band/policy 选执行形态、裁剪工具、设 recursionLimit
            → 注入 band/tier 短答约束（trivial / weak）
            → 主模型 ReAct（现 langchain createAgent）
            → （演进）StateGraph：多阶段 / interrupt / 子 Agent
  → 助手消息 + thinking / llm_debug
```

与 [01 §7.1](./01-核心骨架.md) 对齐：路由在 Agent 执行之前；L3 即「带 policy 的 Agent.handle / ReAct」。

---

## 3 「自适应」含义

自适应 = **按 `RouteDecision.band`（及 policy）选择已预置的执行形态**，不是 Agent 现场生成 LangGraph 拓扑。

| band | 执行形态（直觉） | 图（演进目标） |
|------|------------------|----------------|
| **trivial** | 近「单边」：主模友好短答 | `user → answer`（线性） |
| **simple** | 近单边 / 极少工具 | 短 ReAct 或线性答 |
| **standard** | 标准多边：模型 ⇄ 工具 | 预置 ReAct 环（与现 `createAgent` 等价） |
| **complex** | 更复杂预置拓扑 | plan → execute → verify；可挂子 Agent 子图；可人机 interrupt |

**子图 / 边由工程画死**；Agent 只在边上走（是否调工具、是否进入子图、循环几轮）。  
L1/L2 的职责是**选哪张图 / 开哪些闸**，不是让模型画图。

### 3.1 trivial 谁回答（与 L2 对齐）

| 来源 | 谁答 |
|------|------|
| **L1** `greeting_only` / `self_intro` → trivial | **本地模板**（不调 LLM） |
| **L2**（或其它路径）拍成 `trivial` | **L3 主模型** + system「友好简短」；即使 `maxSteps=0` 也 `recursionLimit≥1` |

L2 的 trivial = 策略偏闲聊，**不**表示本地模板够用。见 [10 §4.1](./10-L2语义路由层.md)。

---

## 4 输入 / 输出契约（目标 API）

app / Cordis 只调能力包，不内嵌图细节。

```ts
/** L3 单轮执行输入 */
export interface L3RunInput {
  message: string
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  route: RouteDecision
  agent: {
    name?: string
    systemPrompt?: string
    /** 角色白名单；再与 route.policy.tools 求交 */
    toolIds?: string[]
  }
  model: /* OpenAI 兼容配置或已构造的 ChatModel */
  /** 人机确认后恢复（演进） */
  resume?: { threadId: string; decision: unknown }
}

export interface L3RunResult {
  content: string
  messages: unknown[] // LangChain BaseMessage 轨迹
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
  /** 演进：图在 interrupt 处暂停 */
  interrupted?: { kind: 'confirm'; payload: unknown }
  subAgentRuns?: Array<{ id: string; summary: string }>
}
```

对外建议稳定为：

```ts
runChatTurn(input: L3RunInput): Promise<L3RunResult>
// 日后：streamChatTurn / resumeChatTurn
```

内部实现可替换：今日 `createAgent`；明日 `createChatStateGraph(band)`。

---

## 5 现状（已落地 · L3-0）

| 项 | 现状 |
|----|------|
| 包入口 | `packages/chatvein/agents/src/react-agent.ts` |
| 循环 | `langchain.createAgent`（底层 LangGraph），**不自研 while** |
| 调用 | `invokeReactChatAgent` + `recursionLimit` |
| 步数 | `recursionLimit = max(1, route.policy.maxSteps)`；band 默认 simple=8 / standard=16 / complex=64（trivial=0） |
| 工具 | `policy.tools=full` → `@chatvein/tools` `resolveChatTools`（∩ 角色白名单）；`none/unknown` → `[]` |
| 短答约束 | `systemPromptForRoute`：`band=trivial` / `tier=weak` 注入 |
| 本地短路 | 仅 L1 `greeting_only` / `self_intro`（在 app，非 L3） |
| 子 Agent / 人机 / 多阶段图 | **未落地** |

---

## 6 演进目标（完整自适应 L3）

### 6.1 按 band 选预置图

```
trivial / simple → LinearAnswerGraph | ShortReactGraph
standard         → ReactGraph（现 createAgent 行为）
complex          → ComplexGraph
                   plan → execute(ReAct) → verify
                   + optional SubAgentFanOut（allowSubAgents）
                   + optional HumanConfirm（interrupt）
```

### 6.2 人机确认

- 图内 `interrupt`，会话挂起；UI 确认后 `resume(threadId)`  
- 适用：高风险工具、派 Forge、大范围写操作等（可与 `hintUserForge` 衔接）  
- 状态需可序列化（checkpoint / 会话挂起字段）

### 6.3 子 Agent

- 开关：`route.policy.allowSubAgents`  
- **不是拉群**；同 `Conversation` 内派生，结果汇总回父图  
- 与 BudgetGuard **共用**总步数 / 总 token（开放问题见 09）

### 6.4 横切（所有 L3 循环必接）

1. **BudgetGuard**（`@chatvein/context`）：步数 / token / 墙钟 / 连续失败  
2. **工具**：权限、超时、截断（`@chatvein/tools`）  
3. **可观测**：thinking / `llm_debug`；演进逐步级 trace  
4. **记忆**：受 `policy.memoryRecall`（CP2）

---

## 7 与 Forge / Group 边界

| 场景 | 归属 |
|------|------|
| 普通对话执行 | **L3 · `@chatvein/agents`** |
| Forge 编码任务图 | **`@chatvein/orchestrator` StateGraph**（并行轨，非 L3 替代） |
| 用户已建群 · 发言路由 | **`@chatvein/groups`**（成员单次发言仍可调用 L3） |

三套图 / 三套状态，禁止糊成一张万能图。见 [02 §8](./02-agent循环方案.md)、[01 §5.0](./01-核心骨架.md)。

---

## 8 否决与边界

| 方案 | 结论 |
|------|------|
| Agent 运行时生成任意 LangGraph 边 | **否**：不可测、不可控 |
| L3 内再挂意图分类工具 | **否**：与 L2 / 主答纠缠 |
| L3 自动建群 | **永久否决** |
| 手写 while 替代 LangGraph | **否**（调试除外） |
| Chat L3 直接复用 Forge orchestrator | **否**：语义与 checkpoint 不同 |
| L2 trivial → 本地模板 | **否**：仅 L1 硬寒暄；L2 trivial 走 L3 短答 |

---

## 9 分期落地

| 阶段 | 内容 | 依赖 |
|------|------|------|
| **L3-0（今）** | createAgent + policy 裁剪 + trivial/weak prompt | agents + app |
| **L3-1** | 工具目录求交（T0 已接）；BudgetGuard 接满；写/shell 进沙箱 | tools / context |
| **L3-2** | 对外 `runChatTurn`；内部按 band 选图（可仍单 ReAct 实现） | agents API 整理 |
| **L3-3** | complex：plan-execute 子图 + interrupt | LangGraph checkpoint |
| **L3-4** | allowSubAgents 扇出/汇合 + 共享预算 | BudgetGuard 细则 |

---

## 10 相关链接

- 循环总论：[02-agent循环方案](./02-agent循环方案.md)  
- 路由 L1/L1.5：[09-启发式规则路由](./09-启发式规则路由.md)  
- 路由 L2：[10-L2语义路由层](./10-L2语义路由层.md)  
- 代码：`packages/chatvein/agents/src/react-agent.ts`  
- 工具：[`12-Agent工具层.md`](./12-Agent工具层.md) · `packages/chatvein/tools`  
- 消费方：`app/src/main/chat/chat.service.ts`

---

## 11 一句话

**L3 是带着路由策略跑的主执行引擎：今天是 policy 约束下的 ReAct；明天是按 band 切换的预置 StateGraph——边是画死的，自适应在「选哪张图、开哪些闸」。**
