/**
 * 验证产物类型（@chatvein/verifier 输出，@chatvein/orchestrator 的 verify/diagnose 消费）。
 *
 * 对应 PRD 5.3.6 / 02-方案设计 §10。硬规则：模型不得自述完成，
 * 通过证据必须来自这些结构化结果。字段统一 camelCase。
 */

/** build / test / lint 三类检查的公共结果 */
export interface CheckResult {
  /** 实际执行的命令 */
  command: string
  /** 进程退出码；0 = 通过 */
  exitCode: number
  /** 是否通过（exitCode === 0） */
  ok: boolean
  /** 耗时（毫秒） */
  durationMs: number
  /** 原始输出（可能已截断）；大输出由 observability 落 payloadRef */
  output?: string
  /** 执行/解析阶段的错误（如命令不存在、超时） */
  error?: string
}

/** 单个失败用例（从测试输出解析） */
export interface FailedCase {
  /** 用例名/测试名 */
  name: string
  /** 失败的断言描述 */
  assertion?: string
  /** 堆栈关键帧（extractErrorFrames 只留相关行，不回传整份日志） */
  stackFrames?: string[]
  /** 所属文件/套件 */
  file?: string
}

/**
 * 自测结构化报告（PRD 5.3.3 的 test_report / TestResult）。
 * `passed`/`failed`/`skipped` 为用例计数；失败明细在 `failures`。
 */
export interface TestReport {
  /** 测试命令与退出码等 */
  check: CheckResult
  /** 通过用例数 */
  passed: number
  /** 失败用例数 */
  failed: number
  /** 跳过用例数 */
  skipped: number
  /** 失败用例明细（名 + 断言 + 堆栈关键帧） */
  failures: FailedCase[]
  /** 测试框架（vitest / jest / pytest…），解析失败时为 'unknown' */
  framework: string
}

/** 构建结果（verify 节点的 build_status） */
export type BuildStatus = 'unknown' | 'pass' | 'fail'

/** verify 节点的完整产物：build + test（lint 仅记录不阻断，P1） */
export interface VerifyResult {
  build: CheckResult
  buildStatus: BuildStatus
  test?: TestReport
  /** lint/类型检查结果；一期仅记录 */
  lint?: CheckResult
}

/** 判断一次验证是否整体通过（build 过 且 无失败用例） */
export function isVerifyPassed(result: VerifyResult): boolean {
  if (result.buildStatus !== 'pass') return false
  if (result.test && result.test.failed > 0) return false
  return true
}
