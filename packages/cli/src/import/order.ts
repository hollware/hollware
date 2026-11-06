import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ORDER_FILE = '_order.json'

export interface Placed {
  readonly collection: string
  readonly locale: string
  readonly slugPath: string
  readonly position: number | null
}

function parentOf(slugPath: string): string {
  const slash = slugPath.lastIndexOf('/')
  return slash === -1 ? '' : slugPath.slice(0, slash)
}

export function orderOf(entries: readonly Placed[]): Record<string, string[]> | null {
  const order: Record<string, string[]> = {}
  const groups = new Map<string, Placed[]>()
  for (const entry of entries) {
    const key = `${entry.collection}/${entry.locale}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  for (const [key, group] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (group.every((entry) => entry.position === null)) continue
    const children = new Map<string, Placed[]>()
    for (const entry of group) {
      const parent = parentOf(entry.slugPath)
      children.set(parent, [...(children.get(parent) ?? []), entry])
    }
    const listed: string[] = []
    const visit = (parent: string): void => {
      const below = [...(children.get(parent) ?? [])].sort(
        (a, b) =>
          (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
          (a.slugPath < b.slugPath ? -1 : 1),
      )
      for (const entry of below) {
        listed.push(entry.slugPath)
        visit(entry.slugPath)
      }
    }
    visit('')
    order[key] = listed
  }
  return Object.keys(order).length === 0 ? null : order
}

export function readOrder(root: string): Record<string, readonly string[]> {
  const file = join(root, ORDER_FILE)
  if (!existsSync(file)) return {}
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]: [string, unknown]) => {
      if (!Array.isArray(value)) return []
      const paths = value.filter((one): one is string => typeof one === 'string')
      return paths.length === value.length ? [[key, paths]] : []
    }),
  )
}
