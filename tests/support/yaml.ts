import { isMap, isScalar, isSeq, LineCounter, parseDocument, visit } from 'yaml'
import type { Document, Node, Scalar, YAMLMap } from 'yaml'

export interface YamlFile {
  doc: Document.Parsed
  errors: string[]
  hasAliases: boolean
  lineOf: (offset: number) => number
  trailingComment: (node: Node) => string | undefined
}

export function readYaml(text: string): YamlFile {
  const lineCounter = new LineCounter()
  const doc = parseDocument(text, { lineCounter })
  let hasAliases = false
  visit(doc, {
    Alias() {
      hasAliases = true
    },
  })
  return {
    doc,
    errors: doc.errors.map((error) => error.message.split('\n')[0] ?? error.message),
    hasAliases,
    lineOf: (offset) => lineCounter.linePos(offset).line,
    trailingComment: (node) => {
      const end = node.range?.[1]
      if (end === undefined) return undefined
      const lineEnd = text.indexOf('\n', end)
      const rest = text.slice(end, lineEnd === -1 ? text.length : lineEnd)
      const match = /^[ \t]*#(.*)$/.exec(rest)
      const comment = match?.[1]
      return comment === undefined ? undefined : comment.trim()
    },
  }
}

export function plain(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node
  if (isScalar(node)) return node.value
  if ('toJSON' in node && typeof node.toJSON === 'function') {
    const value: unknown = node.toJSON()
    return value
  }
  return undefined
}

export function scalarString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined
}

export function mapEntry(map: YAMLMap, key: string): { key: Scalar; value: unknown } | undefined {
  for (const pair of map.items) {
    if (isScalar(pair.key) && pair.key.value === key) return { key: pair.key, value: pair.value }
  }
  return undefined
}

export { isMap, isScalar, isSeq }
