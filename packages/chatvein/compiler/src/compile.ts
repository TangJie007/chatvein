import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Task, TaskComplexity, TaskTree } from '@chatvein/common'
import { topoSortTasks } from '@chatvein/common'
import { splitMarkdownSections, extractAcceptance, type MdSection } from './sections'

export interface CompileOptions {
  /** 需求文档原文（已读入） */
  markdown: string
  /** 需求文档路径（用于 requirementRef / 落盘命名） */
  requirementPath?: string
  /**
   * M1 策略：
   * - 'single'：整篇需求压成一个任务（最小闭环用）
   * - 'sections'：每个二级/三级章节一个任务（默认，确定性、零模型）
   * M2 会加 'model'：强模型按章节抽取功能点 + 验收标准。
   */
  strategy?: 'single' | 'sections'
}

/** 由章节估算复杂度：正文越长越复杂 */
function complexityOf(body: string): TaskComplexity {
  const len = body.length
  if (len > 1500) return 'high'
  if (len > 400) return 'mid'
  return 'low'
}

function taskFromSection(section: MdSection, seq: number, dependsOn: string[]): Task {
  const acceptance = extractAcceptance(section.body)
  return {
    id: `T${String(seq).padStart(2, '0')}`,
    title: section.title,
    requirementRef: [section.anchor],
    acceptance: acceptance.length ? acceptance : [`实现「${section.title}」并通过自测`],
    dependsOn,
    parallelGroup: seq,
    estimatedComplexity: complexityOf(section.body),
    status: 'pending',
  }
}

/**
 * 需求编译（M1 确定性版）：Markdown → TaskTree。
 * 不调用模型；M2 的模型抽取在本结果上做细化/合并。
 */
export function compileRequirement(options: CompileOptions): TaskTree {
  const { markdown, strategy = 'sections' } = options

  if (strategy === 'single') {
    const sections = splitMarkdownSections(markdown)
    const title = sections.find((s) => s.level === 1)?.title ?? '实现需求'
    return topoSortTasks([
      {
        id: 'T01',
        title,
        requirementRef: sections.map((s) => s.anchor),
        acceptance: ['按需求文档实现功能', '构建通过', '自测全部通过'],
        dependsOn: [],
        parallelGroup: 1,
        estimatedComplexity: 'high',
        status: 'pending',
      },
    ])
  }

  // sections 策略：以 ## / ### 章节为任务；### 依赖其所属 ##（拓扑串行）
  const sections = splitMarkdownSections(markdown)
  const tasks: Task[] = []
  let lastH2Id: string | null = null
  let seq = 0

  for (const s of sections) {
    // 跳过纯概述/空章节
    if (s.title === '概述' && s.level === 1 && s.body.length < 20) continue
    if (s.level > 3) continue
    seq += 1
    const dependsOn: string[] = []
    if (s.level === 3 && lastH2Id) dependsOn.push(lastH2Id)
    else if (tasks.length) dependsOn.push(tasks[tasks.length - 1]!.id) // 一期串行
    const task = taskFromSection(s, seq, dependsOn)
    tasks.push(task)
    if (s.level === 2) lastH2Id = task.id
  }

  if (tasks.length === 0) {
    // 兜底：整篇单任务
    return compileRequirement({ markdown, strategy: 'single' })
  }
  return topoSortTasks(tasks)
}

/** 编译并落盘 tasks.json */
export async function compileToFile(
  options: CompileOptions & { outPath: string },
): Promise<TaskTree> {
  const tree = compileRequirement(options)
  await mkdir(dirname(options.outPath), { recursive: true })
  await writeFile(options.outPath, JSON.stringify(tree, null, 2), 'utf8')
  return tree
}
