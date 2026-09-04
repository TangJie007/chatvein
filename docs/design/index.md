# 设计参考索引

深夜任务产出的架构设计文档，供评审与后续实现参考。与第一期工程文档（`../phase1/`）互补：

- **`phase1/`**：Forge 初赛轨（M0–M3）+ **Chat 产品轨（CP0–CP2）** 排期与 WBS → [`../phase1/03-开发计划书.md`](../phase1/03-开发计划书.md)
- **本目录**：角色化多智能体 / 群聊协作 / 记忆与向量 — **设计定案**；实现任务见下表「排期」列

| 文档 | 内容 | 排期（WBS） |
|------|------|-------------|
| [01-核心骨架](./01-核心骨架) | 与市面 Agent 的差异；角色 / **用户拉群** / 普通对话与**子 Agent**；`@chatvein/agents\|groups\|memory\|vector` | CP0–CP2 |
| [02-Agent 循环方案](./02-agent循环方案) | ReAct（**LangGraph createReactAgent**）、Plan-Execute（**StateGraph/orchestrator**）、群聊、Supervisor | CP0 agents；M1-7 orchestrator |
| [03-记忆方案](./03-记忆方案) | 四层记忆；省 Token；稳定前缀命中 prompt 缓存 | CP2 `memory` |
| [04-向量存储架构](./04-向量存储架构) | PGlite + pgvector 本体向量库；混合检索 | CP2 `vector` |
| [05-群组记忆架构](./05-群组记忆架构) | 共享黑板 vs 分角色视角 + 混合推荐 | CP2+ |
| [06-插件运行时 Cordis](./06-插件运行时-Cordis) | **`@deepseek-ai/cordis` 为本软件插件化标准**；与 LangGraph / Electrum 边界 | core M1-8；agents CP0-6 |
| [07-沙箱方案](./07-沙箱方案) | **已锁定**：独立工作区 + 受限 `child_process`（P0 默认）；Docker 仅 P1 | M1-5 |
| [08-流式对话与 Markdown 渲染](./08-流式对话与Markdown渲染) | LangGraph `astream` → IPC `ChatEvent`；markdown-it + Shiki + DOMPurify | CP1 |
| [09-启发式规则路由](./09-启发式规则路由) | L1 `json-rules-engine` + L1.5 内存 BM25；`RouteDecision`；**拉群仅 UI 提示、Agent 用子 Agent** | CP1 末 / CP2（R0–R2） |

> **LangGraph 分工**：不自研 Agent 循环。Forge 编码 = `orchestrator` + `StateGraph`；普通对话 = `agents` + `createReactAgent`。见 [02](./02-agent循环方案) §8、[phase1/03](../phase1/03-开发计划书.md) §1.1。
>
> 实现仍遵循红线：能力在 `@chatvein/*`，app / service 只是调用者；插件内核用 Cordis，壳用 Electrum；**内嵌沙箱用 local child_process**。
