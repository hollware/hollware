/**
 * A page of the admin loaded before a deploy asks for files of its own version (the code of each
 * page is a file of its own), which the new version may not have. When one fails to load, the
 * admin loads again, now the new version, where the person was, instead of staying broken. At
 * most once in ten seconds, so a file that is truly missing shows its error instead of looping.
 */

const KEY = 'hollware.reloadedAt'
const AT_MOST_EVERY = 10_000

/** Whether an error is a file of the code that failed to load, as browsers word it. */
export function isStaleFile(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /dynamically imported module|Importing a module script failed|Unable to preload/i.test(
    message,
  )
}

/** Runs `load` unless it ran in the last ten seconds; says whether it did. */
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
  } catch {
    // Without storage the guard is gone; loading again is still better than a broken page.
  }
  load()
  return true
}

/** The session storage of the page, or nothing where the browser refuses it. */
export function sessionStore(): Storage | undefined {
  try {
    return globalThis.sessionStorage
  } catch {
    return undefined
  }
}
