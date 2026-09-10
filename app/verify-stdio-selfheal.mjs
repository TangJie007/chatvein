import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const req = createRequire(import.meta.url)
const root = mkdtempSync(join(tmpdir(), 'cv-rsb-heal-'))

// ---- 在导入被测模块前，patch child_process.spawn 以捕获 runsandbox 子进程 ----
const cp = req('child_process')
const cliChildren = []
const realSpawn = cp.spawn
cp.spawn = function patchedSpawn(command, args, options) {
  const child = realSpawn.call(this, command, args, options)
  const argList = Array.isArray(args) ? args : []
  if (argList.some((a) => String(a).includes('cli.js'))) {
    cliChildren.push(child)
    console.log(`[capture] spawned runsandbox child pid=${child.pid}`)
  }
  return child
}

// ---- 用 esbuild 把 stdio.ts 打成可在 node 直接跑的 ESM（依赖保持 external）----
// 注意：bundle 必须落在 app 目录内，否则 external 依赖（@langchain/*、@chatvein/*）
// 在临时目录的 node_modules 里找不到。测试结束清理。
const esbuild = await import('esbuild')
const entry = join(process.cwd(), 'src/main/mcp/stdio.ts')
const outfile = join(process.cwd(), '.stdio-selfheal-bundle.mjs')
await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  packages: 'external',
  outfile,
  logLevel: 'silent',
})

const { mountRunsandboxStdio } = await import(pathToFileURL(outfile).href)
console.log('mounting runsandbox stdio (self-heal mode)...')
const mount = await mountRunsandboxStdio(root)
const writeSpec = mount.specs.find((s) => s.name === 'run_code')
const tool = await writeSpec.resolve()

// 1) 基线调用
let r1 = await tool.invoke({ workspace: root, code: "print('baseline')" })
console.log('[1] baseline =>', r1.content?.[0]?.text ?? r1)
const childrenAfterBaseline = cliChildren.length
console.log(`    captured children after baseline: ${childrenAfterBaseline}`)

// 2) 模拟崩溃：杀掉当前子进程
const victim = cliChildren[cliChildren.length - 1]
console.log(`[2] killing child pid=${victim.pid} to simulate crash...`)
victim.kill('SIGKILL')
// 给传输一点时间感知断开
await new Promise((res) => setTimeout(res, 500))

// 3) 同一委托工具再次调用 —— 应自动重建子进程并重试成功
let r2
let healed = false
try {
  r2 = await tool.invoke({ workspace: root, code: "print('after-crash')" })
  healed = cliChildren.length > childrenAfterBaseline
  console.log('[3] after-crash call =>', r2.content?.[0]?.text ?? r2)
} catch (err) {
  console.log('[3] after-crash call FAILED:', err?.message ?? err)
}

await mount.close()
console.log(`\nRESULT: healed=${healed} newChildren=${cliChildren.length - childrenAfterBaseline}`)
rmSync(outfile, { force: true })
process.exit(healed && r2 ? 0 : 1)
