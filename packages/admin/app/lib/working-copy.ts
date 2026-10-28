export interface WorkingCopy {
  readonly markdown: string
  readonly version: number
}

export interface CopyStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SAVE_AFTER_MS = 8_000
export const SAVE_AT_MOST_MS = 60_000

export const workingCopyKey = (site: string, entryId: string): string =>
  `hollware:working-copy:${site}:${entryId}`

export function browserStorage(): CopyStorage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

export function readWorkingCopy(storage: CopyStorage | undefined, key: string): WorkingCopy | null {
  try {
    const raw = storage?.getItem(key) ?? null
    const value: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof value !== 'object' || value === null) return null
    const markdown: unknown = Reflect.get(value, 'markdown')
    const version: unknown = Reflect.get(value, 'version')
    return typeof markdown === 'string' && typeof version === 'number' && Number.isInteger(version)
      ? { markdown, version }
      : null
  } catch {
    return null
  }
}

export function keepWorkingCopy(
  storage: CopyStorage | undefined,
  key: string,
  copy: WorkingCopy,
): void {
  try {
    storage?.setItem(key, JSON.stringify(copy))
  } catch {
    return
  }
}

export function dropWorkingCopy(storage: CopyStorage | undefined, key: string): void {
  try {
    storage?.removeItem(key)
  } catch {
    return
  }
}

export type Restore =
  | { readonly kind: 'none' }
  | { readonly kind: 'same'; readonly markdown: string }
  | { readonly kind: 'older'; readonly markdown: string; readonly version: number }

export function restoreOf(
  copy: WorkingCopy | null,
  entry: { readonly version: number; readonly markdown: string },
): Restore {
  if (copy === null || copy.markdown === entry.markdown || copy.version > entry.version) {
    return { kind: 'none' }
  }
  return copy.version === entry.version
    ? { kind: 'same', markdown: copy.markdown }
    : { kind: 'older', markdown: copy.markdown, version: copy.version }
}

export function saveDelay(firstChangeAt: number, now: number): number {
  return Math.max(0, Math.min(SAVE_AFTER_MS, firstChangeAt + SAVE_AT_MOST_MS - now))
}
