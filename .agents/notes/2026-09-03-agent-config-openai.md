# 决策笔记：Agent 配置落主进程 JSON 持久化，一期仅 OpenAI 兼容协议

状态：已落地

## 背景

Forge 需要在桌面端配置两类 Agent：一组可创建的「角色 Agent」，以及一个全局唯一、主对话窗口默认路由的「主对话 Agent」。配置要能在重启后保留、按角色隔离 API Key，并在 UI 里验证端点是否可用。硬约束来自现有架构：Electron 壳只是调用者，能力与持久化不放渲染进程；渲染进程 `nodeIntegration:false`，不能直接读写文件；一期所有模型网关都走 OpenAI 兼容 `/v1/chat/completions`。

## 决策

Agent 配置的存取与连通性测试放在 **Electron 主进程**的 `AgentModule`，渲染端只经 IPC 访问：

- 类型与预设：`app/src/main/agent/agent.types.ts` 定义 `AgentConfig`、固定的 `MAIN_AGENT_ID = 'main'`、OpenAI 兼容 provider 预设（DeepSeek / OpenAI / 通义 / Moonshot / 本地 Relay / 自定义）。
- 持久化：`agent.store.ts` 把整份配置写到 `userData/forge/agents.json`，原子写（临时文件 + rename），首次启动写入内置默认，加载时做轻量迁移并保证主对话 Agent 始终存在。
- 业务逻辑：`agent.service.ts` 提供增删改查；主对话 Agent 不可删除、不可停用；`testConnection()` 直接对 `{baseUrl}/chat/completions` 发 `max_tokens:1` 的请求判断可达性 / Key / 模型，15s 超时，401 给出友好提示。
- IPC 通道（`agent.controller.ts`，前缀 `agent:`）：`list / get / create / update / remove / presets / test`。
- 渲染端：`ipc-api.ts` 声明同名契约类型；`composables/useAgents.ts` 提供模块级单例 store；`AgentsView.vue` 编辑表单从已存配置克隆（保存前不改共享状态），`AgentListPane.vue` 分「主对话 / 已创建角色」两区并数据驱动。

`protocol: 'openai'` 字段在模型上预留，当前所有 provider 统一走 OpenAI 兼容协议。

## 备选方案

**放 sidecar（`@chatvein/service`）持久化**：能力包红线是「重活在 `@chatvein/*`」。但 Agent 配置是桌面壳的本地偏好，sidecar 尚未落地，且配置要被 Settings/Agents 界面直接读写；为一份 JSON 提前引入 stdio 通信不划算。配置属「壳偏好」而非 harness 运行时能力，故放主进程；未来 harness 真正消费模型配置时，再由主进程把所需配置经协议下发 sidecar。

**用 electron-store / 写在渲染进程 localStorage**：localStorage 在渲染进程、随清缓存丢失且无法被主进程/未来 sidecar 共享；electron-store 引入额外依赖。一份带版本号、原子写的 JSON 文件足够单机单用户场景，且后续可平移到 PGlite。

**一期就抽象多协议（OpenAI + Anthropic 原生 + ...）**：当前网关与各 provider 均可用 OpenAI 兼容接口覆盖，提前抽象协议层只会增加未验证的分支。保留 `protocol` 字段，等确有非兼容 provider 时再扩。

**连通性测试走 harness 的 `@chatvein/models`**：`@chatvein/models` 目前仍是占位 stub，且测试只需验证端点/Key/模型，不必拉起整条模型抽象。主进程用原生 `fetch` 直连最小请求，简单且无依赖。

## 影响

- 收益：配置持久化、按角色隔离 Key、主对话 Agent 有稳定锚点（`id:'main'`）供后续对话路由；UI 测试连接反映真实可达性；零新增第三方依赖。
- 代价 / 放弃：配置存主进程而非能力包，与「能力全在 `@chatvein/*`」的红线有一处刻意例外（壳偏好）；JSON 文件无并发/事务保证（单机单用户可接受）；测试连接会发出一次真实网络请求（`max_tokens:1`，成本可忽略）。
- 后续注意：接入实际对话时，主进程需把选定 Agent 的 `baseUrl/apiKey/model` 传给模型层或 sidecar；若改多协议，扩 `protocol` 与 service 的请求构造；配置量级若显著增长或需结构化查询，再迁到 PGlite。
