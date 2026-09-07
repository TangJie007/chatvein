import { spawn, type ChildProcess } from 'node:child_process'
import { cp, mkdir, access, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { release, arch as osArch, platform as osPlatform } from 'node:os'
import { PathJail } from './path-jail'
import type { EnvSnapshot, ExecInput, ExecResult, SandboxProvider } from './types'

/** 默认命令白名单（与 common DEFAULT_EXEC_ALLOWLIST 对齐，可由 config 覆盖） */
export const DEFAULT_ALLOW_COMMANDS = [
  'npm',
  'npx',
  'pnpm',
  'node',
  'git',
  'yarn',
  'tsc',
  'eslint',
  'vitest',
  'jest',
  'pytest',
] as const

/** 透传给子进程的宿主环境变量白名单（不含任何 API Key / 密钥） */
const ENV_ALLOWLIST = new Set([
  'PATH',
  'Path',
  'PATHEXT',
  'SystemRoot',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'LANG',
  'LC_ALL',
  'COMSPEC',
  'ComSpec',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMFILES',
  'PROGRAMFILES(X86)',
  'PROGRAMDATA',
  'NODE_ENV',
  'npm_config_registry',
  'npm_config_cache',
])

export interface LocalSandboxOptions {
  /** 工作区绝对路径（runs/<runId>/workspace） */
  workspacePath: string
  /** 模板项目路径；prepare 时拷贝（可选） */
  templatePath?: string
  /** 命令白名单；缺省 DEFAULT_ALLOW_COMMANDS */
  allowCommands?: readonly string[]
  /** 额外允许透传的环境变量名 */
  envAllowlist?: string[]
}

/**
 * P0 内嵌沙箱：独立工作区 + 受限 child_process。
 * 零外部依赖（无需 Docker），Windows 原生支持。见 docs/design/07。
 */
export class LocalSandboxProvider implements SandboxProvider {
  readonly kind = 'local' as const
  readonly workspacePath: string
  private readonly jail: PathJail
  private readonly templatePath?: string
  private readonly allowCommands: Set<string>
  private readonly envAllow: Set<string>
  /** 仍在跑的子进程（供 killRunning / AbortSignal） */
  private readonly running = new Set<ChildProcess>()

  constructor(options: LocalSandboxOptions) {
    this.workspacePath = options.workspacePath
    this.jail = new PathJail(options.workspacePath)
    this.templatePath = options.templatePath
    this.allowCommands = new Set(options.allowCommands ?? DEFAULT_ALLOW_COMMANDS)
    this.envAllow = new Set([...ENV_ALLOWLIST, ...(options.envAllowlist ?? [])])
  }

  killRunning(): void {
    for (const child of this.running) {
      killTree(child)
    }
    this.running.clear()
  }

  async prepare(): Promise<{ workspacePath: string }> {
    await mkdir(this.workspacePath, { recursive: true })
    if (this.templatePath && existsSync(this.templatePath)) {
      // 仅在工作区为空时拷贝模板，避免覆盖
      await cp(this.templatePath, this.workspacePath, { recursive: true, force: false })
    }
    return { workspacePath: this.workspacePath }
  }

  resolveInside(relPath: string): string {
    return this.jail.resolve(relPath)
  }

  async list(relPath: string = '.'): Promise<string[]> {
    const abs = this.jail.resolve(relPath)
    const entries = await readdir(abs, { withFileTypes: true })
    return entries
      .filter((e) => e.name !== 'node_modules' && !e.name.startsWith('.'))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort((a, b) => a.localeCompare(b))
  }

  async snapshot(): Promise<EnvSnapshot> {
    return {
      node: process.version,
      platform: `${osPlatform()} ${release()}`,
      arch: osArch(),
      osRelease: release(),
    }
  }

  async exec(input: ExecInput): Promise<ExecResult> {
    const started = Date.now()
    const command = input.argv.join(' ')

    if (!input.argv.length) {
      return reject('空命令', command, started)
    }
    const base = input.argv[0]!
    // 去掉可能的扩展名后比对白名单（npm.CMD / npm.cmd）
    const baseName = base.replace(/\.(cmd|exe|ps1)$/i, '')
    if (!this.allowCommands.has(base) && !this.allowCommands.has(baseName)) {
      return reject(`命令不在白名单，已拒绝：${base}`, command, started)
    }

    let cwd: string
    try {
      cwd = input.cwd ? this.jail.resolve(input.cwd) : this.workspacePath
    } catch (err) {
      return reject((err as Error).message, command, started)
    }

    if (input.signal?.aborted) {
      return reject('已取消', command, started)
    }

    const env = this.buildEnv(input.env)
    const { file, args, verbatim } = buildSpawn(input.argv)
    const headLines = input.headLines ?? 200
    const tailLines = input.tailLines ?? 200
    const maxChars = input.maxChars ?? 20_000

    return await new Promise<ExecResult>((resolve) => {
      let child: ChildProcess
      try {
        child = spawn(file, args, {
          cwd,
          env,
          // posix 下开新进程组，便于整组杀掉
          detached: process.platform !== 'win32',
          windowsHide: true,
          // Windows 下命令行由我们自行按 cmd 规则拼好，禁止 Node 再转义
          windowsVerbatimArguments: verbatim,
        })
      } catch (err) {
        resolve(reject(`启动子进程失败：${(err as Error).message}`, command, started))
        return
      }

      this.running.add(child)
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let aborted = false
      let settled = false

      const onAbort = () => {
        aborted = true
        killTree(child)
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      const timer = setTimeout(() => {
        timedOut = true
        killTree(child)
        // Windows 上偶发 close 迟迟不来：强制收尾，避免 Promise 挂死
        setTimeout(() => {
          if (settled) return
          const out = foldOutput(stdout, headLines, tailLines, maxChars)
          const errOut = foldOutput(stderr, headLines, tailLines, maxChars)
          finish({
            code: null,
            signal: 'SIGTERM',
            stdout: out.text,
            stderr: errOut.text,
            truncated: true,
            durationMs: Date.now() - started,
            command,
            rejected: aborted
              ? '已取消'
              : `命令超时（${input.timeoutMs}ms）已终止`,
          })
        }, 2000)
      }, input.timeoutMs)

      const finish = (result: ExecResult) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        input.signal?.removeEventListener('abort', onAbort)
        this.running.delete(child)
        resolve(result)
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdout.length < maxChars) stdout += chunk.toString('utf8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderr.length < maxChars) stderr += chunk.toString('utf8')
      })

      child.on('error', (err) => {
        finish(reject(`子进程错误：${err.message}`, command, started))
      })

      child.on('close', (code, signal) => {
        const out = foldOutput(stdout, headLines, tailLines, maxChars)
        const errOut = foldOutput(stderr, headLines, tailLines, maxChars)
        finish({
          code: timedOut || aborted ? null : code,
          signal: timedOut || aborted ? 'SIGTERM' : signal,
          stdout: out.text,
          stderr: errOut.text,
          truncated: out.truncated || errOut.truncated || timedOut,
          durationMs: Date.now() - started,
          command,
          ...(aborted
            ? { rejected: '已取消' }
            : timedOut
              ? { rejected: `命令超时（${input.timeoutMs}ms）已终止` }
              : {}),
        })
      })
    })
  }

  private buildEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const key of Object.keys(process.env)) {
      if (this.envAllow.has(key)) env[key] = process.env[key]
    }
    // 显式注入（仍只接受白名单键，杜绝密钥随子进程泄漏）
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (this.envAllow.has(k) || isSafeBuildVar(k)) env[k] = v
    }
    env.NODE_ENV = env.NODE_ENV ?? 'development'
    return env
  }
}

