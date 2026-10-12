import type { ESTree } from 'vite-plus'
import { parseSync, Visitor } from 'vite-plus'

/**
 * Reads what a module exports and imports, and which functions a file calls, on the Oxc syntax
 * tree that `source.ts` also uses. Comments, strings and template literals are never taken for
 * code.
 *
 * Limits:
 * - Only value exports with a name are read: `export function`, `export const`, `export { a }`
 *   and `export { a } from '...'`. `export default`, `export * from '...'`, destructuring
 *   exports and everything declared with `export type` or `export interface` are not.
 * - A call is named only when its callee is a plain name (`check(x)`) or a member of one
 *   (`guard.check(x)`). `a.b.c(x)`, `a[b](x)` and `(await f())(x)` have no name.
 * - Names are resolved by scope, without hoisting or shadowing by parameters: a call to `f` is a
 *   call to the closest `function f` or `const f = () => ...` whose enclosing function contains
 *   the call. A function that is passed around and not called is not followed.
 */

/** A name a module exports. */
function moduleExportName(node: ESTree.ModuleExportName): string {
  return node.type === 'Literal' ? node.value : node.name
}

/** The names a module exports as values, in the order the file declares them. */
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

/** One name that an `import` declaration brings into a file. */
export interface ImportBinding {
  /** The module specifier, as written: `../guards/new.ts`. */
  specifier: string
  /** What it takes from the module: an export name, `default`, or `*` for the whole namespace. */
  imported: string
  /** The name it has in this file. */
  local: string
}

/** The value bindings of the `import` declarations of a file. Type-only ones are left out. */
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

/** Strips the wrappers that do not change what an expression is: parentheses, `!`, `as`. */
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

/** `check` for `check(x)`, `guard.check` for `guard.check(x)` and `guard['check'](x)`. */
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

/** A function the file defines under a name, and where that name can be used. */
interface Definition {
  name: string
  /** The function the declaration sits in, or the whole file. */
  scope: Span
  /** The function itself. */
  body: Span
}

/** The calls of a file, and what the functions it defines call in turn. */
export interface CallIndex {
  /** The names called between the offsets `start` and `end` of the file, and nowhere else. */
  directCalls: (start: number, end: number) => Set<string>
  /**
   * The same, plus what the functions called there call, as far as the file defines them: a call
   * to `check` adds the calls of the `check` the file defines, and theirs, and so on.
   */
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

  /** The definition a call to `name` at `offset` reaches: the one in the closest scope around it. */
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
