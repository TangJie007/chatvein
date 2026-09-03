import type { TraceStep } from '../components/chat/AgentTrace.vue'
import type { SourceItem } from '../components/layout/SourceDrawer.vue'

export const runningTrace: TraceStep[] = [
  {
    icon: '1',
    kind: 'think',
    name: 'think',
    tag: '计划：定位 → 读取 → 拆分 → 评估嵌入 → 写入 obsidian',
    detail: '基于长期记忆：用户偏好表结构化、目标模块 = chunking / embedding / eval',
  },
  {
    icon: '2',
    kind: 'tool',
    name: 'file_search',
    tag: '180ms',
    detail: '匹配 ~/notes/2026-09-02-*rag*.md → 找到 3 篇',
  },
  {
    icon: '3',
    kind: 'tool',
    name: 'file_read',
    tag: '240ms · 13.4 KB',
    detail: '正在按你的拆分偏好（语义分块 · 512 tokens · overlap 12%）构造 chunks…',
  },
  {
    icon: '4',
    kind: 'ok',
    name: 'rag_query',
    tag: '向量库召回 · top 4',
    detail: '从 pgvector 医疗健康知识库命中 3 段相似段落，作为补充',
  },
]

export const doneTrace: TraceStep[] = [
  {
    icon: 'A',
    kind: 'ok',
    name: 'file_move',
    tag: '90ms',
    detail: 'rag-overview.md → Archive/2026-09/rag-overview.md',
  },
  {
    icon: 'B',
    kind: 'ok',
    name: 'file_write',
    tag: '1.4s · 8.2 KB',
    detail: 'AI 研究/rag-overview-v2.md · 含 4 章 12 小节',
  },
  {
    icon: 'C',
    kind: 'ok',
    name: 'obs_index_sync',
    tag: '220ms',
    detail: '已同步 wikilink · [[rag-overview-v2]] 反向引用 3 处',
  },
]

export const groupTrace: TraceStep[] = [
  {
    icon: '1',
    kind: 'ok',
    name: 'rechunk',
    tag: '2.1s · 3,612 chunks',
    detail: '按语义边界重切，平均块长由 243 → 486 tokens',
  },
  {
    icon: '2',
    kind: 'ok',
    name: 'rag_eval',
    tag: '3.4s · 120 题',
    detail: 'RAGAS 评测集跑分：hit@5 = 0.83 · MRR = 0.61',
  },
  {
    icon: '3',
    kind: 'ok',
    name: 'cost_report',
    tag: '0.7s',
    detail: 'rerank on：成本 +41%，延迟 +180ms；建议默认关、按需开',
  },
]

export const sources: SourceItem[] = [
  {
    idx: 1,
    file: 'rag/chunking-strategy.md',
    score: '0.91',
    text: '语义分块优于固定长度：512 tokens + 12% overlap 在长文档召回上比 256 定长提升 23%。',
  },
  {
    idx: 2,
    file: 'rag/embedding-bench.md',
    score: '0.87',
    text: 'BGE-M3 在中文语料上 1024 维 / ivfflat，召回率 0.86，比 768 维高 4 个点，成本持平。',
  },
  {
    idx: 3,
    file: 'rag/eval-ragas.md',
    score: '0.79',
    text: 'RAGAS 评估下 hit@5 = 0.86，rerank 关掉后降到 0.71，但单次成本下降 41%。',
  },
  {
    idx: 4,
    file: 'notes/2026-09-02-scratch.md',
    score: '0.42',
    text: '未采用 — 相似度低于阈值 0.65，已排除出上下文。',
    dim: true,
  },
]

export const kbSearchResults: SourceItem[] = [
  {
    idx: 1,
    file: '慢病管理/高血压-饮食.md',
    score: '0.91',
    text: '每日钠摄入控制在 5g 盐以内，增加钾摄入（蔬果、豆类），限制加工肉与腌制食品。',
  },
  {
    idx: 2,
    file: '慢病管理/血压自测.md',
    score: '0.84',
    text: '建议固定晨起与睡前各测一次，静息 5 分钟后测量，连续记录 7 天取均值。',
  },
  {
    idx: 3,
    file: '用药常识/降压药依从性.md',
    score: '0.72',
    text: '不可因血压下降自行停药，漏服后不可加倍补服，需咨询医生调整方案。',
  },
]