/** 额外放行明显与构建相关、无密钥风险的变量前缀 */
function isSafeBuildVar(key: string): boolean {
  return /^(npm_|YARN_|PNPM_|NODE_|CI|TURBO_|VITEST_|JEST_)/i.test(key) && !/TOKEN|KEY|SECRET|PASSWORD/i.test(key)
}

function reject(reason: string, command: string, started: number): ExecResult {
  return {
    code: null,
    signal: null,
    stdout: '',
    stderr: '',
    truncated: false,
    durationMs: Date.now() - started,
    rejected: reason,
    command,
  }
}

/** 跨平台 spawn 目标：Windows 下 npm/pnpm 等是 .cmd，需经 cmd.exe 执行 */
function buildSpawn(argv: string[]): { file: string; args: string[]; verbatim: boolean } {
  if (process.platform === 'win32') {
    const comspec = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe'
    // cmd /s /c "整条命令"：内部双引号按 cmd 规则用 "" 转义；
    // 配合 windowsVerbatimArguments，Node 不再二次转义。
    const inner = argv
      .map((t) => (/[\s&|<>^()]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t))
      .join(' ')
    return { file: comspec, args: ['/d', '/s', '/c', `"${inner}"`], verbatim: true }
  }
  return { file: argv[0]!, args: argv.slice(1), verbatim: false }
}

/** 杀进程树：posix 杀进程组；win32 用 taskkill /T /F */
function killTree(child: ChildProcess): void {
  const pid = child.pid
  if (pid == null) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }
}

/** 头尾保留 + 中间折叠；与 @chatvein/context 截断策略一致 */
function foldOutput(
  raw: string,
  headLines: number,
  tailLines: number,
  maxChars: number,
): { text: string; truncated: boolean } {
  const lines = raw.split(/\r?\n/)
  let truncated = false
  let body = raw
  if (lines.length > headLines + tailLines) {
    const head = lines.slice(0, headLines)
    const tail = lines.slice(lines.length - tailLines)
    const omitted = lines.length - headLines - tailLines
    body = [...head, `…（已省略 ${omitted} 行）…`, ...tail].join('\n')
    truncated = true
  }
  if (body.length > maxChars) {
    body = body.slice(0, maxChars) + `\n…（输出超过 ${maxChars} 字符，已截断）…`
    truncated = true
  }
  return { text: body, truncated }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
