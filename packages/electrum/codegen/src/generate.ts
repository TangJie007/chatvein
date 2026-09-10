import * as fs from 'node:fs'
import * as path from 'node:path'
import { buildIpcApiDeclaration } from './build-declaration'
import { buildPreloadScript } from './build-preload'
import { createProject, scanIpcChannels, type IpcChannelSignature } from './ast/controller-scanner'

export interface GenerateIpcTypesOptions {
  /** Path to tsconfig.json (used to locate and type-check controller sources) */
  tsconfig: string
  /** Output .ts/.d.ts file path (absolute or relative to cwd) */
  outputPath: string
  /** Optional preload script output path (calls exposeApi + channel allowlist) */
  preloadOutputPath?: string
  /** Glob patterns for source scan (default: all .ts under tsconfig project) */
  include?: string[]
  /** Include devOnly IPC channels (default: true unless NODE_ENV=production) */
  includeDevOnly?: boolean
  /** Emit Window.api global alongside IpcApi (default: false) */
  includeGlobal?: boolean
}

export interface GenerateIpcTypesResult {
  outputPath: string
  preloadOutputPath?: string
  channels: IpcChannelSignature[]
}

/**
 * Scan @Controller + @IpcHandle methods and write renderer-side IpcApi types.
 *
 * ```ts
 * import { generateIpcTypes } from '@electrum/codegen'
 *
 * await generateIpcTypes({
 *   tsconfig: 'tsconfig.json',
 *   outputPath: 'src/renderer/ipc-api.ts',
 *   preloadOutputPath: 'src/preload/index.ts',
 * })
 * ```
 */
export async function generateIpcTypes(
  options: GenerateIpcTypesOptions,
): Promise<GenerateIpcTypesResult> {
  const tsconfig = path.resolve(options.tsconfig)
  const outputPath = path.resolve(options.outputPath)

  const project = createProject(tsconfig)
  const channels = scanIpcChannels(project, {
    include: options.include,
    includeDevOnly: options.includeDevOnly,
  })

  const content = buildIpcApiDeclaration(channels, {
    includeGlobal: options.includeGlobal,
  })

  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, content, 'utf-8')

  let preloadOutputPath: string | undefined
  if (options.preloadOutputPath) {
    preloadOutputPath = path.resolve(options.preloadOutputPath)
    fs.mkdirSync(path.dirname(preloadOutputPath), { recursive: true })
    fs.writeFileSync(preloadOutputPath, buildPreloadScript(channels), 'utf-8')
  }

  return { outputPath, preloadOutputPath, channels }
}

export type { IpcChannelSignature } from './ast/controller-scanner'
export { buildIpcApiDeclaration } from './build-declaration'
export { buildPreloadScript } from './build-preload'
export { scanIpcChannels, createProject } from './ast/controller-scanner'
