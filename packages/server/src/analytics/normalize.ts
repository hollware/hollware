import type { PageCount } from '../ports.ts'

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/

export function hostsOf(siteUrl: string | null, extra: readonly string[] = []): string[] {
  const hosts = [
    ...(siteUrl === null ? [] : [new URL(siteUrl).hostname.toLowerCase()]),
    ...extra.map((host) => host.toLowerCase()),
  ]
  const unique = [...new Set(hosts)]
  for (const host of unique) {
    if (!HOST.test(host)) throw new Error(`Not a host name: ${JSON.stringify(host)}`)
  }
  return unique
}

export function pathOf(raw: string): string | null {
  const path = raw.split(/[?#]/)[0] ?? ''
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (path === '/cdn-cgi' || path.startsWith('/cdn-cgi/')) return null
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export function ranked(
  counts: Iterable<{ readonly path: string; readonly views: number }>,
  limit: number,
): PageCount[] {
  const merged = new Map<string, number>()
  for (const count of counts) {
    const path = pathOf(count.path)
    if (path === null || !Number.isFinite(count.views) || count.views <= 0) continue
    merged.set(path, (merged.get(path) ?? 0) + count.views)
  }
  return [...merged]
    .map(([path, views]) => ({ path, views }))
    .sort((a, b) => b.views - a.views || a.path.localeCompare(b.path))
    .slice(0, limit)
}

export function sinceOf(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}
