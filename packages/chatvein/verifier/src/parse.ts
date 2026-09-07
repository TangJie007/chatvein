import type { FailedCase, TestReport } from '@chatvein/common'

/**
 * 从测试命令输出解析结构化失败用例。
 *
 * 一期支持 vitest / jest（TAP/JSON 之外的人类可读输出也兜底正则）。
 * 解析失败不致命：framework='unknown'，失败计数退化为 0/由退出码判定。
 */

/** 从 vitest/jest 文本输出抽取失败用例 */
export function parseFailures(output: string, framework: string): FailedCase[] {
  const failures: FailedCase[] = []
  const lines = output.split(/\r?\n/)

  if (framework === 'vitest' || framework === 'jest') {
    // vitest/jest 失败块标题行：常见形态
    //   × test name > nested
    //   FAIL  path/to/file.test.ts > suite > test name
    //   ● suite › test name
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const failMatch =
        /^\s*(?:×|✗|✕|●)\s+(.*)$/.exec(line) ?? /^\s*FAIL\s+\S+\s+(?:>›?\s*)?(.*)$/.exec(line)
      if (!failMatch) continue
      const name = failMatch[1]!.trim()
      if (!name || failures.some((f) => f.name === name)) continue

      const frames: string[] = []
      const assertionLines: string[] = []
      // 向后看最多 25 行，抓断言差异与堆栈关键帧
      for (let j = i + 1; j < Math.min(i + 26, lines.length); j++) {
        const l = lines[j]!
        if (/^\s*(?:×|✗|✕|●|FAIL|PASS|✓|√)\s+/.test(l)) break
        if (/AssertionError|expected|Expected|Received|to(Be|Equal|Contain|Throw)|assert/.test(l)) {
          assertionLines.push(l.trim())
        }
        if (/\bat\s+.+\(.*\.(?:ts|js|tsx|jsx):\d+:\d+\)/.test(l) || /\(node:/.test(l)) {
          frames.push(l.trim())
        }
      }
      failures.push({
        name,
        assertion: assertionLines.slice(0, 3).join(' | ') || undefined,
        stackFrames: frames.slice(0, 5),
      })
    }
  }

  return failures
}

/** 从汇总行解析通过/失败/跳过计数；抓不到则按失败用例数与退出码推断 */
export function parseCounts(output: string): { passed: number; failed: number; skipped: number } {
  let passed = 0
  let failed = 0
  let skipped = 0
  // vitest: "Tests  2 failed | 5 passed (8)" 或 "Test Files ..."
  // jest:   "Tests:       2 failed, 5 passed, 1 skipped"
  const grab = (re: RegExp): number => {
    const m = re.exec(output)
    return m ? Number(m[1]) : 0
  }
  passed = grab(/(\d+)\s+passed/i)
  failed = grab(/(\d+)\s+failed/i)
  skipped = grab(/(\d+)\s+(?:skipped|todo)/i)
  return { passed, failed, skipped }
}

/** 探测测试框架 */
export function detectFramework(command: string, output: string): string {
  if (/vitest/.test(command) || /vitest/i.test(output.slice(0, 2000))) return 'vitest'
  if (/jest/.test(command) || /jest/i.test(output.slice(0, 2000))) return 'jest'
  if (/pytest/.test(command)) return 'pytest'
  return 'unknown'
}

/** 组装 TestReport（check 由调用方提供） */
export function buildTestReport(
  check: TestReport['check'],
  command: string,
  output: string,
): TestReport {
  const framework = detectFramework(command, output)
  let { passed, failed, skipped } = parseCounts(output)
  let failures: FailedCase[] = []
  if (check.exitCode !== 0) {
    failures = parseFailures(output, framework)
    // 计数抓不到时，用失败用例数兜底，至少保证 failed>0 能驱动 diagnose
    if (failed === 0 && failures.length > 0) failed = failures.length
    if (failed === 0 && check.exitCode !== 0) failed = 1
  }
  return { check, passed, failed, skipped, failures, framework }
}
