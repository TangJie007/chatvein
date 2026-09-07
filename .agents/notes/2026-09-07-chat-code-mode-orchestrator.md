# 决策笔记：Chat「编程开发」档走 Forge orchestrator

状态：已落地

## 背景

UI 三档里的「编程开发」原先仍走主对话 ReAct（`createReactChatAgent` + L2 `maxSteps`），仅换项目 jail。编码长链路易撞 `recursionLimit`（如 standard=16），且缺少 plan→verify 闭环。产品语义上编程档应使用已实现的 `@chatvein/orchestrator`，与日常办公 ReAct 分开。

## 决策

单对话在 `workMode=code` 时：

1. ~~优先绑定内置 `coder` Agent 的模型配置。~~ → 已由 [`2026-09-07-chat-code-mode-main-agent.md`](./2026-09-07-chat-code-mode-main-agent.md) 取代：单对话仍走主 Agent，编程档只换 Forge。
2. 要求设置 `devProjectRoot`；用户消息写入会话 `memory/requirement-*.md`。
3. 经 `@chatvein/core` `createHarness` → `start({ workspacePath: projectRoot })` 驱动 orchestrator。
4. Trace 事件映射为聊天 `thinking_delta`；结束摘要写入助手消息。
5. `Harness` 支持 `workspacePath` 覆盖，使沙箱 jail 落在真实项目而非 `runs/<id>/workspace`。

日常办公 / 个性化仍走 Chat L3 ReAct。CLI `forge run` 路径不变。

## 备选方案

**继续抬高 Chat ReAct maxSteps**：治标不治本，无结构化 verify；否决。

**编程档只 hintUserForge、确认后再派单**：一期 UI 已是显式切档，再确认一层过重；切档即等于派单；采纳直连。

**Chat 内嵌复制一份 StateGraph**：违反「能力包只调用」；否决。

## 影响

- 收益：编程档具备 plan/implement/verify/fix；步数受 Forge budget，不再被 L2 standard=16 误杀。
- 代价：无 `package.json` 时 skipBuild；有则默认跑 `npm run build` / `npm test`，失败会进 diagnose/fix。
- 后续注意：办公档 hint 派单与编程档直连的产品文案需一致；重任务墙钟/token 仍靠 Forge 护栏。
