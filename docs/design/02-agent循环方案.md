# Agent 循环方案设计

> 版本：v0.1 ｜ 日期：2026-09-03
> 上位：[`01-核心骨架.md`](./01-核心骨架.md) ｜ 记忆：[`03-记忆方案.md`](./03-记忆方案.md)
> 本文给出**至少 2 个**可落地的 Agent 循环（control loop）方案，并针对"普通对话"和"群组协作"分别选型。

---

## 1 什么是 Agent 循环

Agent 循环 = 模型在"思考 → 行动 → 观察"之间反复，直到任务完成的控制结构。它决定：何时调用工具、何时把控制权交给别的 Agent、何时收敛、何时停止（省 token / 防死循环）。

Forge 有两类场景，循环不同：

- **单 Agent**（普通对话 / 群里某个成员发言）：模型自主决定工具调用。
- **多 Agent**（群组协作）：在单 Agent 循环之上加一层"**发言路由 / 编排**"，决定下一个说话的是谁。

---

## 2 方案一：ReAct 循环（单 Agent 基线，P0 默认）

**Thought → Action（工具）→ Observation → … → Answer**

```
loop:
  ctx = buildContext(system + persona + 记忆检索 + 最近消息 + 工具结果)
  resp = llm(ctx, tools)            # 模型决定：直接回答 或 调工具
  if resp.tool_calls:
     for call in resp.tool_calls:
        result = runTool(call)      # 权限→超时→截断（@chatvein/tools）
        appendObservation(result)
     continue                        # 回到循环，模型看到结果继续
  else:
     return resp.content            # 终止
```

特点：
- 实现最简，LangChain `createReactAgent` / 手写 tool-calling 循环即可；
- 每轮都把"思考+工具结果"追加进上下文，**上下文单调增长**，依赖 [`03-记忆方案.md`](./03-记忆方案.md) 的压缩/截断控制 token；
- 终止条件：模型不再调工具（给答案）、达到步数上限、预算熔断（`@chatvein/context` BudgetGuard）。

适用：普通对话、群成员的单次发言、Forge 的 implement/fix 节点内的"写代码"小循环。

优点：简单、可控、易调试（trace 线性）。缺点：长任务里容易"走一步看一步"，缺全局规划。

---

## 3 方案二：Plan-and-Execute（规划-执行，长任务/编码）

先让强模型产出**任务计划**，再逐个执行，执行结果回灌、必要时重规划。

```
plan      = planner(目标 + 记忆)          # 强模型，输出 step[]（带验收标准）
for step in plan:
    result = executor(step, 工具, 记忆)    # 可用 ReAct 或专用子图
    verify  = verifier(result)            # 结构化验收（Forge 已有 build/test）
    if verify.fail and retries < N:
        replan(step, 失败关键帧)          # 只针对该步重规划，不推倒重来
finalize  = summarizer(全部结果)
```

特点：
- 规划与执行分离，**planner 用强模型、executor 可用中档**，省 token；
- 计划是结构化的，天然对应 [`01-核心骨架.md`](./01-核心骨架.md) 的任务树和 LangGraph 状态机（Forge orchestrator 就是这个范式）；
- 有明确验收节点，防止"模型自述完成"。

适用：Forge 自动写代码-测试-修复主流程；群里派单后的执行。

优点：全局观强、可断点续跑（每步是 checkpoint）、易并行（P1）。缺点：规划错误会传导，需要 replan 机制；比 ReAct 重。

---

## 4 方案三：群组讨论循环（多 Agent，自由/@驱动）

群里每个成员是一个单 Agent（方案一），外层加一个**发言路由器**：

```
appendMessage(msg)                      # 用户或某角色发言
loop until 收敛:
  speaker = routeNextSpeaker(群状态)     # 见下
  if speaker == null: break             # 无人可接 → 收敛
  out = agents[speaker].handle(群上下文)  # 该角色 ReAct/回答（可带工具）
  broadcast(out)                        # 进消息流 + trace
  if out.kind == 'decision' or 主持人判定一致: break
```

**下一个发言者 `routeNextSpeaker` 的规则（free 模式）：**
1. 最新消息里有 `@mentions` → 被 @ 的角色；
2. 某条消息是提问且内容命中某角色 `expertise` → 推荐该角色（可让主持人确认）；
3. 超过 K 轮没人被 @ → 主持人接管点名；
4. 同一角色连续发言 ≥2 次 → 强制换人或交主持人（防独角戏烧 token）。

