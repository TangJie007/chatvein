/**
 * 加载 forge.config：支持 .ts / .mjs / .js / .json。
 * .ts 用 jiti 运行时加载（无需预编译）；密钥从环境变量注入，不写进配置文件。
 */
import { resolve, isAbsolute } from 'node:path'
import { existsSync } from 'node:fs'
import type { ForgeConfig } from '@chatvein/common'
import { parseForgeConfig } from '@chatvein/common'

/** 从环境变量注入 API Key 的约定：FORGE_MODEL_KEY_<TIER> 或 FORGE_API_KEY */
function applyEnvKeys(config: ForgeConfig): ForgeConfig {
  const globalKey = process.env.FORGE_API_KEY
  for (const tier of ['strong', 'medium', 'weak'] as const) {
    const tierKey = process.env[`FORGE_MODEL_KEY_${tier.toUpperCase()}`] ?? globalKey
    if (tierKey) {
      config.models[tier] = config.models[tier].map((e) => ({ ...e, apiKey: e.apiKey ?? tierKey }))
    }
  }
  return config
}

export async function loadForgeConfig(configPath?: string): Promise<ForgeConfig> {
  const path = configPath
    ? isAbsolute(configPath)
      ? configPath
      : resolve(process.cwd(), configPath)
    : resolve(process.cwd(), 'forge.config.ts')

  if (!existsSync(path)) {
    // 无配置文件：尝试从环境变量构造最小配置（baseUrl/model 也走 env）
    return parseForgeConfig(envFallbackConfig())
  }

  let raw: unknown
  if (path.endsWith('.json')) {
    raw = JSON.parse(await import('node:fs/promises').then((f) => f.readFile(path, 'utf8')))
  } else {
    // jiti 加载 .ts/.mjs/.js
    const { createJiti } = await import('jiti')
    const jiti = createJiti(import.meta.url, { interopDefault: true })
    raw = await jiti.import(path)
  }

  const config = parseForgeConfig((raw as { default?: unknown }).default ?? raw)
  return applyEnvKeys(config)
}

/** 无配置文件时的环境变量兜底 */
function envFallbackConfig(): unknown {
  const baseUrl = process.env.FORGE_BASE_URL
  const model = process.env.FORGE_MODEL
  if (!baseUrl || !model) {
    throw new Error(
      '未找到 forge.config，且环境变量 FORGE_BASE_URL / FORGE_MODEL 未设置。请提供 --config 或设置环境变量。',
    )
  }
  const endpoint = {
    id: 'env-default',
    baseUrl,
    model,
    apiKey: process.env.FORGE_API_KEY,
  }
  return {
    models: { strong: [endpoint], medium: [endpoint], weak: [endpoint] },
  }
}
