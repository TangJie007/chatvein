import { describe, expect, it } from 'vitest'
import {
  isTerminalTaskStatus,
  nextRunnableTasks,
  topoSortTasks,
  type Task,
} from '../task'

function makeTask(partial: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    title: partial.id,
    requirementRef: [],
    acceptance: [],
    dependsOn: [],
    parallelGroup: 0,
    estimatedComplexity: 'mid',
    status: 'pending',
    ...partial,
  }
}

describe('topoSortTasks', () => {
  it('依赖任务排在前面', () => {
    const tasks = [
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'a' }),
    ]
    const sorted = topoSortTasks(tasks).map((t) => t.id)
    expect(sorted).toEqual(['a', 'b'])
  })

  it('检测依赖环并抛错', () => {
    const tasks = [
      makeTask({ id: 'a', dependsOn: ['b'] }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ]
    expect(() => topoSortTasks(tasks)).toThrow(/环/)
  })

  it('依赖缺失任务时抛错', () => {
    const tasks = [makeTask({ id: 'a', dependsOn: ['ghost'] })]
    expect(() => topoSortTasks(tasks)).toThrow(/不存在/)
  })
})

describe('nextRunnableTasks', () => {
  it('只返回 pending 且依赖全部 passed 的任务', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'passed' }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
      makeTask({ id: 'c', dependsOn: ['b'] }),
      makeTask({ id: 'd' }),
    ]
    const runnable = nextRunnableTasks(tasks).map((t) => t.id)
    expect(runnable).toEqual(['b', 'd'])
  })

  it('依赖失败的任务不可调度', () => {
    const tasks = [
      makeTask({ id: 'a', status: 'failed' }),
      makeTask({ id: 'b', dependsOn: ['a'] }),
    ]
    expect(nextRunnableTasks(tasks)).toHaveLength(0)
  })
})

describe('isTerminalTaskStatus', () => {
  it('终态判定', () => {
    expect(isTerminalTaskStatus('passed')).toBe(true)
    expect(isTerminalTaskStatus('failed')).toBe(true)
    expect(isTerminalTaskStatus('skipped')).toBe(true)
    expect(isTerminalTaskStatus('pending')).toBe(false)
    expect(isTerminalTaskStatus('running')).toBe(false)
  })
})
