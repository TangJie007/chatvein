---
layout: home

hero:
  name: Chatvein · Forge
  text: 自研 Agent Harness
  tagline: 把需求文档自动锻造成可运行软件 —— 第一期（初赛版）工程文档
  actions:
    - theme: brand
      text: 第一期 PRD
      link: /phase1/01-第一期PRD
    - theme: alt
      text: 方案设计
      link: /phase1/02-方案设计
    - theme: alt
      text: 开发计划书
      link: /phase1/03-开发计划书

features:
  - title: 能力全部在 packages/chatvein
    details: "Harness 的需求编译、LangGraph 编排、工具、模型网关、沙箱、验证、上下文、可观测全部为纯 Node 包，零 Electron 依赖。"
  - title: app 只是调用者
    details: "Electron + Vue 控制台只做可视化与人工干预，通过 @chatvein/core 门面或 sidecar 驱动运行，不含 Agent 业务逻辑。"
  - title: Node 服务也是调用者
    details: "@chatvein/service 提供 CLI（forge run / resume / regression）与 sidecar，支持无人值守、崩溃隔离与断点续跑。"
---

> 产品总 PRD（需求来源）位于仓库根目录 `PRD-Forge-v1.md`。
