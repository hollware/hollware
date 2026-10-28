/** What the agents remember between runs: a few small values by key, some for a while only. */
export interface Memory {
  get(key: string): Promise<string | null>
  put(key: string, value: string, ttlSeconds?: number): Promise<void>
}

interface KvBinding {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

export function kvMemory(kv: KvBinding): Memory {
  return {
    get: (key) => kv.get(key),
    put: (key, value, ttlSeconds) =>
      kv.put(
        key,
        value,
        ttlSeconds === undefined ? undefined : { expirationTtl: Math.max(60, ttlSeconds) },
      ),
  }
}

/** Memory in a Map, for tests and for a single run. */
export function mapMemory(): Memory & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    async get(key) {
      return values.get(key) ?? null
    },
    async put(key, value) {
      values.set(key, value)
    },
  }
}