群上下文（发给每个发言者的 prompt）= 群议题 + 本人角色人设 + **群组记忆检索结果**（[05 文档](./05-群组记忆架构.md)）+ 最近 N 条消息（更早的用摘要）。

适用：开放式讨论、方案评审、多视角辩论。优点：灵活、类企业微信直觉。缺点：容易跑题/话痨，需主持人与轮次/预算约束。

---

## 5 方案四：主持人编排循环（Supervisor / 结构化多 Agent）

由一个**主持人 Agent**（强模型）中心化调度，类似 LangGraph supervisor：

```
loop:
  state = { 目标, 已完成, 待办, 群消息摘要 }
  decision = facilitator(state)
     → { speak: roleId, task: subTask }   # 点名谁、做什么
     → { converge: conclusion }           # 宣布收敛
  if converge: break
  result = agents[decision.speak].handle(decision.task, 上下文)
  reportBack(result)                      # 结果回给主持人（不是群聊全文）
```

特点：
- 主持人掌握"全局状态摘要"，工作者只收到**自己那一份子任务**，**上下文最小、最省 token**；
- 发言顺序由模型显式决策，比 free 模式更可控；
- 天然支持"分工 → 汇总"，可叠加投票（各角色给方案 → 主持人裁决）。

适用：复杂任务拆解、角色分工明确的协作、需要严格控成本的比赛场景。缺点：主持人是单点/瓶颈，主持人 prompt 质量决定一切；不如 free 模式自然。

---

## 6 方案对比与选型

| 维度 | ① ReAct | ② Plan-Execute | ③ 群聊 free | ④ Supervisor |
|------|---------|----------------|-------------|---------------|
| 层级 | 单 Agent | 单/多步 | 多 Agent（去中心化） | 多 Agent（中心化） |
| 实现成本 | 低 | 中 | 中 | 中高 |
| Token 消耗 | 中（上下文增长） | 中低（分级模型） | **高**（人人看群） | **低**（只发子任务） |
| 可控性 | 中 | 高（有验收） | 低（易跑题） | 高 |
| 可观测 | 线性 trace | 任务树 trace | 群消息流 | 调度+子任务 trace |
| 适合 | 普通对话/单步 | 编码长任务/Forge | 开放讨论/评审 | 分工协作/控成本 |

**选型建议（一期）：**

- **普通对话**：方案① ReAct（P0）。
- **Forge 自动编码主流程**：方案② Plan-Execute（即现有 LangGraph orchestrator）。
- **群组协作**：P0 先用方案③ free（@驱动，最像企业微信、体验直观）；**比赛/控成本场景切方案④ Supervisor**（上下文最小、最省 token）。两者共用同一批角色 Agent，只是外层路由器不同，可在群 `mode` 字段切换（`free` / `facilitated` / `vote`）。

---

## 7 通用控制要素（所有循环都必须有）

无论哪种循环，统一接这些横切能力（已有包）：

1. **预算护栏**（`@chatvein/context` BudgetGuard）：token / 步数 / 墙钟 / 连续失败超限即停。群聊额外加"每角色最大轮次""群最大消息数"。
2. **工具治理**（`@chatvein/tools`）：角色权限 → 白名单 → 超时 → 输出截断 → trace。
3. **记忆读写**（`@chatvein/memory`）：每轮开始检索相关记忆，结束写回事实/摘要（[03 文档](./03-记忆方案.md)）。
4. **可观测**（`@chatvein/observability`）：每次思考/工具/发言/路由决策都落 trace；群里路由决策也要记录（"为什么点他发言"），便于复盘。
5. **人在环**：普通对话可中断；群聊用户可随时 @、插入指令、暂停、终止、要求收敛。
6. **终止判定**：单 Agent = 无工具调用/给答案；群 = `decision`/投票胜出/主持人宣布/触发护栏。

---

## 8 与 LangGraph 的映射

- 方案①：`createReactAgent`（langgraph）或手写 while 循环 + tool node。
- 方案②：`StateGraph`（plan → dispatch → execute → verify → replan → finalize），checkpoint 落 sqlite（已有依赖）。
- 方案④：LangGraph **supervisor** 模式（supervisor node 路由到各 agent node，条件边回到 supervisor 或 END）。
- 方案③：在 supervisor 基础上把"路由"替换为规则（@ / expertise），或用群消息图（group chat graph）。

> 一期落地顺序：先①打通单 Agent 与普通对话 → 再③free 拉群 → 再④Supervisor 控成本；②复用 Forge 已有 orchestrator。
