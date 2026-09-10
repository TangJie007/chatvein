/**
 * L2 few-shot：每类 2~3 条（设计 §4.3）。
 * 只示范判法；实际仍要求模型输出完整 JSON。
 */
export interface FewShotExample {
  input: string
  /** 期望结构化字段（写入 prompt，非运行时断言） */
  expect: {
    lane: string
    domain: string
    band: string
    confidence: number
    rewritten: string
    reason: string
  }
}

export const L2_FEW_SHOTS: FewShotExample[] = [
  // direct · general
  {
    input: '你好',
    expect: {
      lane: 'direct',
      domain: 'general',
      band: 'trivial',
      confidence: 0.95,
      rewritten: '用户打招呼',
      reason: '纯寒暄',
    },
  },
  {
    input: '闭包是什么',
    expect: {
      lane: 'direct',
      domain: 'general',
      band: 'simple',
      confidence: 0.9,
      rewritten: '解释编程中闭包的概念与用途',
      reason: '概念问答',
    },
  },
  {
    input: '好的明白了',
    expect: {
      lane: 'direct',
      domain: 'general',
      band: 'trivial',
      confidence: 0.92,
      rewritten: '用户确认已知晓',
      reason: '确认/澄清',
    },
  },
  // agentic · general
  {
    input: '今天惠阳天气',
    expect: {
      lane: 'agentic',
      domain: 'general',
      band: 'standard',
      confidence: 0.88,
      rewritten: '查询广东惠阳今日天气预报',
      reason: '需实时查询工具',
    },
  },
  {
    input: '帮我搜一下 Node 22 的 AbortSignal.any 用法',
    expect: {
      lane: 'agentic',
      domain: 'general',
      band: 'simple',
      confidence: 0.85,
      rewritten: '检索 Node.js 22 AbortSignal.any 的用法说明',
      reason: '单点事实检索',
    },
  },
  // agentic · code
  {
    input: '帮我把 src/index.ts 的类型报错修了',
    expect: {
      lane: 'agentic',
      domain: 'code',
      band: 'standard',
      confidence: 0.9,
      rewritten: '修复 src/index.ts 中的 TypeScript 类型报错',
      reason: '单点修 bug',
    },
  },
  {
    input: '给这个函数补单元测试',
    expect: {
      lane: 'agentic',
      domain: 'code',
      band: 'standard',
      confidence: 0.86,
      rewritten: '为当前函数补充单元测试',
      reason: '单任务编码',
    },
  },
  {
    input: '看看这段堆栈哪里崩的',
    expect: {
      lane: 'agentic',
      domain: 'code',
      band: 'standard',
      confidence: 0.84,
      rewritten: '根据堆栈定位崩溃原因并修复',
      reason: '调试堆栈',
    },
  },
  // agentic · general（文档短链）
  {
    input: '把这份合同 PDF 关键条款抽成表格',
    expect: {
      lane: 'agentic',
      domain: 'general',
      band: 'standard',
      confidence: 0.9,
      rewritten: '从合同 PDF 抽取关键条款并整理为表格',
      reason: '短文档流水线',
    },
  },
  {
    input: '把报价单.xlsx 转成纪要 markdown',
    expect: {
      lane: 'agentic',
      domain: 'general',
      band: 'standard',
      confidence: 0.88,
      rewritten: '将报价单.xlsx 转换为纪要 markdown',
      reason: '文档转换',
    },
  },
  // orchestrated · code
  {
    input: '重构登录模块并补测试，最后跑一遍构建',
    expect: {
      lane: 'orchestrated',
      domain: 'code',
      band: 'complex',
      confidence: 0.9,
      rewritten: '重构登录模块、补充测试并执行构建验证',
      reason: '多步骤工程改动',
    },
  },
  {
    input: '跨几个包把旧 router API 迁到 lane+domain',
    expect: {
      lane: 'orchestrated',
      domain: 'code',
      band: 'complex',
      confidence: 0.88,
      rewritten: '跨包迁移旧 router API 至 lane 与 domain 模型',
      reason: '跨模块迁移',
    },
  },
  // orchestrated · general（多文档 / HITL）
  {
    input: '根据三份标书和我方材料做投标应答：先出计划，确认后再导出',
    expect: {
      lane: 'orchestrated',
      domain: 'general',
      band: 'complex',
      confidence: 0.9,
      rewritten: '基于多份标书与我方材料制定投标应答计划并生成可导出草稿',
      reason: '多产物任务需确认',
    },
  },
  {
    input: '先解析合同再抽取条款并且导出对照表，中间要我确认',
    expect: {
      lane: 'orchestrated',
      domain: 'general',
      band: 'complex',
      confidence: 0.87,
      rewritten: '解析合同、抽取条款并在用户确认后导出对照表',
      reason: '多步骤+HITL',
    },
  },
]
