import { isRecord } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'
import { describeStep, parseWorkflow } from './workflow-model.ts'

export interface WorkflowPermissionsInput {
  workflows: readonly TextFile[]
}

export const ID_TOKEN_JOBS: readonly string[] = ['release.yml#publish', 'security.yml#scorecard']

export const WRITE_SCOPES: Readonly<Record<string, readonly string[]>> = {
  'release.yml#version': ['contents', 'pull-requests'],
  'release.yml#finalize': ['contents'],
  'security.yml#scorecard': ['security-events'],
}

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
      if (isRecord(job.permissions)) {
        const allowed = WRITE_SCOPES[`${workflow.file}#${job.id}`] ?? []
        for (const [scope, level] of Object.entries(job.permissions)) {
          if (scope === 'id-token' || level !== 'write' || allowed.includes(scope)) continue
          report(
            'write-scope',
            `job "${job.id}" grants "${scope}: write", which WRITE_SCOPES does not give ${workflow.file}#${job.id}`,
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
