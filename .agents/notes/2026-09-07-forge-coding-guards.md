# 决策笔记：编程开发档 P0–P2 护栏与续跑

状态：已落地

## 背景

Chat「编程开发」档已直连 Forge orchestrator，但仍缺取消、验证命令可配、改动回流、写盘确认、寒暄误开跑、续跑与敏感文件防护。用户反馈后需要按产品清单一次性补齐，否则真实仓库上的长任务不可控。

## 决策

1. **取消**：`chat:abort` → 会话级 `AbortController`；`Harness` / `runForge` / 内层 ReAct / `sandbox.exec` 透传 `signal`，并 `killRunning`。
2. **验证命令**：`AppSettings.forgeBuildCommand` / `forgeTestCommand` / `forgeSkipBuild` 写入 settings，经 `harness.start` 传给 verifier。
3. **产物**：Forge 前后对 `devProjectRoot` 做 mtime diff，经 `chat:event` `artifacts` 推思考侧栏，并附 run 目录。
4. **写盘确认**：默认 `confirmForgeStart=true`，渲染层弹窗后再 `send`（可在设置关闭）。
5. **寒暄 / 轻量路径**：编程档用 L1 `extractFacts` 寒暄短路；过短且无编码意图的句子不启动 Forge。
6. **续跑**：`runs/.../forge/last-run.json` + `Harness.resume` 复用 `run.json` 中的 `workspacePath` / 验证命令；UI「继续上次」。
7. **模型分档**：implement/fix 用会话强模；diagnose/summarize 优先弱模（同 L2 挑选规则）。
8. **安全**：Forge `read_file` / `write_file` 拒绝 `.env*`、常见密钥文件名。

## 备选方案

**仅抬高 RecursionLimit / 不加 abort**：长任务仍无法停下；否决。

**每条工具调用都 HITL**：过重，一期用启动前确认 + 路径/命令白名单；否决细粒度确认。

**续跑靠用户手填 runId**：体验差；否决，改 last-run 指针。

**敏感文件靠 prompt 约束**：不可靠；否决，改工具层硬拒绝。

## 影响

- 收益：编程档可停、可配测、可看改动、可续跑，误开跑与密钥泄漏面缩小。
- 代价：abort 依赖 LangGraph `signal` 与子进程杀树，极端挂起仍可能需重启 app；弱模未配置时 diagnose 仍走强模。
- 后续：办公档 HITL 写盘与 Forge 确认文案可再统一；monorepo 可自动探测脚本。
