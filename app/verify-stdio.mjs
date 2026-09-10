import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'

const req = createRequire(import.meta.url)
function resolveCli() {
  const mainPath = req.resolve('@chatvein/mcp-runsandbox-sdk')
  return join(dirname(mainPath), 'cli.js')
}

const { MultiServerMCPClient } = await import('@langchain/mcp-adapters')
const root = mkdtempSync(join(tmpdir(), 'cv-rsb-'))
const cli = resolveCli()
console.log('spawning runsandbox subprocess:', cli)

const client = new MultiServerMCPClient({
  mcpServers: {
    runsandbox: {
      transport: 'stdio',
      command: process.execPath,
      args: [cli, root],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      defaultToolTimeout: 120000,
      // 不开 restart：否则 client.close() 会重连出孤儿子进程导致进程卡死。
    },
  },
})

const tools = await client.getTools()
console.log('\nrunsandbox tools over stdio subprocess:')
for (const t of tools) {
  // 适配器把输入 schema 以 JSON Schema 对象形式挂在 tool.schema 上（不是 Zod 对象），
  // 参数名在 schema.properties 里，而非 schema.shape。
  const keys = Object.keys(t.schema?.properties ?? {})
  console.log(`  - ${t.name} | args: ${keys.join(', ')}`)
}

// 端到端冒烟：真正初始化环境并执行一段代码，确认子进程能干活且返回符合预期。
// （Python 环境在对话创建时由宿主预热，run_code 首次执行也会兜底自检；此处直接验证 run_code。）
const runTool = tools.find((t) => t.name === 'run_code')
const runRes = await runTool.invoke({
  workspace: root,
  code: "print('hello from runsandbox')\nimport sys\nprint('argv:', sys.argv[1:])",
  args: ['a', 'b'],
})
console.log('\nsmoke call run_code =>', runRes.content?.[0]?.text ?? runRes)

await client.close()
console.log(`\nOK · 子进程已关闭 · 工具数 = ${tools.length}`)
// 确保事件循环清空后干净退出（不开 restart 时 close() 会杀掉子进程，无残留句柄）。
process.exit(0)
