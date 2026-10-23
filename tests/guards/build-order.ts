import { vpRunTasks } from '../support/vp.ts'
import type { Violation } from './types.ts'

export interface BuildOrderInput {
  commands: readonly string[] | undefined
}

const FILE = 'vite.config.ts'

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
          `check:push runs ${JSON.stringify(commands[firstBuild])} before "vp ${verb}": ${what} must run before anything builds, or a package that resolves to dist/ again goes unnoticed`,
        ),
      )
    }
  }
  return violations
}
