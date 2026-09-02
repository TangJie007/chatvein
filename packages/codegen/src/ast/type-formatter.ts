import {
  SyntaxKind,
  TypeFormatFlags,
  type MethodDeclaration,
  type Node,
  type Type,
} from 'ts-morph'

const MAX_DEPTH = 10

/**
 * Format a TypeScript type for renderer-side .d.ts output.
 * Expands aliases/interfaces so generated types are self-contained.
 */
export function formatType(type: Type, context: Node, depth = 0): string {
  if (depth > MAX_DEPTH) return 'unknown'

  if (type.isUnknown()) return 'unknown'
  if (type.isNever()) return 'never'
  if (type.isVoid()) return 'void'
  if (type.isUndefined()) return 'undefined'
  if (type.isNull()) return 'null'

  const aliasSymbol = type.getAliasSymbol()
  if (aliasSymbol) {
    for (const decl of aliasSymbol.getDeclarations()) {
      if (decl.getKind() === SyntaxKind.TypeAliasDeclaration) {
        const aliasDecl = decl.asKindOrThrow(SyntaxKind.TypeAliasDeclaration)
        const typeParams = type.getAliasTypeArguments()
        if (typeParams.length > 0) {
          return formatType(type, context, depth + 1)
        }
        return formatType(aliasDecl.getType(), context, depth + 1)
      }
    }
  }

  const arrayElement = type.getArrayElementType()
  if (arrayElement) {
    return `${formatType(arrayElement, context, depth + 1)}[]`
  }

  if (type.isUnion()) {
    const unionTypes = type.getUnionTypes().filter((t) => !t.isUndefined())
    if (unionTypes.length === 1) {
      return formatType(unionTypes[0], context, depth + 1)
    }
    if (
      unionTypes.length === 2 &&
      unionTypes.every((t) => t.isBooleanLiteral()) &&
      unionTypes.some((t) => t.getText(context) === 'true') &&
      unionTypes.some((t) => t.getText(context) === 'false')
    ) {
      return 'boolean'
    }
    return unionTypes.map((t) => formatType(t, context, depth + 1)).join(' | ')
  }

  if (type.isObject() && !type.isArray()) {
    const symbol = type.getSymbol()
    if (symbol) {
      for (const decl of symbol.getDeclarations()) {
        const kind = decl.getKind()
        if (kind === SyntaxKind.InterfaceDeclaration || kind === SyntaxKind.TypeAliasDeclaration) {
          if (kind === SyntaxKind.TypeAliasDeclaration) {
            const aliasDecl = decl.asKindOrThrow(SyntaxKind.TypeAliasDeclaration)
            return formatType(aliasDecl.getType(), context, depth + 1)
          }
          return formatObjectType(type, context, depth + 1)
        }
      }
    }

    const callSignatures = type.getCallSignatures()
    if (callSignatures.length > 0) {
      return type.getText(context, TypeFormatFlags.NoTruncation)
    }

    return formatObjectType(type, context, depth + 1)
  }

  return type.getText(context, TypeFormatFlags.NoTruncation)
}

function formatObjectType(type: Type, context: Node, depth: number): string {
  const props = type.getProperties().filter((p) => !p.getName().startsWith('__'))
  if (props.length === 0) return 'Record<string, never>'

  const entries = props.map((prop) => {
    const decl = prop.getValueDeclaration() ?? prop.getDeclarations()[0]
    const optional = prop.isOptional() ? '?' : ''
    const propType = decl ? prop.getTypeAtLocation(decl) : prop.getTypeAtLocation(context)
    return `${prop.getName()}${optional}: ${formatType(propType, context, depth + 1)}`
  })

  const inline = `{ ${entries.join('; ')} }`
  if (inline.length <= 100) return inline

  return `{\n    ${entries.join('\n    ')}\n  }`
}

export function formatInvokeReturnType(method: MethodDeclaration, returnType: Type): string {
  const text = returnType.getText(method)

  if (text.startsWith('Promise<')) {
    const inner = returnType.getTypeArguments()[0]
    if (inner) {
      return `Promise<${formatType(inner, method)}>`
    }
  }

  return `Promise<${formatType(returnType, method)}>`
}

export function formatMethodParams(method: MethodDeclaration): string {
  return method
    .getParameters()
    .map((param) => {
      const optional = param.isOptional() || param.hasQuestionToken() ? '?' : ''
      const typeText = formatType(param.getType(), param)
      return `${param.getName()}${optional}: ${typeText}`
    })
    .join(', ')
}
