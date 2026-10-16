/**
 * An action on many rows at once, as the admin's bulk actions run it: the operation of one row,
 * the one the page already calls, for each row, a few at a time so a long selection neither
 * waits on every call in turn nor floods the Worker. A row that fails does not stop the others:
 * its error is in its result, and the page says how many of each outcome there were.
 */

/** What one row came to: the answer of its call, or what it threw. */
export type Done<Item, Answer> =
  | { readonly item: Item; readonly answer: Answer }
  | { readonly item: Item; readonly error: unknown }

/** How many calls run at once. */
export const AT_ONCE = 4

/** Runs `task` on every item, at most `atOnce` at a time; the results are in the items' order. */
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

/** How many results came to each outcome, and how many threw (`failed`). */
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

/** What a bulk action says when it is done: each outcome with how many came to it. */
export function summaryOf(
  counts: ReadonlyMap<string, number>,
  words: Readonly<Record<string, (count: number) => string>>,
): string {
  return [...counts]
    .map(([outcome, count]) => words[outcome]?.(count) ?? `${count} ${outcome}`)
    .join(' · ')
}
