import { describe, expect, it } from 'vitest'
import { buildTestReport, parseCounts, parseFailures } from '../parse'
import type { CheckResult } from '@chatvein/common'

const VITEST_FAIL = `
 RUN  v1.6.0

 ❯ src/add.test.ts (2)
   ✓ adds two numbers
   × subtracts correctly

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/add.test.ts > subtracts correctly
AssertionError: expected 3 to be 2
 ❯ src/add.test.ts:5:12
      3|   expect(subtract(5, 3)).toBe(2)
      4| })
      5| expect(subtract(5,2)).toBe(3)

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
`

describe('parseCounts', () => {
  it('解析 vitest 汇总计数', () => {
    const c = parseCounts(VITEST_FAIL)
    expect(c.passed).toBe(1)
    expect(c.failed).toBe(1)
  })
})

describe('parseFailures', () => {
  it('抽取失败用例名与断言/堆栈关键帧', () => {
    const fails = parseFailures(VITEST_FAIL, 'vitest')
    expect(fails.length).toBeGreaterThan(0)
    const names = fails.map((f) => f.name).join(' ')
    expect(names).toMatch(/subtracts correctly|src\/add\.test\.ts/)
  })
})

describe('buildTestReport', () => {
  it('失败退出码产出 failed>0 的结构化报告', () => {
    const check: CheckResult = {
      command: 'npx vitest run',
      exitCode: 1,
      ok: false,
      durationMs: 100,
      output: VITEST_FAIL,
    }
    const report = buildTestReport(check, check.command, VITEST_FAIL)
    expect(report.framework).toBe('vitest')
    expect(report.failed).toBeGreaterThan(0)
    expect(report.failures.length).toBeGreaterThan(0)
  })

  it('通过退出码产出零失败', () => {
    const check: CheckResult = {
      command: 'npx vitest run',
      exitCode: 0,
      ok: true,
      durationMs: 50,
      output: 'Tests  2 passed (2)',
    }
    const report = buildTestReport(check, check.command, 'Tests  2 passed (2)')
    expect(report.failed).toBe(0)
    expect(report.passed).toBe(2)
  })
})
