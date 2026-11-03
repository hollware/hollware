export interface NewestOnly {
  run<T>(work: () => Promise<T>): Promise<{ readonly value: T } | null>
  skip(): void
}

export function newestOnly(): NewestOnly {
  let turn = 0
  return {
    async run(work) {
      const mine = ++turn
      try {
        const value = await work()
        return mine === turn ? { value } : null
      } catch {
        return null
      }
    },
    skip() {
      turn += 1
    },
  }
}
