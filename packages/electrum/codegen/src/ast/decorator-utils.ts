import { SyntaxKind, type ClassDeclaration, type MethodDeclaration } from 'ts-morph'

export function getControllerPrefix(classDecl: ClassDeclaration): string | null {
  const decorator = classDecl.getDecorator('Controller')
  if (!decorator) return null

  const args = decorator.getArguments()
  if (args.length === 0) return ''

  const first = args[0]
  if (first.getKind() === SyntaxKind.StringLiteral) {
    return first.getLiteralText()
  }

  if (first.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const prefixProp = first.getProperty('prefix')
    if (prefixProp?.getKind() === SyntaxKind.PropertyAssignment) {
      const init = prefixProp.getInitializer()
      if (init?.getKind() === SyntaxKind.StringLiteral) {
        return init.getLiteralText()
      }
    }
  }

  return ''
}

export interface IpcHandleMeta {
  channel: string
  devOnly: boolean
}

export function getIpcHandleMeta(method: MethodDeclaration): IpcHandleMeta | null {
  const decorator = method.getDecorator('IpcHandle')
  if (!decorator) return null

  const args = decorator.getArguments()
  const channelArg = args[0]
  if (!channelArg || channelArg.getKind() !== SyntaxKind.StringLiteral) return null

  let devOnly = false
  const optionsArg = args[1]
  if (optionsArg?.getKind() === SyntaxKind.ObjectLiteralExpression) {
    const devOnlyProp = optionsArg.getProperty('devOnly')
    if (devOnlyProp?.getKind() === SyntaxKind.PropertyAssignment) {
      const init = devOnlyProp.getInitializer()
      if (init?.getKind() === SyntaxKind.TrueKeyword) devOnly = true
    }
  }

  return { channel: channelArg.getLiteralText(), devOnly }
}
