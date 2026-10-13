import { MAX_BOUND_PARAMETERS } from '../limits.ts'

/**
 * D1 refuses a statement with more than 100 bound values, and Miniflare enforces it too. Lookups
 * and multi-row inserts go in chunks that stay under `MAX_BOUND_PARAMETERS`.
 */

/**
 * How many rows of `perRow` bound values one statement can take when it also binds `shared`
 * values of its own. At least one: a row that does not fit alone is a bug of the statement.
 */
export function rowsPerStatement(shared: number, perRow: number): number {
  return Math.max(1, Math.floor((MAX_BOUND_PARAMETERS - shared) / perRow))
}

/** `items` in groups of at most `size`, in order. */
export function chunk<Item>(items: readonly Item[], size: number): Item[][] {
  const groups: Item[][] = []
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size))
  }
  return groups
}
