import type { TextFile, Violation } from './types.ts'
import { describeStep, parseWorkflow } from './workflow-model.ts'

/**
 * Guard `setup-vp-version`: CI runs the same toolchain as a clone.
 *
 * Every `voidzero-dev/setup-vp` step pins `version:` to the exact `vite-plus` version of the
 * catalog (the action would install the latest otherwise), and takes Node from
 * `.node-version` with `node-version-file`. Every other `actions/setup-node` step does the
 * same, unless it pins the exact version of `.node-version` itself (`release.yml` does where
 * nothing is checked out).
 */

export interface SetupVpInput {
  /** The `.github/workflows/*.yml` files. */
  workflows: readonly TextFile[]
  /** The `vite-plus` entry of the catalog in `pnpm-workspace.yaml`, or `undefined`. */
  viteVersion: string | undefined
  /** The text of `.node-version`. */
  nodeVersion: string
}

export function checkSetupVpVersion(input: SetupVpInput): Violation[] {
  const violations: Violation[] = []
  const nodeVersion = input.nodeVersion.trim()
  for (const file of input.workflows) {
    const workflow = parseWorkflow(file)
    const report = (rule: string, message: string): void => {
      violations.push({ rule: `setup-vp-version/${rule}`, file: file.path, message })
    }
    for (const error of workflow.errors) {
      report('yaml-error', `the workflow cannot be checked: ${error}`)
    }
    for (const job of workflow.jobs) {
      for (const step of job.steps) {
        const uses = step.uses?.value ?? ''
        const where = describeStep(job.id, step)
        if (uses.startsWith('voidzero-dev/setup-vp@')) {
          if (input.viteVersion === undefined) {
            report(
              'catalog',
              'pnpm-workspace.yaml has no "vite-plus" catalog entry for setup-vp to match',
            )
          } else if (step.inputs.version !== input.viteVersion) {
            report(
              'mismatch',
              `${where}: setup-vp "version" must be ${JSON.stringify(input.viteVersion)}, the vite-plus version of the catalog, found ${JSON.stringify(step.inputs.version)}`,
            )
          }
          if (step.inputs['node-version-file'] !== '.node-version') {
            report(
              'node-source',
              `${where}: setup-vp must take Node from .node-version with "node-version-file: .node-version", found ${JSON.stringify(step.inputs['node-version-file'])}`,
            )
          }
        } else if (uses.startsWith('actions/setup-node@')) {
          const fromFile = step.inputs['node-version-file'] === '.node-version'
          const exact = step.inputs['node-version'] === nodeVersion
          if (!fromFile && !exact) {
            report(
              'node-source',
              `${where}: setup-node must use "node-version-file: .node-version" or the exact "node-version: ${nodeVersion}", found ${JSON.stringify(step.inputs)}`,
            )
          }
        }
      }
    }
  }
  return violations
}
