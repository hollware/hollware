import { isDeepStrictEqual } from 'node:util'
import { isRecord, recordAt } from '../support/values.ts'
import { GITHUB_REPOSITORY } from './project.ts'
import type { TextFile, Violation } from './types.ts'
import { parseWorkflow } from './workflow-model.ts'

const TRIGGERS = ['push', 'workflow_dispatch']
const BRANCHES = ['main', 'release']
const TARGET_INPUT = {
  description: 'staging or production',
  required: true,
  type: 'choice',
  options: ['staging', 'production'],
}
const REPOSITORY_GATE = `github.repository == '${GITHUB_REPOSITORY}'`
const DEPLOY_GATE = "vars.DEPLOY_ENABLED == 'true'"
const DEPLOY_COMMAND = 'node scripts/deploy.ts --target "$target"'
const TARGET_ENV = {
  EVENT_NAME: '${{ github.event_name }}',
  REF: '${{ github.ref }}',
  ASKED: '${{ inputs.target }}',
}
const TARGET_LINES = [
  'if [ "$EVENT_NAME" = "workflow_dispatch" ]; then target="$ASKED"',
  'elif [ "$REF" = "refs/heads/release" ]; then target=production',
  'else target=staging',
]

export function checkDeployWorkflow(deploy: TextFile): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `deploy-workflow/${rule}`, file: deploy.path, message })
  }
  const workflow = parseWorkflow(deploy)
  if (workflow.errors.length > 0) {
    report('invalid', `the workflow cannot be read: ${workflow.errors.join('; ')}`)
    return violations
  }

  const triggers = isRecord(workflow.triggers) ? workflow.triggers : {}
  if (!isDeepStrictEqual(Object.keys(triggers), TRIGGERS)) {
    report(
      'triggers',
      `"on" must be exactly ${JSON.stringify(TRIGGERS)}: a deploy runs on a push or by hand, found ${JSON.stringify(Object.keys(triggers))}`,
    )
  }
  const branches = recordAt(triggers, 'push')?.branches
  if (!isDeepStrictEqual(branches, BRANCHES)) {
    report(
      'triggers',
      `"on.push.branches" must be ${JSON.stringify(BRANCHES)}: main deploys staging and release production, found ${JSON.stringify(branches)}`,
    )
  }
  const target = recordAt(recordAt(recordAt(triggers, 'workflow_dispatch'), 'inputs'), 'target')
  if (!isDeepStrictEqual(target, TARGET_INPUT)) {
    report(
      'triggers',
      `"on.workflow_dispatch.inputs.target" must be ${JSON.stringify(TARGET_INPUT)}, found ${JSON.stringify(target)}`,
    )
  }

  if (workflow.jobs.length === 0) report('jobs', 'the workflow has no job')
  for (const job of workflow.jobs) {
    const condition = typeof job.condition === 'string' ? job.condition : ''
    for (const gate of [REPOSITORY_GATE, DEPLOY_GATE]) {
      if (!condition.includes(gate)) {
        report(
          'gate',
          `job "${job.id}" must run only if ${gate}: a fork never deploys, and nothing deploys until the environment deploy holds its token`,
        )
      }
    }
    if (job.environment !== 'deploy') {
      report(
        'environment',
        `job "${job.id}" must have "environment: deploy", the only place that holds the Cloudflare token, found ${JSON.stringify(job.environment)}`,
      )
    }
  }

  const deploying = workflow.jobs.flatMap((job) =>
    job.steps.filter((step) => step.run?.includes(DEPLOY_COMMAND) === true),
  )
  if (deploying.length !== 1) {
    report('target', `one step must run \`${DEPLOY_COMMAND}\`, found ${deploying.length}`)
  }
  for (const step of deploying) {
    const lines = (step.run ?? '').split('\n').map((line) => line.trim())
    const missing = TARGET_LINES.filter((line) => !lines.includes(line))
    const env = Object.fromEntries(Object.keys(TARGET_ENV).map((key) => [key, step.env[key]]))
    if (missing.length > 0 || !isDeepStrictEqual(env, TARGET_ENV)) {
      report(
        'target',
        `the deploy step must take the target of a manual run, production on release and staging otherwise, from ${JSON.stringify(TARGET_ENV)}; missing lines ${JSON.stringify(missing)}`,
      )
    }
  }
  return violations
}
