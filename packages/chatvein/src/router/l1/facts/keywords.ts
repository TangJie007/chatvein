/**
 * 领域关键词表（产品词表，非通用 NLP）。
 */

export const OFFICE_KEYWORDS = [
  '解析',
  '抽取',
  '提取',
  '转换',
  '导出',
  '导入',
  '汇总',
  '表格',
  '合同',
  '标书',
  '公文',
  '文档',
  'pdf',
  'excel',
  'word',
  'xlsx',
  'docx',
  'ppt',
] as const

export const CODE_KEYWORDS = [
  '重构',
  '测试',
  '构建',
  '编译',
  '类型',
  '报错',
  'bug',
  '修复',
  '修一下',
  '单元测试',
  '单测',
  'lint',
  'ci',
  'pr',
  'commit',
  '依赖',
  '模块',
  '函数',
  '接口',
  'api',
  '实现',
  '改码',
] as const

/** 多步骤 / 串联连接词 → 倾向 orchestrated */
export const MULTI_STEP_KEYWORDS = [
  '然后',
  '并且',
  '同时',
  '接着',
  '之后',
  '最后',
  '再',
  '并',
  '以及',
  '一边',
  '另一方面',
  '先',
  '再改',
  '同步更新',
  '分别',
  '多份',
  '多个文件',
  '跨模块',
  'and then',
  'after that',
  'also',
] as const

export interface KeywordFacts {
  office: string[]
  code: string[]
  multiStep: string[]
}

function hits(text: string, words: readonly string[]): string[] {
  const lower = text.toLowerCase()
  return words.filter((w) => lower.includes(w.toLowerCase()))
}

export function extractKeywordFacts(text: string): KeywordFacts {
  return {
    office: hits(text, OFFICE_KEYWORDS),
    code: hits(text, CODE_KEYWORDS),
    multiStep: hits(text, MULTI_STEP_KEYWORDS),
  }
}
