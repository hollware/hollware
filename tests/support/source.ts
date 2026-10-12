import { parseSync, Visitor } from 'vite-plus'

/**
 * Reads what a JavaScript or TypeScript file imports and which Node globals it touches.
 *
 * TypeScript 7 ships no JavaScript compiler API, so the parser is the one Vite+ re-exports
 * from Vite 8 (`parseSync`, Oxc). Comments, strings, template literals and regular
 * expressions are never mistaken for code, which a regular expression could not promise.
 *
 * Limits:
 * - Only literal specifiers are read. `import(name)` and `require(name)` with a computed
 *   argument are skipped, and so are `vi.mock('x')`-style strings.
 * - `/// <reference types="x" />` directives are comments and are not read. The type check
 *   of `vp check` is what resolves them.
 * - Node globals are found by name, without scope analysis: a local variable called
 *   `process` counts. Property names (`a.process`, `{ process: 1 }`, `class { process() {} }`),
 *   declaration names and calls (`process(x)`, because the Node global is not callable) do
 *   not.
 */

export type ReferenceKind =
  | 'import'
  | 'export-from'
  | 'dynamic-import'
  | 'import-type'
  | 'require'
  | 'require-resolve'
  | 'import-equals'

export interface ModuleReference {
  specifier: string
  kind: ReferenceKind
  line: number
}

export interface GlobalReference {
  name: string
  line: number
}

export interface LiteralProperty {
  /** The key of an object property, e.g. `fsModuleCache`. */
  key: string
  /** The literal value, when the property holds a boolean, a string or a number. */
  value: boolean | string | number
  line: number
}

export interface SourceAnalysis {
  references: ModuleReference[]
  globals: GlobalReference[]
  /** Object properties set to a literal, such as `{ fsModuleCache: true }`. */
  properties: LiteralProperty[]
  /** Syntax errors. A file that does not parse cannot be judged. */
  syntaxErrors: string[]
}

/** The Node globals that code meant to run anywhere must not use. */
export const NODE_GLOBALS = ['process', 'Buffer', '__dirname', '__filename', 'require'] as const

const NODE_GLOBAL_NAMES: ReadonlySet<string> = new Set(NODE_GLOBALS)

/** `globalThis.process` is the same global reached through its holder. */
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['globalThis', 'global', 'self'])

/** The 1-based line of a character offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1
  }
  return line
}

export function analyzeSource(path: string, text: string): SourceAnalysis {
  const result = parseSync(path, text)
  const references: ModuleReference[] = []
  const globals: GlobalReference[] = []
  const properties: LiteralProperty[] = []
  const add = (specifier: string, kind: ReferenceKind, offset: number): void => {
    references.push({ specifier, kind, line: lineAt(text, offset) })
  }

  // Identifiers that name a property, a declaration or a callee, collected on the way down
  // (the parent is visited before its children) and skipped when the identifier comes up.
  const notReferences = new WeakSet<object>()

  new Visitor({
    ImportDeclaration(node) {
      add(node.source.value, 'import', node.start)
    },
    ExportAllDeclaration(node) {
      add(node.source.value, 'export-from', node.start)
    },
    ExportNamedDeclaration(node) {
      if (node.source !== null) add(node.source.value, 'export-from', node.start)
    },
    ImportExpression(node) {
      const source = node.source
      if (source.type === 'Literal' && typeof source.value === 'string') {
        add(source.value, 'dynamic-import', node.start)
      } else if (
        source.type === 'TemplateLiteral' &&
        source.expressions.length === 0 &&
        source.quasis.length === 1
      ) {
        const cooked = source.quasis[0]?.value.cooked
        if (typeof cooked === 'string') add(cooked, 'dynamic-import', node.start)
      }
    },
    TSImportType(node) {
      add(node.source.value, 'import-type', node.start)
    },
    TSImportEqualsDeclaration(node) {
      if (node.moduleReference.type === 'TSExternalModuleReference') {
        add(node.moduleReference.expression.value, 'import-equals', node.start)
      }
    },
    CallExpression(node) {
      const { callee } = node
      const first = node.arguments[0]
      const literal =
        first !== undefined && first.type === 'Literal' && typeof first.value === 'string'
          ? first.value
          : undefined
      if (callee.type === 'Identifier') {
        if (callee.name === 'require' && literal !== undefined) add(literal, 'require', node.start)
        // `process(x)` cannot be the Node global: it is not callable.
        if (callee.name === 'process') notReferences.add(callee)
      } else if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'require' &&
        !callee.computed &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'resolve' &&
        literal !== undefined
      ) {
        add(literal, 'require-resolve', node.start)
      }
    },
    MemberExpression(node) {
      if (node.computed) return
      notReferences.add(node.property)
      if (
        node.object.type === 'Identifier' &&
        GLOBAL_OBJECTS.has(node.object.name) &&
        node.property.type === 'Identifier' &&
        NODE_GLOBAL_NAMES.has(node.property.name)
      ) {
        globals.push({
          name: `${node.object.name}.${node.property.name}`,
          line: lineAt(text, node.start),
        })
      }
    },
    Property(node) {
      if (!node.computed && !node.shorthand) notReferences.add(node.key)
      const key =
        node.key.type === 'Identifier'
          ? node.key.name
          : node.key.type === 'Literal' && typeof node.key.value === 'string'
            ? node.key.value
            : undefined
      const { value } = node
      if (
        key !== undefined &&
        !node.computed &&
        value.type === 'Literal' &&
        (typeof value.value === 'boolean' ||
          typeof value.value === 'string' ||
          typeof value.value === 'number')
      ) {
        properties.push({ key, value: value.value, line: lineAt(text, node.start) })
      }
    },
    MethodDefinition(node) {
      if (!node.computed) notReferences.add(node.key)
    },
    PropertyDefinition(node) {
      if (!node.computed) notReferences.add(node.key)
    },
    TSPropertySignature(node) {
      if (!node.computed) notReferences.add(node.key)
    },
    TSMethodSignature(node) {
      if (!node.computed) notReferences.add(node.key)
    },
    TSQualifiedName(node) {
      notReferences.add(node.right)
    },
    FunctionDeclaration(node) {
      if (node.id !== null) notReferences.add(node.id)
    },
    FunctionExpression(node) {
      if (node.id !== null) notReferences.add(node.id)
    },
    ClassDeclaration(node) {
      if (node.id !== null) notReferences.add(node.id)
    },
    VariableDeclarator(node) {
      notReferences.add(node.id)
    },
    ImportSpecifier(node) {
      notReferences.add(node.imported)
      notReferences.add(node.local)
    },
    ExportSpecifier(node) {
      notReferences.add(node.exported)
    },
    LabeledStatement(node) {
      notReferences.add(node.label)
    },
    Identifier(node) {
      if (NODE_GLOBAL_NAMES.has(node.name) && !notReferences.has(node)) {
        globals.push({ name: node.name, line: lineAt(text, node.start) })
      }
    },
  }).visit(result.program)

  return {
    references,
    globals,
    properties,
    syntaxErrors: result.errors.map((error) => error.message),
  }
}
