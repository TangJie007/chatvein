#!/usr/bin/env node
// @ts-check
/**
 * 架构红线断言（M0-5 / 02-方案设计 §2.2、PRD §3.3）。
 *
 * 规则 1：packages/chatvein/** 是纯 Node 能力包，不得 import `electron`
 *         或 `@electrum/*`（壳框架）。否则 CLI/sidecar 无法在纯 Node 下跑。
 * 规则 2：app/src/main/forge/** 只允许调用 @chatvein/core 门面或 sidecar 协议，
 *         不得内嵌 LangGraph / LangChain 逻辑（不得 import @langchain/*）。
 *
 * 纯 Node 实现、零依赖，供 `pnpm check` 与 CI 调用。发现违规退出码 1。
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 递归收集目录下所有 .ts/.mjs/.js 文件（跳过 node_modules/dist/out/.vite） */
function collectFiles(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', 'out', '.vite', '.git'].includes(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) collectFiles(p, out)
    else if (/\.(ts|mjs|js|vue)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** 从源码里提取 import/require/动态 import 的模块说明符 */
const IMPORT_RE =
  /(?:import\s+[^'"]*?from\s*|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

function specifiersIn(content) {
  const specs = new Set()
  let m
  IMPORT_RE.lastIndex = 0
  while ((m = IMPORT_RE.exec(content))) specs.add(m[1])
  return [...specs]
}

/** 判断模块说明符是否命中某个前缀（含裸包名与子路径） */
function matches(spec, pkg) {
  return spec === pkg || spec.startsWith(`${pkg}/`)
}

const violations = []

// ── 规则 1：chatvein 能力包不得引 electron / @electrum/* ──
const harnessRoot = join(root, 'packages', 'chatvein')
for (const file of collectFiles(harnessRoot)) {
  const specs = specifiersIn(readFileSync(file, 'utf8'))
  for (const spec of specs) {
    if (matches(spec, 'electron') || spec.startsWith('@electrum/')) {
      violations.push({
        rule: 'chatvein 包不得依赖 electron / @electrum/*（须为纯 Node）',
        file: relative(root, file),
        spec,
      })
    }
  }
}

// ── 规则 2：app forge 模块不得内嵌 LangChain / LangGraph ──
const forgeRoot = join(root, 'app', 'src', 'main', 'forge')
for (const file of collectFiles(forgeRoot)) {
  const specs = specifiersIn(readFileSync(file, 'utf8'))
  for (const spec of specs) {
    if (spec.startsWith('@langchain/') || matches(spec, 'langchain')) {
      violations.push({
        rule: 'app forge 模块不得直接 import @langchain/*（只允许调用 @chatvein/core）',
        file: relative(root, file).split(sep).join('/'),
        spec,
      })
    }
  }
}

if (violations.length) {
  console.error(`\n✖ 架构红线检查发现 ${violations.length} 处违规：\n`)
  for (const v of violations) {
    console.error(`  · ${v.file}`)
    console.error(`    ${v.rule}`)
    console.error(`    → import "${v.spec}"\n`)
  }
  process.exit(1)
}

console.log('✓ 架构红线检查通过：chatvein 包零 electron/@electrum 依赖，app forge 无 LangChain 直引。')
