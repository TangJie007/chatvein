import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PathJail } from '../path-jail'
import { LocalSandboxProvider } from '../local-provider'

async function makeSandbox(): Promise<LocalSandboxProvider> {
  const root = await mkdtemp(join(tmpdir(), 'forge-sbx-'))
  const ws = join(root, 'workspace')
  const sbx = new LocalSandboxProvider({ workspacePath: ws })
  await sbx.prepare()
  return sbx
}

describe('PathJail', () => {
  it('放行 workspace 内路径，拒绝越界', () => {
    const jail = new PathJail('/tmp/ws')
    expect(jail.isInside('/tmp/ws/src/a.ts')).toBe(true)
    expect(jail.isInside('/tmp/ws')).toBe(true)
    expect(jail.isInside('/tmp/other')).toBe(false)
    expect(() => jail.resolve('../../etc/passwd')).toThrow(/越出工作区/)
  })
})

describe('LocalSandboxProvider', () => {
  it('两次 prepare 的工作区互不覆盖（路径独立）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'forge-sbx2-'))
    const a = new LocalSandboxProvider({ workspacePath: join(root, 'run-a', 'workspace') })
    const b = new LocalSandboxProvider({ workspacePath: join(root, 'run-b', 'workspace') })
    await a.prepare()
    await b.prepare()
    await writeFile(join(a.workspacePath, 'x.txt'), 'A')
    await expect(readFile(join(b.workspacePath, 'x.txt'), 'utf8')).rejects.toThrow()
  })

  it('白名单外命令被拒绝且不执行', async () => {
    const sbx = await makeSandbox()
    const res = await sbx.exec({ argv: ['rm', '-rf', '/'], timeoutMs: 5000 })
    expect(res.rejected).toMatch(/白名单/)
    expect(res.code).toBeNull()
  })

  it('越界 cwd 被拒绝', async () => {
    const sbx = await makeSandbox()
    const res = await sbx.exec({ argv: ['node', '-v'], cwd: '../../../etc', timeoutMs: 5000 })
    expect(res.rejected).toMatch(/越出工作区/)
  })

  it('白名单命令在 workspace 内可执行并返回退出码', async () => {
    const sbx = await makeSandbox()
    const res = await sbx.exec({ argv: ['node', '-e', 'console.log("ok")'], timeoutMs: 15000 })
    expect(res.rejected).toBeUndefined()
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('ok')
  })

  it('超时命令被杀掉，返回 code=null', async () => {
    const sbx = await makeSandbox()
    const res = await sbx.exec({ argv: ['node', '-e', 'setTimeout(()=>{}, 10000)'], timeoutMs: 500 })
    expect(res.code).toBeNull()
    expect(res.rejected).toMatch(/超时/)
  }, 10000)

  it('子进程环境不包含宿主伪造的密钥', async () => {
    process.env.FORGE_FAKE_API_KEY = 'super-secret'
    try {
      const sbx = await makeSandbox()
      const res = await sbx.exec({
        argv: ['node', '-e', 'console.log(process.env.FORGE_FAKE_API_KEY || "CLEAN")'],
        timeoutMs: 15000,
      })
      expect(res.stdout).toContain('CLEAN')
      expect(res.stdout).not.toContain('super-secret')
    } finally {
      delete process.env.FORGE_FAKE_API_KEY
    }
  })

  it('snapshot 返回 node 版本与平台', async () => {
    const sbx = await makeSandbox()
    const snap = await sbx.snapshot()
    expect(snap.node).toMatch(/^v\d+/)
    expect(snap.platform).toBeTruthy()
  })
})
