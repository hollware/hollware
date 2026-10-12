import { vpRunTasks } from '../support/vp.ts'
import type { Violation } from './types.ts'

/**
 * Guard `build-order`: no package needs another one built, because inside the workspace every
 * package resolves to its source (ADR-016). CI proves it with `check:push`, which `ci.yml` runs
 * on a fresh checkout: the type check (`vp check`) and the tests (`vp test`) run before any
 * command that builds (`vp run build`, `vp pack`, `vp build`). A build that ran first would
 * leave `dist/` behind for them, and a package that resolved to `dist/` again would go unnoticed.
 */

export interface BuildOrderInput {
  /** The commands of the `check:push` task of the root `vite.config.ts`, in order. */
  commands: readonly string[] | undefined
}

const FILE = 'vite.config.ts'

/** Whether a command is `vp <verb>`, with whatever options follow. */
function isVp(command: string, verb: string): boolean {
  const [program, first] = command.trim().split(/\s+/)
  return program === 'vp' && first === verb
}

function builds(command: string): boolean {
  return isVp(command, 'pack') || isVp(command, 'build') || vpRunTasks(command).includes('build')
}

export function checkBuildOrder(input: BuildOrderInput): Violation[] {
  const report = (rule: string, message: string): Violation => ({
    rule: `build-order/${rule}`,
    file: FILE,
    message,
  })
  const { commands } = input
  if (commands === undefined) {
    return [report('no-task', 'the root vite.config.ts has no check:push task with commands')]
  }
  const violations: Violation[] = []
  const firstBuild = commands.findIndex(builds)
  for (const [verb, what] of [
    ['check', 'the type check'],
    ['test', 'the tests'],
  ] as const) {
    const at = commands.findIndex((command) => isVp(command, verb))
    if (at === -1) {
      violations.push(report('missing-step', `check:push never runs "vp ${verb}"`))
    } else if (firstBuild !== -1 && firstBuild < at) {
      violations.push(
        report(
          'build-first',
          `check:push runs ${JSON.stringify(commands[firstBuild])} before "vp ${verb}": ${what} must run before anything builds, or a package that resolves to dist/ again goes unnoticed (ADR-016)`,
        ),
      )
    }
  }
  return violations
}
