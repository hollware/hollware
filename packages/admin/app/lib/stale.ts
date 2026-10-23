const KEY = 'hollware.reloadedAt'
const AT_MOST_EVERY = 10_000

export function isStaleFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed|Unable to preload/i.test(
    message,
  )
}

export function loadAgainOnce(
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
  now: number,
  load: () => void,
): boolean {
  let last = 0
  try {
    last = Number(storage?.getItem(KEY) ?? 0)
  } catch {
    last = 0
  }
  if (now - last < AT_MOST_EVERY) return false
  try {
    storage?.setItem(KEY, String(now))
  } catch {}
  load()
  return true
}

export function sessionStore(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}
