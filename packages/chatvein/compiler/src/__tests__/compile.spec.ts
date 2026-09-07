import { describe, expect, it } from 'vitest'
import { compileRequirement, splitMarkdownSections, extractAcceptance } from '../index'

const REQ = `# 加法工具

## 实现 add 函数
写一个 add(a, b) 返回两数之和。
- 导出 add 函数
- 支持整数与小数

### 边界处理
- 入参非数字时抛 TypeError

## 单元测试
- 覆盖正数、负数、小数
`

describe('splitMarkdownSections', () => {
  it('按标题切分并保留层级', () => {
    const sections = splitMarkdownSections(REQ)
    const titles = sections.map((s) => s.title)
    expect(titles).toContain('实现 add 函数')
    expect(titles).toContain('单元测试')
    const h3 = sections.find((s) => s.title === '边界处理')
    expect(h3?.level).toBe(3)
  })
})

describe('extractAcceptance', () => {
  it('抽取 checkbox / 列表项作为验收标准', () => {
    const a = extractAcceptance('- 导出 add 函数\n- 支持整数与小数')
    expect(a).toEqual(['导出 add 函数', '支持整数与小数'])
  })
})

describe('compileRequirement', () => {
  it('sections 策略产出有序任务树且依赖合法', () => {
    const tree = compileRequirement({ markdown: REQ, strategy: 'sections' })
    expect(tree.length).toBeGreaterThanOrEqual(3)
    expect(tree[0]!.id).toBe('T01')
    // 每个依赖都指向已存在任务
    const ids = new Set(tree.map((t) => t.id))
    for (const t of tree) for (const d of t.dependsOn) expect(ids.has(d)).toBe(true)
    // 全部 pending
    expect(tree.every((t) => t.status === 'pending')).toBe(true)
  })

  it('single 策略产出单个高复杂度任务', () => {
    const tree = compileRequirement({ markdown: REQ, strategy: 'single' })
    expect(tree).toHaveLength(1)
    expect(tree[0]!.estimatedComplexity).toBe('high')
  })

  it('空文档兜底不抛错', () => {
    const tree = compileRequirement({ markdown: '', strategy: 'sections' })
    expect(tree.length).toBeGreaterThan(0)
  })
})
