import { vpRunTasks } from '../support/vp.ts'
import { isRecord } from '../support/values.ts'
import { plain, readYaml } from '../support/yaml.ts'
import type { Violation } from './types.ts'

/**
 * Guard `pre-push`: what CI checks runs on the maintainer's machine before a push. The hook
 * `.vite-hooks/pre-push` runs the task `check:local` of the root `vite.config.ts`, and that task
 * runs, directly or through the tasks it runs, every task a job of `ci.yml` runs with `vp run`,
 * except those of `CI_ONLY`. And it runs nothing CI does not, so a push that skips the hook
 * (`--no-verify`) still meets the same checks in CI.
 */

/** The tasks of CI that cannot run before a push, each with the reason. The list only shrinks. */
export const CI_ONLY: Readonly<Record<string, string>> = {
  'e2e:upgrade':
    'installs 0.3.0 from npm and a local registry in an empty directory: minutes of network, and CI runs it on a clean machine',
}

export interface PrePushInput {
  /** The text of `.vite-hooks/pre-push`, or `undefined` when there is none. */
  readonly hook: string | undefined
  /** For each task of the root `vite.config.ts`, the tasks it runs (`taskGraph`). */
  readonly graph: Readonly<Record<string, readonly string[]>>
  /** The text of `.github/workflows/ci.yml`. */
  readonly ci: string
}

const LOCAL = 'check:local'

/** The tasks that the `run` steps of the jobs of a workflow run with `vp run`. */
function workflowTasks(text: string): string[] {
  const workflow = plain(readYaml(text).doc.contents)
  const jobs =
    isRecord(workflow) && isRecord(workflow['jobs']) ? Object.values(workflow['jobs']) : []
  return jobs.flatMap((job) => {
    const steps = isRecord(job) && Array.isArray(job['steps']) ? job['steps'] : []
    return steps.flatMap((step: unknown) =>
      isRecord(step) && typeof step['run'] === 'string' ? vpRunTasks(step['run']) : [],
    )
  })
}

/** A task and every task it runs, through the graph. */
function reach(graph: PrePushInput['graph'], start: string): Set<string> {
  const seen = new Set<string>()
  const queue = [start]
  while (queue.length > 0) {
    const task = queue.pop() ?? ''
    if (seen.has(task)) continue
    seen.add(task)
    queue.push(...(graph[task] ?? []))
  }
  return seen
}

export function checkPrePush(input: PrePushInput): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, file: string, message: string) =>
    violations.push({ rule: `pre-push/${rule}`, file, message })

  if (input.hook === undefined || !vpRunTasks(input.hook).includes(LOCAL)) {
    report('hook', '.vite-hooks/pre-push', `the hook must run "vp run ${LOCAL}"`)
  }
  if (input.graph[LOCAL] === undefined) {
    report('task', 'vite.config.ts', `the root vite.config.ts has no task ${LOCAL}`)
    return violations
  }
  const local = reach(input.graph, LOCAL)
  const ci = new Set(workflowTasks(input.ci))
  for (const task of ci) {
    if (local.has(task) || task in CI_ONLY) continue
    report(
      'missing',
      'vite.config.ts',
      `ci.yml runs "vp run ${task}" and ${LOCAL} does not: add it to ${LOCAL}, or to CI_ONLY of tests/guards/pre-push.ts with the reason it cannot run before a push`,
    )
  }
  for (const task of input.graph[LOCAL] ?? []) {
    if (!ci.has(task)) {
      report(
        'local-only',
        'vite.config.ts',
        `${LOCAL} runs "${task}" and no job of ci.yml does: a push with --no-verify would skip it`,
      )
    }
  }
  for (const task of Object.keys(CI_ONLY)) {
    if (!ci.has(task)) {
      report(
        'stale',
        'tests/guards/pre-push.ts',
        `CI_ONLY names "${task}", which ci.yml no longer runs: remove it`,
      )
    }
  }
  return violations
}
