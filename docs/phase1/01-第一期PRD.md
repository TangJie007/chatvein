# Forge 第一期开发 PRD（初赛版 · 工程落地）

> 版本：v1.0 ｜ 日期：2026-09-03 ｜ 作者：唐杰
> 上位文档：仓库根目录 `PRD-Forge-v1.md`（产品总 PRD）
> 配套文档：[`02-方案设计.md`](./02-方案设计.md)（技术设计）、[`03-开发计划书.md`](./03-开发计划书.md)（排期与任务）

---

## 1 本期定位

总 PRD 定义了 Forge 这个"把需求文档自动变成可运行软件"的 Agent Harness。本期（第一期 / 初赛版）要回答的工程问题是：**这些能力在代码里放在哪、以什么形态交付。**

本期确立一条不可动摇的架构约束：

> **`packages/chatvein/*` 提供 Harness 的全部能力；`app`（Electron 控制台）和 Node 服务（`@chatvein/service`）都只是能力的调用者。**

- 能力包 = 纯 Node/TypeScript，**零 Electron 依赖**，可被 Electron 主进程和独立 Node 进程同时复用；
- app = 桌面 GUI，只做"调接口 + 画界面 + 发人工干预"，不含 Agent 业务逻辑；
- Node 服务 = 无头运行器（CLI + sidecar），用于无人值守、崩溃隔离、回归基线。

一期目标对应总 PRD 的 **M0–M2**（基线 → 骨架 → 成型），在 9/20 研习营结束前达到"可参赛状态"，9/21–9/30 初赛每日演练调优。

---

## 2 一期目标与成功指标

| 目标 | 衡量 | 一期目标值 |
|------|------|-----------|
| 可复现 | 同一需求重复运行结果稳定 | 3 次运行通过率标准差 ≤ 5% |
| 可观测 | 每次模型/工具/干预留痕 | trace 事件落盘率 100% |
| 可信验证 | 完成必须有 verify 证据 | 禁止模型自述完成，100% 经 build+test |
| 端到端跑通 | 练习赛题无人值守跑完 | 无人值守成功率 100%（小需求） |
| 本地自测代理指标 | 内置冒烟用例通过率 | ≥ 90% |
| Token 效率 | 相对 M0 基线 | ≤ 基线 × 0.8（目标） |
| 黑盒通过率 | 赛事 GUI 用例 | ≥ 85%（初赛期冲刺） |

---

## 3 范围

### 3.1 一期必做（P0）

| 编号 | 能力 | 归属包 | 对应总 PRD |
|------|------|--------|-----------|
| F1 | 需求导入与任务树预览（本地解析 + 模型抽取 + JSON 校验） | `compiler` + app | M2 |
| F2 | LangGraph 主状态机 plan→dispatch→implement→verify→diagnose→fix→integrate→finalize | `orchestrator` | M3 |
| F3 | Checkpoint 断点续跑（文件持久化） | `orchestrator` + `service` | M3 |
| F4 | 全局预算护栏（Token/步数/墙钟/连续失败熔断） | `context` + `orchestrator` | M3/M5 |
| F5 | 工具层：read/write/patch/list/glob/grep/exec/git | `tools` | M4 |
| F6 | 工具超时 + 输出截断 + 命令白名单 | `tools` + `context` | M4/M5 |
| F7 | 模型网关：OpenAI 兼容适配 + 强中弱分级 + 降级链 + 计量 + 并发控制 | `models` | M7 |
| F8 | 沙箱：独立工作区 + 受限子进程 + 环境快照 | `sandbox` | M8 |
| F9 | 上下文管理：截断、错误关键帧、任务级历史压缩、文件索引 | `context` | M5 |
| F10 | 验证闭环：build + test 解析为结构化失败报告 | `verifier` | M6 |
| F11 | 失败归因 + 定向修复循环（重试上限） | `orchestrator` + `verifier` | M6 |
| F12 | Trace 事件总线 + JSONL 落盘 + payload 分片 | `observability` | M9 |
| F13 | 运行报告 report.md（三项指标 + 失败清单 + 环境/参数快照） | `observability` | M9/M10 |
| F14 | Harness 门面（start/pause/abort/resume/intervene/onEvent） | `core` | 贯穿 |
| F15 | Node 无头运行器：CLI `forge run/resume/regression` | `service` | 场景 1/5 |
| F16 | sidecar 模式：app spawn service，事件回流，崩溃可续跑 | `service` + app | 非功能-稳定性 |
| F17 | 控制台：任务树 / Trace 时间线 / Token 与预算面板 / 开始-暂停-终止-注入提示 | app | M1 |
| F18 | 参数配置：模型分级、并行度（一期固定串行）、预算上限、重试上限 | app + `common` 配置 | M1 |
| F19 | 提交检查清单（产物完整、git 时间戳、干净目录可重建） | `verifier`/`observability` | M10 |

