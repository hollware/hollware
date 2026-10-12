import { isRecord } from '../support/values.ts'
import { GITHUB_REPOSITORY } from './project.ts'
import type { TextFile, Violation } from './types.ts'
import { parseWorkflow } from './workflow-model.ts'

/**
 * Guard `release-workflow`: the release pipeline of ADR-014 keeps its gates.
 *
 * - Every job of `release.yml` runs only in this repository and only on `main`: its `if:`
 *   holds both `github.repository == 'hollware/hollware'` and
 *   `github.ref == 'refs/heads/main'`.
 * - The `stage` job, the only one that publishes, has `environment: npm` (the maintainer's
 *   approval and the npm trusted publisher are bound to it), asks for `id-token: write`,
 *   checks nothing out, so no repository code runs next to the OIDC token, and sets up Node
 *   with an exact `node-version` equal to `.node-version`.
 */

export interface ReleaseWorkflowInput {
  /** `.github/workflows/release.yml`. */
  release: TextFile
  /** The text of `.node-version`. */
  nodeVersion: string
}

export function checkReleaseWorkflow(input: ReleaseWorkflowInput): Violation[] {
  const violations: Violation[] = []
  const file = input.release.path
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `release-workflow/${rule}`, file, message })
  }
  const workflow = parseWorkflow(input.release)
  for (const error of workflow.errors) {
    report('yaml-error', `the workflow cannot be checked: ${error}`)
  }

  const repositoryGate = `github.repository == '${GITHUB_REPOSITORY}'`
  const branchGate = "github.ref == 'refs/heads/main'"
  for (const job of workflow.jobs) {
    const condition = typeof job.condition === 'string' ? job.condition.replace(/\s+/g, ' ') : ''
    for (const gate of [repositoryGate, branchGate]) {
      if (!condition.includes(gate)) {
        report(
          'job-gate',
          `job "${job.id}": its "if:" must contain ${gate}, found ${JSON.stringify(job.condition)}`,
        )
      }
    }
  }

  const stage = workflow.jobs.find((job) => job.id === 'stage')
  if (stage === undefined) {
    report('stage-missing', 'release.yml has no "stage" job')
    return violations
  }
  const environment = isRecord(stage.environment) ? stage.environment.name : stage.environment
  if (environment !== 'npm') {
    report(
      'stage-environment',
      `job "stage" must have "environment: npm", found ${JSON.stringify(stage.environment)}`,
    )
  }
  if (!isRecord(stage.permissions) || stage.permissions['id-token'] !== 'write') {
    report(
      'stage-id-token',
      'job "stage" must grant "id-token: write": trusted publishing cannot work without it',
    )
  }
  for (const step of stage.steps) {
    if (step.uses?.value.startsWith('actions/checkout@') === true) {
      report(
        'stage-checkout',
        `job "stage", step ${step.index + 1} checks the repository out: stage runs next to the OIDC token and must run no repository code`,
      )
    }
  }
  const nodeSteps = stage.steps.filter(
    (step) => step.uses?.value.startsWith('actions/setup-node@') === true,
  )
  const expected = input.nodeVersion.trim()
  if (nodeSteps.length === 0) {
    report(
      'stage-node-version',
      'job "stage" must set up Node with actions/setup-node at the exact version of .node-version',
    )
  }
  for (const step of nodeSteps) {
    const version = step.inputs['node-version']
    if (version !== expected) {
      report(
        'stage-node-version',
        `job "stage", step ${step.index + 1}: "node-version" must be exactly ${JSON.stringify(expected)}, the content of .node-version, found ${JSON.stringify(version)}`,
      )
    }
  }
  return violations
}
