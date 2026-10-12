import { isRecord } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'
import { describeStep, parseWorkflow } from './workflow-model.ts'

/**
 * Guard `workflow-permissions`: least privilege, bound to the files.
 *
 * - Every workflow starts with `permissions: {}`: nothing is granted unless a job asks.
 * - A job's `permissions` is a mapping, never `write-all`.
 * - `id-token: write` (the OIDC token that npm trusted publishing and Scorecard use) is
 *   granted to exactly two jobs: `stage` of release.yml and `scorecard` of security.yml.
 * - Every `actions/checkout` step sets `persist-credentials: false`, so no later step can push
 *   with the workflow's token.
 * - `security.yml` has no top-level `env` or `defaults`: OpenSSF Scorecard rejects the results
 *   of a workflow that has them.
 */

export interface WorkflowPermissionsInput {
  /** The `.github/workflows/*.yml` files. */
  workflows: readonly TextFile[]
}

/** The only jobs allowed to request an OIDC token, as `file#job`. */
export const ID_TOKEN_JOBS: readonly string[] = ['release.yml#stage', 'security.yml#scorecard']

export function checkWorkflowPermissions(input: WorkflowPermissionsInput): Violation[] {
  const violations: Violation[] = []
  for (const file of input.workflows) {
    const workflow = parseWorkflow(file)
    const report = (rule: string, message: string): void => {
      violations.push({ rule: `workflow-permissions/${rule}`, file: file.path, message })
    }
    for (const error of workflow.errors) {
      report('yaml-error', `the workflow cannot be checked: ${error}`)
    }

    if (workflow.file === 'security.yml') {
      for (const key of ['env', 'defaults']) {
        if (workflow.topLevelKeys.includes(key)) {
          report(
            'scorecard',
            `security.yml must have no top-level "${key}": OpenSSF Scorecard rejects the results of a workflow that has it`,
          )
        }
      }
    }

    const top = workflow.permissions
    if (!workflow.hasPermissions) {
      report(
        'top-level',
        'the workflow must start with "permissions: {}" and grant permissions per job',
      )
    } else if (!isRecord(top) || Object.keys(top).length !== 0) {
      report('top-level', `the top-level "permissions" must be {}, found ${JSON.stringify(top)}`)
    }

    for (const job of workflow.jobs) {
      if (job.hasPermissions && !isRecord(job.permissions)) {
        report(
          'job-permissions',
          `job "${job.id}": "permissions" must be a mapping of the scopes it needs, found ${JSON.stringify(job.permissions)}`,
        )
      }
      if (isRecord(job.permissions) && job.permissions['id-token'] === 'write') {
        if (!ID_TOKEN_JOBS.includes(`${workflow.file}#${job.id}`)) {
          report(
            'id-token',
            `job "${job.id}" grants "id-token: write", which only ${ID_TOKEN_JOBS.join(' and ')} may: it lets a job mint OIDC tokens`,
          )
        }
      }
      for (const step of job.steps) {
        if (step.uses?.value.startsWith('actions/checkout@') !== true) continue
        const persist = step.inputs['persist-credentials']
        if (persist !== false && persist !== 'false') {
          report(
            'checkout-credentials',
            `${describeStep(job.id, step)}: actions/checkout must set "persist-credentials: false", found ${JSON.stringify(persist)}`,
          )
        }
      }
    }
  }
  return violations
}
