export type Done<Item, Answer> =
  | { readonly item: Item; readonly answer: Answer }
  | { readonly item: Item; readonly error: unknown }

export const AT_ONCE = 4

export async function runAll<Item, Answer>(
  items: readonly Item[],
  task: (item: Item) => Promise<Answer>,
  atOnce = AT_ONCE,
): Promise<Done<Item, Answer>[]> {
  const results: Done<Item, Answer>[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      const item = items[index] as Item
      try {
        results[index] = { item, answer: await task(item) }
      } catch (error) {
        results[index] = { item, error }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(atOnce, items.length) }, worker))
  return results
}

export function countOutcomes<Item, Answer extends { readonly outcome: string }>(
  results: readonly Done<Item, Answer>[],
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const result of results) {
    const key = 'error' in result ? 'failed' : result.answer.outcome
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

export function summaryOf(
  counts: ReadonlyMap<string, number>,
  words: Readonly<Record<string, (count: number) => string>>,
): string {
  return [...counts]
    .map(([outcome, count]) => words[outcome]?.(count) ?? `${count} ${outcome}`)
    .join(' · ')
}
