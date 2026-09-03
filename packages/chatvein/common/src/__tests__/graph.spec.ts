import { describe, expect, it } from 'vitest'
import { createInitialState } from '../graph'
import { DEFAULT_BUDGET, emptyTokenStat } from '../types'
import { isVerifyPassed, type VerifyResult } from '../verifier'

describe('createInitialState', () => {
  it('填充默认预算与空 token 统计', () => {
    const s = createInitialState({
      runId: 'r1',
      workspacePath: '/ws',
      requirementPath: '/ws/req.md',
    })
    expect(s.runId).toBe('r1')
    expect(s.workspacePath).toBe('/ws')
    expect(s.taskTree).toEqual([])
    expect(s.currentTaskIds).toEqual([])
    expect(s.fileIndex).toEqual({})
    expect(s.buildStatus).toBe('unknown')
    expect(s.retryCount).toBe(0)
    expect(s.status).toBe('running')
    expect(s.budget).toEqual(DEFAULT_BUDGET)
    expect(s.tokenUsage).toEqual(emptyTokenStat())
  })

  it('允许覆盖预算', () => {
    const s = createInitialState({
      runId: 'r',
      workspacePath: 'w',
      requirementPath: 'r.md',
      budget: { ...DEFAULT_BUDGET, maxSteps: 5 },
    })
    expect(s.budget.maxSteps).toBe(5)
  })
})

describe('isVerifyPassed', () => {
  const base: VerifyResult = {
    build: { command: 'build', exitCode: 0, ok: true, durationMs: 1 },
    buildStatus: 'pass',
  }
  it('build 过且无失败用例 → 通过', () => {
    expect(isVerifyPassed({ ...base, test: undefined })).toBe(true)
    expect(
      isVerifyPassed({
        ...base,
        test: {
          check: { command: 'test', exitCode: 0, ok: true, durationMs: 1 },
          passed: 3,
          failed: 0,
          skipped: 0,
          failures: [],
          framework: 'vitest',
        },
      }),
    ).toBe(true)
  })
  it('build 失败 → 不通过', () => {
    expect(isVerifyPassed({ ...base, buildStatus: 'fail' })).toBe(false)
  })
  it('有失败用例 → 不通过', () => {
    expect(
      isVerifyPassed({
        ...base,
        test: {
          check: { command: 'test', exitCode: 1, ok: false, durationMs: 1 },
          passed: 2,
          failed: 1,
          skipped: 0,
          failures: [{ name: 'a' }],
          framework: 'vitest',
        },
      }),
    ).toBe(false)
  })
})
