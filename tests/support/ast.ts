import type { ESTree } from 'vite-plus'
import { parseSync, Visitor } from 'vite-plus'

function moduleExportName(node: ESTree.ModuleExportName): string {
  return node.type === 'Literal' ? node.value : node.name
}

export function exportedNames(path: string, text: string): string[] {
  const names: string[] = []
  new Visitor({
    ExportNamedDeclaration(node) {
      if (node.exportKind === 'type') return
      const { declaration } = node
      if (declaration?.type === 'FunctionDeclaration' && declaration.id !== null) {
        names.push(declaration.id.name)
      } else if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations) {
          if (declarator.id.type === 'Identifier') names.push(declarator.id.name)
        }
      }
      for (const specifier of node.specifiers) {
        if (specifier.exportKind !== 'type') names.push(moduleExportName(specifier.exported))
      }
    },
  }).visit(parseSync(path, text).program)
  return names
}

export interface ImportBinding {
  specifier: string
  imported: string
  local: string
}

export function importBindings(path: string, text: string): ImportBinding[] {
  const bindings: ImportBinding[] = []
  new Visitor({
    ImportDeclaration(node) {
      if (node.importKind === 'type') return
      const specifier = node.source.value
      for (const item of node.specifiers) {
        if (item.type === 'ImportSpecifier') {
          if (item.importKind === 'type') continue
          bindings.push({
            specifier,
            imported: moduleExportName(item.imported),
            local: item.local.name,
          })
        } else if (item.type === 'ImportDefaultSpecifier') {
          bindings.push({ specifier, imported: 'default', local: item.local.name })
        } else {
          bindings.push({ specifier, imported: '*', local: item.local.name })
        }
      }
    },
  }).visit(parseSync(path, text).program)
  return bindings
}

function unwrap(node: ESTree.Expression): ESTree.Expression {
  switch (node.type) {
    case 'ParenthesizedExpression':
    case 'TSNonNullExpression':
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return unwrap(node.expression)
    default:
      return node
  }
}

function calleeName(callee: ESTree.Expression): string | undefined {
  const node = unwrap(callee)
  if (node.type === 'Identifier') return node.name
  if (node.type !== 'MemberExpression') return undefined
  const object = unwrap(node.object)
  if (object.type !== 'Identifier') return undefined
  if (!node.computed) {
    return node.property.type === 'Identifier' ? `${object.name}.${node.property.name}` : undefined
  }
  const { property } = node
  return property.type === 'Literal' && typeof property.value === 'string'
    ? `${object.name}.${property.value}`
    : undefined
}

interface Span {
  start: number
  end: number
}

interface Definition {
  name: string
  scope: Span
  body: Span
}

export interface CallIndex {
  directCalls: (start: number, end: number) => Set<string>
  reachableCalls: (start: number, end: number) => Set<string>
}

export function indexCalls(path: string, text: string): CallIndex {
  const calls: { name: string; start: number }[] = []
  const definitions: Definition[] = []
  const scopes: Span[] = [{ start: 0, end: text.length }]
  const scope = (): Span => scopes[scopes.length - 1] ?? { start: 0, end: text.length }
  const enter = (node: Span): void => {
    scopes.push({ start: node.start, end: node.end })
  }
  const leave = (): void => {
    scopes.pop()
  }

  new Visitor({
    CallExpression(node) {
      const name = calleeName(node.callee)
      if (name !== undefined) calls.push({ name, start: node.start })
    },
    FunctionDeclaration(node) {
      if (node.id !== null) {
        definitions.push({
          name: node.id.name,
          scope: scope(),
          body: { start: node.start, end: node.end },
        })
      }
      enter(node)
    },
    'FunctionDeclaration:exit': leave,
    FunctionExpression: enter,
    'FunctionExpression:exit': leave,
    ArrowFunctionExpression: enter,
    'ArrowFunctionExpression:exit': leave,
    VariableDeclarator(node) {
      if (node.id.type !== 'Identifier' || node.init === null) return
      const init = unwrap(node.init)
      if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') {
        definitions.push({
          name: node.id.name,
          scope: scope(),
          body: { start: init.start, end: init.end },
        })
      }
    },
  }).visit(parseSync(path, text).program)

  const resolve = (name: string, offset: number): Definition | undefined => {
    let best: Definition | undefined
    for (const definition of definitions) {
      const { scope: around } = definition
      if (definition.name !== name || offset < around.start || offset >= around.end) continue
      if (best === undefined || around.end - around.start < best.scope.end - best.scope.start) {
        best = definition
      }
    }
    return best
  }

  const directCalls = (start: number, end: number): Set<string> =>
    new Set(calls.filter((call) => call.start >= start && call.start < end).map((c) => c.name))

  const reachableCalls = (start: number, end: number): Set<string> => {
    const found = new Set<string>()
    const followed = new Set<Definition>()
    const walk = (from: number, to: number): void => {
      for (const call of calls) {
        if (call.start < from || call.start >= to) continue
        found.add(call.name)
        const definition = resolve(call.name, call.start)
        if (definition !== undefined && !followed.has(definition)) {
          followed.add(definition)
          walk(definition.body.start, definition.body.end)
        }
      }
    }
    walk(start, end)
    return found
  }

  return { directCalls, reachableCalls }
}
