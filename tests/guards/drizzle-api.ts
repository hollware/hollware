import type { ESTree } from 'vite-plus'
import { parseSync, Visitor } from 'vite-plus'
import { lineAt } from '../support/source.ts'
import type { TextFile, Violation } from './types.ts'

const DRIZZLE = /^drizzle-orm(?:\/|$)/

function namesDatabase(node: ESTree.Expression | ESTree.Super): boolean {
  if (node.type === 'Identifier') return node.name === 'db'
  return (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    node.property.name === 'db'
  )
}

export function checkDrizzleApi(sources: readonly TextFile[]): Violation[] {
  const violations: Violation[] = []
  for (const source of sources) {
    const report = (offset: number, message: string): void => {
      violations.push({
        rule: 'drizzle-api/relational',
        file: source.path,
        message: `line ${lineAt(source.text, offset)} ${message}: Hollware writes its queries with the query builder`,
      })
    }
    new Visitor({
      MemberExpression(node) {
        if (
          !node.computed &&
          node.property.type === 'Identifier' &&
          node.property.name === 'query' &&
          namesDatabase(node.object)
        ) {
          report(node.start, 'reads db.query, the relational API of drizzle')
        }
      },
      ImportDeclaration(node) {
        if (!DRIZZLE.test(node.source.value)) return
        for (const item of node.specifiers) {
          if (
            item.type === 'ImportSpecifier' &&
            item.imported.type === 'Identifier' &&
            item.imported.name === 'relations'
          ) {
            report(node.start, `imports relations from ${node.source.value}`)
          }
        }
      },
    }).visit(parseSync(source.path, source.text).program)
  }
  return violations
}
