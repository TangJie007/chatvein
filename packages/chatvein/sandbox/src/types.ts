/**
 * SandboxProvider 抽象（docs/design/07-沙箱方案.md §4）。
 *
 * P0 唯一实现 = LocalSandboxProvider（独立工作区 + 受限 child_process）。
 * tools / verifier 只允许经此接口执行命令，禁止直接 spawn 宿主路径。
 */

export type SandboxProviderKind = 'local' | 'docker'

/** 进程执行输入；argv 为已解析数组，禁止把 raw shell 字符串随意拼接 */
export interface ExecInput {
  /** 命令 + 参数，argv[0] 必须命中命令白名单 */
  argv: string[]
  /** 相对 workspace 的子目录；越界拒绝；缺省 = workspace 根 */
  cwd?: string
  /** 额外环境变量；与白名单基线合并，仍受 env 白名单约束 */
  env?: Record<string, string>
  /** 超时（毫秒）；超时杀进程树并返回 code=null */
  timeoutMs: number
  /** 覆盖默认 stdout/stderr 头部保留行数 */
  headLines?: number
  /** 覆盖默认尾部保留行数 */
  tailLines?: number
  /** 单次输出硬上限（字符），默认 20000 */
  maxChars?: number
}

export interface ExecResult {
  /** 退出码；超时/被杀为 null */
  code: number | null
  /** 终止信号（如有） */
  signal: string | null
  stdout: string
  stderr: string
  /** 输出是否被截断 */
  truncated: boolean
  durationMs: number
  /** 被拒绝（白名单/越界）时的原因；此时不执行进程 */
  rejected?: string
  /** 实际执行的命令行（用于 trace / 报告） */
  command: string
}

export interface EnvSnapshot {
  node: string
  platform: string
  arch: string
  osRelease: string
  /** 关键依赖版本（按需采集） */
  deps?: Record<string, string>
}

export interface SandboxProvider {
  readonly kind: SandboxProviderKind
  /** 工作区根目录（绝对路径） */
  readonly workspacePath: string
  /** 准备工作区：建目录、拷模板；幂等 */
  prepare(): Promise<{ workspacePath: string }>
  /** 在受限子进程中执行命令 */
  exec(input: ExecInput): Promise<ExecResult>
  /** 列出工作区内某目录的条目（目录名以 / 结尾）；越界抛错 */
  list(relPath?: string): Promise<string[]>
  /** 把相对 workspace 的路径解析为绝对路径，并校验不越界 */
  resolveInside(relPath: string): string
  /** 环境快照（写入 run.json，保证可复现） */
  snapshot(): Promise<EnvSnapshot>
}
