import { ref } from 'vue'
import { ApiError, type Output } from './api.ts'

/**
 * Saving a change of the structure (ADR-033) as the admin does it: send it, and if the server
 * answers that it touches existing entries, show what and send it again once the person agrees;
 * show every problem of an invalid one, and a conflict with whoever changed it first.
 */

type Change = Output<'update_site'>
export type Impact = NonNullable<Change['impact']>
export type Problem = NonNullable<Change['problems']>[number]

export function useStructureChange(onDone: (answer: Change) => Promise<void> | void) {
  const busy = ref(false)
  const impact = ref<Impact | null>(null)
  const problems = ref<Problem[]>([])
  const conflict = ref(false)
  const failure = ref<string | null>(null)
  let pending: ((confirm: boolean) => Promise<Change>) | null = null

  async function run(attempt: (confirm: boolean) => Promise<Change>, confirm = false) {
    busy.value = true
    problems.value = []
    failure.value = null
    try {
      const answer = await attempt(confirm)
      switch (answer.outcome) {
        case 'needs_confirmation':
          pending = attempt
          impact.value = answer.impact ?? null
          break
        case 'invalid':
          problems.value = answer.problems ?? []
          break
        case 'conflict':
          conflict.value = true
          break
        case 'updated':
        case 'unchanged':
          impact.value = null
          await onDone(answer)
          break
      }
    } catch (error) {
      failure.value = error instanceof ApiError ? `${error.message} ${error.fix}` : String(error)
    } finally {
      busy.value = false
    }
  }

  async function confirmPending() {
    const attempt = pending
    impact.value = null
    pending = null
    if (attempt !== null) await run(attempt, true)
  }

  function cancel() {
    impact.value = null
    pending = null
  }

  return { busy, impact, problems, conflict, failure, run, confirmPending, cancel }
}

/** The lines of an impact, as a person reads them. */
export function impactLines(impact: Impact): string[] {
  return [
    ...impact.removedCollections.map(
      (removed) =>
        `The collection "${removed.name}" goes, and its ${removed.entries} entries are out of reach until it comes back.`,
    ),
    ...impact.removedLocales.map(
      (removed) =>
        `The locale "${removed.locale}" goes, and its ${removed.entries} entries are out of reach until it comes back.`,
    ),
    ...impact.refused.map(
      (refused) =>
        `The new schema of "${refused.collection}" refuses ${refused.entries} of its entries (${refused.examples.join(', ')}): they stay, and each is checked against it at its next save.`,
    ),
  ]
}