### 3.2 一期不做（P1/P2，预留接口不实现）

- 任务级并行子图（dispatch 预留 `parallel_group`，一期串行）。
- Docker/WSL2 容器沙箱（预留 `SandboxProvider` 接口，一期本地子进程）。
- 两次运行对比视图、静态检查阻断（lint 仅记录）、Prompt 缓存、服务启动/冒烟探测工具、运行报告导出之外的高级分析。
- 第二期：增量变更需求支持、远程/多机。

### 3.3 一期边界约束（架构红线）

1. `packages/chatvein/**` 内**不得** `import 'electron'`（CI 断言）。
2. app 主进程的 forge 模块只允许调用 `@chatvein/core` 门面或 sidecar 协议，**不得**内嵌 LangGraph/模型/工具逻辑。
3. CLI 与 GUI 必须跑同一份能力代码，行为一致（不允许各写一套）。
4. 所有工具输出进上下文前必须经过截断器；所有 `exec` 必须过白名单。
5. "完成"只能由 verify 的结构化输出判定。
6. **Harness 插件化统一使用 `@deepseek-ai/cordis`**；禁止混装上游 `cordis` / `@cordisjs/*`；禁止 `@electrum/*` / 渲染进程 import Cordis。

---

## 4 用户场景（一期覆盖）

| 场景 | 一期支持方式 |
|------|-------------|
| 一次完整交付 | app 导入需求 → 预览任务树 → 配置 → 开始锻造 → 挂机 → 出报告；或 CLI `forge run` |
| 练习调优 | 改配置（模型分级/预算）→ 重跑 → 看 Token/时间面板（对比视图 P1，一期用 report.md 对比） |
| 卡死归因 | 时间线展开事件 → 看 payload 原文（payload_ref 分片） |
| 人工干预（练习期） | 控制台暂停 → 注入提示 / 手改 workspace 文件 → 继续；干预写 trace |
| 回归基线 | `forge regression`（固定需求 + seed）出指标对比；M0 先用 Claude Code 实测基线写入 baseline.json |

---

## 5 功能需求要点（详细字段以总 PRD 为准）

数据结构（`Task / GraphState / TraceEvent / TokenStat / Budget / TestReport / ForgeConfig`）统一在 `@chatvein/common` 定义，字段与总 PRD 5.3.2 / 5.3.3 / 5.3.9 完全一致，此处不重复。一期要点：

