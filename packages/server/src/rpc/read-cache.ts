export const READ_CACHE_ENTRIES = 500

export interface ReadCache {
  remember<T>(key: string, read: () => Promise<T>): Promise<T>
}

export function createReadCache(limit: number = READ_CACHE_ENTRIES): ReadCache {
  const answers = new Map<string, { readonly answer: unknown }>()
  return {
    async remember<T>(key: string, read: () => Promise<T>): Promise<T> {
      const kept = answers.get(key)
      if (kept !== undefined) {
        answers.delete(key)
        answers.set(key, kept)
        return kept.answer as T
      }
      const answer = await read()
      answers.set(key, { answer })
      while (answers.size > limit) {
        const oldest = answers.keys().next()
        if (oldest.done === true) break
        answers.delete(oldest.value)
      }
      return answer
    },
  }
}
