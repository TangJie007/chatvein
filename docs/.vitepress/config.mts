import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Chatvein · Forge',
  description: '自研 Agent Harness 桌面应用 —— 第一期工程文档与设计参考',
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      {
        text: '第一期',
        items: [
          { text: '一期 PRD', link: '/phase1/01-第一期PRD' },
          { text: '方案设计', link: '/phase1/02-方案设计' },
          { text: '开发计划书', link: '/phase1/03-开发计划书' },
          { text: '依赖选型', link: '/phase1/04-依赖选型' },
        ],
      },
      {
        text: '设计参考',
        items: [
          { text: '核心骨架', link: '/design/01-核心骨架' },
          { text: 'Agent 循环', link: '/design/02-agent循环方案' },
          { text: '记忆方案', link: '/design/03-记忆方案' },
          { text: '向量存储', link: '/design/04-向量存储架构' },
          { text: '群组记忆', link: '/design/05-群组记忆架构' },
          { text: '插件运行时 Cordis', link: '/design/06-插件运行时-Cordis' },
          { text: '沙箱方案', link: '/design/07-沙箱方案' },
        ],
      },
    ],
    sidebar: [
      {
        text: '第一期（初赛版）',
        collapsed: false,
        items: [
          { text: '1. 第一期 PRD（范围与验收）', link: '/phase1/01-第一期PRD' },
          { text: '2. 方案设计（技术设计）', link: '/phase1/02-方案设计' },
          { text: '3. 开发计划书（排期与 WBS）', link: '/phase1/03-开发计划书' },
          { text: '4. 依赖选型（三方库与版本）', link: '/phase1/04-依赖选型' },
        ],
      },
      {
        text: '设计参考（深夜任务）',
        collapsed: false,
        items: [
          { text: '1. 核心骨架（角色 / 拉群 / 对话）', link: '/design/01-核心骨架' },
          { text: '2. Agent 循环方案（≥2）', link: '/design/02-agent循环方案' },
          { text: '3. 记忆方案（省 Token / 缓存）', link: '/design/03-记忆方案' },
          { text: '4. 向量存储架构', link: '/design/04-向量存储架构' },
          { text: '5. 群组记忆架构（≥2）', link: '/design/05-群组记忆架构' },
          { text: '6. 插件运行时（Cordis）', link: '/design/06-插件运行时-Cordis' },
          { text: '7. 沙箱方案（已锁定）', link: '/design/07-沙箱方案' },
        ],
      },
    ],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
  },
})
