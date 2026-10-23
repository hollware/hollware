import { MAX_DEPTH } from './policy.ts'

export type JsonProblem = 'shared' | 'depth' | 'number' | 'type'

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function jsonProblem(root: unknown): JsonProblem | undefined {
  const seen = new Set<object>()
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 1 }]
  while (stack.length > 0) {
    const item = stack.pop()
    if (item === undefined) break
    const { value, depth } = item
    if (value === null || typeof value === 'string' || typeof value === 'boolean') continue
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 'number'
      continue
    }
    if (typeof value !== 'object') return 'type'
    if (seen.has(value)) return 'shared'
    seen.add(value)
    if (depth > MAX_DEPTH) return 'depth'
    if (Array.isArray(value)) {
      for (const child of value) stack.push({ value: child, depth: depth + 1 })
    } else if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        stack.push({ value: Reflect.get(value, key), depth: depth + 1 })
      }
    } else {
      return 'type'
    }
  }
  return undefined
}