- **F1 需求编译**：Markdown 章节切分（本地、零调用）→ 按章节模型抽取 → JSON Schema 校验失败重试 1 次，再失败降级为单任务 → 拓扑排序落 `tasks.json`。
- **F2 编排**：节点、边条件、护栏阈值与总 PRD 5.3.3 相同；模型档：plan/implement/fix=强，diagnose/integrate=中，压缩=弱。
- **F5/F6 工具**：工具清单与超时（read 5s / patch 10s / exec 300s / git 30s）同总 PRD 5.3.4；exec 白名单 npm/pnpm/node/git/lint/构建/测试。
- **F7 模型**：OpenAI 兼容 baseURL；强中弱三档可配；失败自动切备用并留痕，重试 ≤3；按模型计量。
- **F9 上下文**：头尾截断 + 中间折叠标注；错误只回传栈/失败用例/断言差异；每任务结束压缩历史；上下文只放文件摘要+签名。
- **F10/F11 验证**：build/test 在沙箱执行，解析为结构化失败；diagnose 输出责任文件+根因；fix 只改责任文件；重试上限默认 3。
- **F12/F13 可观测**：事件总线扇出到 JSONL / UI / 预算聚合；大 payload 落 `payloads/`，上下文只存 ref；UI 推送节流 100ms、Token 500ms。
- **F15/F16 service**：CLI 子命令 `run/resume/preview/regression`；sidecar 用 stdio 行分隔 JSON（start/pause/abort/intervene/resume + 事件流）。
- **F17 控制台**：顶部工具条（开始/暂停/终止/运行 ID/状态/计时）、左任务树、中时间线、右诊断（Token/错误/预算进度）、底部日志（P1 可折叠）。视觉沿用品牌薄荷青 #4BD8BA、浅色、无框线分层（总 PRD 第 8 节）。

---

## 6 非功能需求（一期）

| 类别 | 要求 |
|------|------|
| 平台 | Windows 11 优先，兼容 macOS |
| 稳定性 | Agent 运行在 sidecar（独立 Node 进程）；app/渲染崩溃不影响运行，重启可从 checkpoint 续看续跑 |
| 性能 | 高频事件下 UI 不卡（批量 + 节流）；空闲内存 ≤ 300MB |
| 安全 | API Key 存本地加密文件、不入 trace；exec 白名单强制；沙箱不继承宿主敏感 env |
| 可维护 | 节点/工具/策略/模型均可替换；配置集中在 `config/forge.config.ts` |
| 可复现 | 环境版本、模型版本、参数、prompt 模板版本全部写入 run 记录 |
| 可测试 | 能力包纯 Node，vitest 单测；模型/沙箱/时钟可注入 mock |

---

## 7 验收标准（一期 Definition of Done）

1. **构建**：`pnpm --filter @chatvein/* build` 全部通过；静态断言无 `electron` 引用。
2. **CLI 端到端**：`forge run <小需求>` 纯命令行跑通完整状态机，产出 `runs/<id>/`（run.json/tasks.json/trace.jsonl/report.md/checkpoints/payloads/workspace）。
3. **GUI 端到端**：app 能启动同一运行，实时显示任务树、时间线、Token/预算，能暂停/终止/注入提示。
4. **断点续跑**：运行中杀掉 sidecar，`forge resume` 或重启 app 能从最近 checkpoint 继续，不重头跑。
5. **验证闭环**：构造一个会失败的任务，系统能 verify 失败 → diagnose → fix → verify 通过，且无"模型自述完成"。
6. **可观测**：trace.jsonl 事件完整（run_start/node_enter/exit/tool_call/verify/model/human/run_end），大 payload 有 ref。
7. **指标**：练习赛题跑通，自测通过率 ≥90%，Token ≤ 基线×0.8（目标值，初赛期持续优化）。
8. **回归**：`forge regression` 能对同一需求重复跑并输出指标对比。

---

## 8 依赖与风险（一期）

| 风险 | 影响 | 对策 |
|------|------|------|
| 开发窗口仅 2.5 周（9/7 开课、9/21 初赛） | 交付不完整 | M1 严格收口"能跑通"；先 in-process 后 sidecar；P1 全部后置 |
| LangChain/LangGraph 增加 Token | Token 掉分 | `ChatModelLike` 接口隔离，关键路径可直连网关；prompt 精简 |
| 本地沙箱与赛事不一致 | 线上通过率归零 | M0 摸清沙箱规格；预留 Docker 接口 |
| 模型网关限流/额度 | 运行中断 | 降级链 + 预算护栏 + checkpoint 续跑 |
| sidecar 协议拖慢进度 | 骨架延期 | 先模式 A（进程内）打通端到端，再模式 B（sidecar） |

> 待确认决策点（参赛形式、正式比赛是否允许人工干预、模型分级默认值、沙箱方案）沿用总 PRD 第 11 节，M0 实测后定稿。
