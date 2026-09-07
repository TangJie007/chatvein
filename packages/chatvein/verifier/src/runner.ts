import type { CheckResult, VerifyResult } from '@chatvein/common'
import type { SandboxProvider } from '@chatvein/sandbox'
import { buildTestReport } from './parse'

export interface VerifyOptions {
  sandbox: SandboxProvider
  /** 构建命令 argv；缺省 ['npm','run','build'] */
  buildCommand?: string[]
  /** 测试命令 argv；缺省 ['npm','test'] */
  testCommand?: string[]
  /** lint/类型检查命令 argv；可选，一期仅记录不阻断 */
  lintCommand?: string[]
  /** 相对 workspace 的子目录（monorepo 子包） */
  cwd?: string
  /** 超时 */
  buildTimeoutMs?: number
  testTimeoutMs?: number
  /** 是否跳过 build（无构建步骤的纯脚本任务） */
  skipBuild?: boolean
}

const DEFAULT_BUILD = ['npm', 'run', 'build']
const DEFAULT_TEST = ['npm', 'test']

/** 在沙箱执行单条命令并归一为 CheckResult */
async function runCheck(
  sandbox: SandboxProvider,
  argv: string[],
  cwd: string | undefined,
  timeoutMs: number,
): Promise<CheckResult> {
  const started = Date.now()
  const res = await sandbox.exec({ argv, cwd, timeoutMs })
  const output = [res.stdout, res.stderr].filter(Boolean).join('\n').trim()
  const exitCode = res.code ?? 1
  return {
    command: res.command,
    exitCode: res.rejected ? 1 : exitCode,
    ok: !res.rejected && exitCode === 0,
    durationMs: Date.now() - started,
    output: output || undefined,
    error: res.rejected,
  }
}

/**
 * 验证闭环入口：build → test →（lint 仅记录）。
 * 硬规则：通过证据只来自这里的结构化结果，模型不得自述完成。
 */
export async function verify(options: VerifyOptions): Promise<VerifyResult> {
  const { sandbox, cwd } = options

  let build: CheckResult
  if (options.skipBuild) {
    build = {
      command: '(skipped)',
      exitCode: 0,
      ok: true,
      durationMs: 0,
    }
  } else {
    build = await runCheck(
      sandbox,
      options.buildCommand ?? DEFAULT_BUILD,
      cwd,
      options.buildTimeoutMs ?? 300_000,
    )
  }

  const result: VerifyResult = {
    build,
    buildStatus: build.ok ? 'pass' : 'fail',
  }

  // build 失败也照跑 test 往往无意义；但仍尝试一次以采集更多信号
  const testCheck = await runCheck(
    sandbox,
    options.testCommand ?? DEFAULT_TEST,
    cwd,
    options.testTimeoutMs ?? 300_000,
  )
  const output = testCheck.output ?? ''
  result.test = buildTestReport(testCheck, testCheck.command, output)

  if (options.lintCommand) {
    result.lint = await runCheck(sandbox, options.lintCommand, cwd, 180_000)
  }

  return result
}
