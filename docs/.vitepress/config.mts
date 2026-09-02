import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'Chatvein · Forge',
  description: '自研 Agent Harness 桌面应用 —— 第一期工程文档',
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
        ],
      },
    ],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdatedText: '最后更新',
  },
})
