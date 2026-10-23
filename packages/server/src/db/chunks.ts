import { MAX_BOUND_PARAMETERS } from '../limits.ts'

export function rowsPerStatement(shared: number, perRow: number): number {
  return Math.max(1, Math.floor((MAX_BOUND_PARAMETERS - shared) / perRow))
}

export function chunk<Item>(items: readonly Item[], size: number): Item[][] {
  const groups: Item[][] = []
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size))
  }
  return groups
}
