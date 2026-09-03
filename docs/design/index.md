# 设计参考索引

深夜任务产出的架构设计文档，供评审与后续实现参考。与第一期工程文档（`../phase1/`）互补：一期偏 Forge 初赛交付；本目录偏**角色化多智能体 / 群聊协作 / 记忆与向量底座**。

| 文档 | 内容 |
|------|------|
| [01-核心骨架](./01-核心骨架) | 与市面 Agent 的差异；角色 / 拉群 / 普通对话；新增 `@chatvein/agents|groups|memory|vector` |
| [02-Agent 循环方案](./02-agent循环方案) | ReAct、Plan-Execute、群聊 free、Supervisor（≥2，含选型） |
| [03-记忆方案](./03-记忆方案) | 四层记忆；省 Token；稳定前缀命中 prompt 缓存 |
| [04-向量存储架构](./04-向量存储架构) | PGlite + pgvector 本体向量库；混合检索 |
| [05-群组记忆架构](./05-群组记忆架构) | 共享黑板 vs 分角色视角（≥2）+ 混合推荐 |
| [06-插件运行时 Cordis](./06-插件运行时-Cordis) | **`@deepseek-ai/cordis` 为本软件插件化标准**；与 LangGraph / Electrum 边界 |
| [07-沙箱方案](./07-沙箱方案) | **已锁定**：独立工作区 + 受限 `child_process`（P0 默认）；Docker 仅 P1 |
| [08-流式对话与 Markdown 渲染](./08-流式对话与Markdown渲染) | LangGraph `astream` → IPC `ChatEvent`；执行过程与正文分离；markdown-it + Shiki/hljs + DOMPurify 流式渲染 |

> 实现仍遵循红线：能力在 `@chatvein/*`，app / service 只是调用者；插件内核用 Cordis，壳用 Electrum；**内嵌沙箱用 local child_process**。
