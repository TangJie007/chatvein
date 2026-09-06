import { describe, expect, it } from 'vitest'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { truncateOutput } from '../guards'
import { wrapToolOutput } from '../wrap'

describe('truncateOutput', () => {
  it('未超阈值时原样返回', () => {
    expect(truncateOutput('hello', 100)).toBe('hello')
  })

  it('等于阈值时原样返回', () => {
    expect(truncateOutput('12345', 5)).toBe('12345')
  })

  it('超长时头尾保留 + 中间折叠并标注省略行数', () => {
    const text = Array.from({ length: 50 }, (_, i) => `line-${i}`).join('\n')
    const out = truncateOutput(text, 80)
    expect(out).not.toBe(text)
    expect(out).toContain('已省略')
    expect(out.startsWith('line-0')).toBe(true)
    expect(out.trimEnd().endsWith('line-49')).toBe(true)
    expect(out.length).toBeLessThan(text.length)
  })

  it('极长单行退化为硬切头部', () => {
    const out = truncateOutput('x'.repeat(4000), 100)
    expect(out.length).toBeLessThan(4000)
    expect(out).toContain('已省略')
  })
})

describe('wrapToolOutput', () => {
  it('透传 name / description，且短输出原样', async () => {
    const inner = {
      name: 'mcp_foo',
      description: 'foo',
      invoke: async (input: unknown) => `result-${input as string}`,
    } as unknown as StructuredToolInterface
    const wrapped = wrapToolOutput(inner, 8000)
    expect(wrapped.name).toBe('mcp_foo')
    expect(wrapped.description).toBe('foo')
    expect(await wrapped.invoke('x')).toBe('result-x')
  })

  it('对超长输出执行折叠', async () => {
    const inner = {
      name: 'mcp_big',
      description: 'big',
      invoke: async () => 'y'.repeat(5000),
    } as unknown as StructuredToolInterface
    const wrapped = wrapToolOutput(inner, 50)
    const out = await wrapped.invoke('x')
    expect(out.length).toBeLessThan(5000)
    expect(out).toContain('已省略')
  })

  it('保留真实工具的 this 绑定', async () => {
    const inner = {
      tag: 'T',
      name: 'mcp_this',
      description: 'd',
      invoke(this: { tag: string }, input: unknown) {
        return `${this.tag}:${input as string}`
      },
    } as unknown as StructuredToolInterface
    const wrapped = wrapToolOutput(inner, 8000)
    expect(await wrapped.invoke('z')).toBe('T:z')
  })
})
