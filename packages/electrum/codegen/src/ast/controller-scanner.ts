import { Project, type ClassDeclaration, type MethodDeclaration } from 'ts-morph'
import { getControllerPrefix, getIpcHandleMeta } from './decorator-utils'
import { formatInvokeReturnType, formatMethodParams } from './type-formatter'

export interface IpcChannelSignature {
  channel: string
  params: string
  returnType: string
  sourceFile: string
  controller: string
  method: string
}

export interface ScanOptions {
  /** Glob patterns passed to Project.addSourceFilesAtPaths (relative to tsconfig dir) */
  include?: string[]
  /** Include @IpcHandle channels marked devOnly (default: true in development) */
  includeDevOnly?: boolean
}

export function scanIpcChannels(
  project: Project,
  options: ScanOptions = {},
): IpcChannelSignature[] {
  const includeDevOnly = options.includeDevOnly ?? process.env.NODE_ENV !== 'production'

  const sourceFiles =
    options.include && options.include.length > 0
      ? project.addSourceFilesAtPaths(options.include)
      : project.getSourceFiles()

  const channels: IpcChannelSignature[] = []

  for (const sourceFile of sourceFiles) {
    if (sourceFile.isDeclarationFile()) continue
    for (const classDecl of sourceFile.getClasses()) {
      channels.push(...scanController(classDecl, includeDevOnly))
    }
  }

  channels.sort((a, b) => a.channel.localeCompare(b.channel))
  return channels
}

function scanController(
  classDecl: ClassDeclaration,
  includeDevOnly: boolean,
): IpcChannelSignature[] {
  const prefix = getControllerPrefix(classDecl)
  if (prefix === null) return []

  const controllerName = classDecl.getName() ?? 'AnonymousController'
  const results: IpcChannelSignature[] = []

  for (const method of classDecl.getMethods()) {
    const meta = getIpcHandleMeta(method)
    if (!meta) continue
    if (meta.devOnly && !includeDevOnly) continue

    const signature = buildMethodSignature(method, prefix, meta.channel)
    results.push({
      ...signature,
      sourceFile: method.getSourceFile().getFilePath(),
      controller: controllerName,
      method: method.getName(),
    })
  }

  return results
}

function buildMethodSignature(
  method: MethodDeclaration,
  prefix: string,
  channel: string,
): Pick<IpcChannelSignature, 'channel' | 'params' | 'returnType'> {
  const fullChannel = prefix ? `${prefix}:${channel}` : channel
  const params = formatMethodParams(method)
  const returnType = formatInvokeReturnType(method, method.getReturnType())

  return { channel: fullChannel, params, returnType }
}

export function createProject(tsconfigPath: string): Project {
  return new Project({
    tsConfigFilePath: tsconfigPath,
    skipAddingFilesFromTsConfig: false,
  })
}
