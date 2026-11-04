export const LATEST_RELEASE_URL = 'https://registry.npmjs.org/hollware/latest'
export const FRESH_MS = 6 * 60 * 60 * 1000
export const RETRY_MS = 15 * 60 * 1000
export const ASK_TIMEOUT_MS = 3_000
export const MAX_RELEASE_BYTES = 64 * 1024

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

async function boundedText(response: Response): Promise<string | null> {
  if (response.body === null) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_RELEASE_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const whole = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    whole.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(whole)
}

async function ask(fetcher: Fetch): Promise<string | null> {
  try {
    const response = await fetcher(LATEST_RELEASE_URL, {
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    })
    if (!response.ok) {
      await response.body?.cancel()
      return null
    }
    const text = await boundedText(response)
    if (text === null) return null
    const body: unknown = JSON.parse(text)
    const version =
      typeof body === 'object' && body !== null ? Reflect.get(body, 'version') : undefined
    return typeof version === 'string' && SEMVER.test(version) ? version : null
  } catch {
    return null
  }
}

export function latestRelease(fetcher: Fetch): (now: number) => Promise<string | null> {
  let known: { readonly version: string | null; readonly until: number } | null = null
  return async (now) => {
    if (known !== null && now < known.until) return known.version
    const asked = await ask(fetcher)
    known =
      asked === null
        ? { version: known?.version ?? null, until: now + RETRY_MS }
        : { version: asked, until: now + FRESH_MS }
    return known.version
  }
}

function compareIdentifiers(left: string, right: string): number {
  const [a, b] = [left.split('.'), right.split('.')]
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const [x, y] = [a[index], b[index]]
    if (x === undefined) return -1
    if (y === undefined) return 1
    const [numericX, numericY] = [/^\d+$/.test(x), /^\d+$/.test(y)]
    if (numericX && numericY) {
      if (Number(x) !== Number(y)) return Number(x) - Number(y)
    } else if (numericX !== numericY) {
      return numericX ? -1 : 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}

export function isNewer(candidate: string, installed: string): boolean {
  const [a, b] = [SEMVER.exec(candidate), SEMVER.exec(installed)]
  if (a === null || b === null) return false
  for (const index of [1, 2, 3]) {
    const difference = Number(a[index]) - Number(b[index])
    if (difference !== 0) return difference > 0
  }
  const [preA, preB] = [a[4], b[4]]
  if (preA === undefined) return preB !== undefined
  if (preB === undefined) return false
  return compareIdentifiers(preA, preB) > 0
}
