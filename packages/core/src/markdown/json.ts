import { MAX_DEPTH } from './policy.ts'

/** Why a value cannot be stored as JSON, or `undefined` when it can. */
export type JsonProblem = 'shared' | 'depth' | 'number' | 'type'

function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * Checks that a value YAML or JSON gave can be stored as JSON and read back as it is. YAML anchors
 * and aliases build a value in which one array or object is reachable twice, so a few lines of
 * them are a tree of billions of nodes once they are written out (and `&a [*a]` is a cycle).
 * The walk is iterative, so no depth can overflow the stack, and it never visits a container
 * twice, so it takes time in proportion to what was parsed.
 */
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
