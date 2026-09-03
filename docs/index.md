---
layout: home

hero:
  name: Chatvein · Forge
  text: 自研 Agent Harness
  tagline: 把需求文档自动锻造成可运行软件 —— 第一期工程文档与设计参考
  actions:
    - theme: brand
      text: 第一期 PRD
      link: /phase1/01-第一期PRD
    - theme: alt
      text: 方案设计
      link: /phase1/02-方案设计
    - theme: alt
      text: 核心骨架
      link: /design/01-核心骨架

features:
  - title: 能力全部在 packages/chatvein
    details: "Harness 的需求编译、LangGraph 编排、工具、模型网关、沙箱、验证、上下文、可观测全部为纯 Node 包，零 Electron 依赖。"
  - title: 角色拉群多智能体
    details: "普通对话之外，可建立 Agent 角色、分配不同 LLM，像企业微信一样拉群讨论任务；详见设计参考。"
  - title: Node 服务也是调用者
    details: "@chatvein/service 提供 CLI（forge run / resume / regression）与 sidecar，支持无人值守、崩溃隔离与断点续跑。"
---

> 产品总 PRD 位于仓库根目录 `PRD-Forge-v1.md`。深夜任务设计文档见左侧「设计参考」。
