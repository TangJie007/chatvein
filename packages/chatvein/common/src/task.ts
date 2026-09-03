/**
 * 任务树类型（@chatvein/compiler 产物，@chatvein/orchestrator 消费）。
 *
 * 对应 PRD 5.3.2 / 02-方案设计 §8。一份需求编译为 `Task[]`，落盘 `runs/<runId>/tasks.json`，
 * 供控制台预览/微调、供状态机按拓扑顺序调度。字段统一 camelCase（落盘 JSON 同名）。
 */

/** 任务复杂度；用于模型分级路由（high→强，low→弱，见 PRD 5.3.5） */
export type TaskComplexity = 'low' | 'mid' | 'high'

/** 任务运行时状态 */
export type TaskStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped'

export interface Task {
  /** 任务唯一标识 */
  id: string
  /** 任务标题 */
  title: string
  /** 回溯到需求文档原文章节，保证可追溯 */
  requirementRef: string[]
  /** 验收标准（可验证的断言式描述）；"完成"只能由 verify 对照它判定 */
  acceptance: string[]
  /** 依赖任务 ID，用于拓扑排序 */
  dependsOn: string[]
  /** 并行分组；同组任务理论上可并发（一期固定串行，P1 才开并发） */
  parallelGroup: number
  /** 复杂度，驱动模型档选择 */
  estimatedComplexity: TaskComplexity
  /** 运行时状态；编译产出时为 'pending' */
  status: TaskStatus
}

/** 任务树 = 有序任务数组（拓扑排序后） */
export type TaskTree = Task[]

/** 已进入终态的状态（不再被调度） */
export const TERMINAL_TASK_STATUS: ReadonlySet<TaskStatus> = new Set([
  'passed',
  'failed',
  'skipped',
])

export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUS.has(status)
}

/** 拓扑排序：按 dependsOn 输出可调度顺序；检测环与缺失依赖。 */
export function topoSortTasks(tasks: TaskTree): TaskTree {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const visited = new Set<string>()
  const visiting = new Set<string>()
  const out: TaskTree = []

  const visit = (task: Task): void => {
    if (visited.has(task.id)) return
    if (visiting.has(task.id)) {
      throw new Error(`任务依赖存在环：${task.id}`)
    }
    visiting.add(task.id)
    for (const depId of task.dependsOn) {
      const dep = byId.get(depId)
      if (!dep) throw new Error(`任务 ${task.id} 依赖了不存在的任务：${depId}`)
      visit(dep)
    }
    visiting.delete(task.id)
    visited.add(task.id)
    out.push(task)
  }

  for (const t of tasks) visit(t)
  return out
}

/** 选出当前可调度任务：依赖全部终态（passed）且自身 pending。一期串行调用方取首个即可。 */
export function nextRunnableTasks(tasks: TaskTree): TaskTree {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  return tasks.filter((t) => {
    if (t.status !== 'pending') return false
    return t.dependsOn.every((depId) => byId.get(depId)?.status === 'passed')
  })
}
