import { isRecord, isStringArray } from '../support/values.ts'
import { GITHUB_REPOSITORY } from './project.ts'
import type { TextFile, Violation } from './types.ts'
import { describeStep, parseWorkflow } from './workflow-model.ts'

/**
 * Guard `release-workflow`: the release pipeline of ADR-015 keeps its branch model and its
 * gates. `main` is for development and `release` is what ships.
 *
 * - `release.yml` runs on pushes to `main` and `release`, and on no other branch.
 * - Every job of `release.yml` is one this guard knows, gated to this repository and to the
 *   branch of its path: `select-mode` and `version` run on `main`; `promotion-check`, `pack`,
 *   `publish` and `finalize` run on `release`. Its `if:` holds
 *   `github.repository == 'hollware/hollware'` and `github.ref == 'refs/heads/<branch>'`, and
 *   never the other branch. A job the guard does not know is reported: a new job needs a
 *   decision on which branch it runs.
 * - The chain cannot be skipped: `version` needs `select-mode`, `pack` needs `promotion-check`,
 *   `publish` needs `pack` and `finalize` needs `publish`.
 * - The `publish` job, the only one that publishes, has `environment: npm` (the maintainer's
 *   approval and the npm trusted publisher are bound to it), holds exactly `contents: read` and
 *   `id-token: write`, checks nothing out, so no repository code runs next to the OIDC token, and
 *   sets up Node with an exact `node-version` equal to `.node-version` and without `registry-url`
 *   (it writes an `.npmrc` that stops npm from using the OIDC token).
 * - `ci.yml` also runs on pushes to `release`, and skips its changeset check there: `release`
 *   only takes commits of `main` whose changesets are consumed.
 */

export interface ReleaseWorkflowInput {
  /** `.github/workflows/release.yml`. */
  release: TextFile
  /** `.github/workflows/ci.yml`. */
  ci: TextFile
  /** The text of `.node-version`. */
  nodeVersion: string
}

type Branch = 'main' | 'release'

interface ReleaseJob {
  id: string
  /** The branch the job runs on. */
  branch: Branch
  /** The jobs it must wait for. */
  needs: readonly string[]
}

/** The jobs of `release.yml`, in pipeline order. */
const RELEASE_JOBS: readonly ReleaseJob[] = [
  { id: 'select-mode', branch: 'main', needs: [] },
  { id: 'version', branch: 'main', needs: ['select-mode'] },
  { id: 'promotion-check', branch: 'release', needs: [] },
  { id: 'pack', branch: 'release', needs: ['promotion-check'] },
  { id: 'publish', branch: 'release', needs: ['pack'] },
  { id: 'finalize', branch: 'release', needs: ['publish'] },
]

const branchGate = (branch: string): string => `github.ref == 'refs/heads/${branch}'`

/** The branches a workflow runs on for a `push`, as `on.push.branches`. */
function pushBranches(triggers: unknown): string[] {
  if (!isRecord(triggers) || !isRecord(triggers.push)) return []
  const branches = triggers.push.branches
  return isStringArray(branches) ? branches : []
}

export function checkReleaseWorkflow(input: ReleaseWorkflowInput): Violation[] {
  const violations: Violation[] = []
  const report = (file: TextFile, rule: string, message: string): void => {
    violations.push({ rule: `release-workflow/${rule}`, file: file.path, message })
  }

  const releaseFile = input.release
  const workflow = parseWorkflow(releaseFile)
  for (const error of workflow.errors) {
    report(releaseFile, 'yaml-error', `the workflow cannot be checked: ${error}`)
  }

  const branches = pushBranches(workflow.triggers)
  if (branches.length !== 2 || !branches.includes('main') || !branches.includes('release')) {
    report(
      releaseFile,
      'triggers',
      `release.yml must run on pushes to main and release and to no other branch, found ${JSON.stringify(branches)}`,
    )
  }

  const repositoryGate = `github.repository == '${GITHUB_REPOSITORY}'`
  for (const job of workflow.jobs) {
    const known = RELEASE_JOBS.find((candidate) => candidate.id === job.id)
    if (known === undefined) {
      report(
        releaseFile,
        'job-unknown',
        `job "${job.id}" is not one of ${RELEASE_JOBS.map((candidate) => candidate.id).join(', ')}: decide which branch it runs on and add it to the release-workflow guard`,
      )
      continue
    }
    const condition = typeof job.condition === 'string' ? job.condition.replace(/\s+/g, ' ') : ''
    for (const gate of [repositoryGate, branchGate(known.branch)]) {
      if (!condition.includes(gate)) {
        report(
          releaseFile,
          'job-gate',
          `job "${job.id}": its "if:" must contain ${gate}, found ${JSON.stringify(job.condition)}`,
        )
      }
    }
    const other = branchGate(known.branch === 'main' ? 'release' : 'main')
    if (condition.includes(other)) {
      report(
        releaseFile,
        'job-branch',
        `job "${job.id}" runs on ${known.branch} only: its "if:" must not contain ${other}, found ${JSON.stringify(job.condition)}`,
      )
    }
    for (const need of known.needs) {
      if (!job.needs.includes(need)) {
        report(
          releaseFile,
          'job-needs',
          `job "${job.id}" must wait for "${need}": list it in "needs", found ${JSON.stringify(job.needs)}`,
        )
      }
    }
  }
  for (const known of RELEASE_JOBS) {
    if (!workflow.jobs.some((job) => job.id === known.id)) {
      report(releaseFile, 'job-missing', `release.yml has no "${known.id}" job`)
    }
  }

  const publish = workflow.jobs.find((job) => job.id === 'publish')
  if (publish !== undefined) {
    const environment = isRecord(publish.environment)
      ? publish.environment.name
      : publish.environment
    if (environment !== 'npm') {
      report(
        releaseFile,
        'publish-environment',
        `job "publish" must have "environment: npm", found ${JSON.stringify(publish.environment)}`,
      )
    }
    const permissions = isRecord(publish.permissions) ? publish.permissions : {}
    if (permissions['id-token'] !== 'write') {
      report(
        releaseFile,
        'publish-id-token',
        'job "publish" must grant "id-token: write": trusted publishing cannot work without it',
      )
    }
    const extra = Object.entries(permissions).filter(
      ([scope, level]) =>
        !(scope === 'id-token' && level === 'write') && !(scope === 'contents' && level === 'read'),
    )
    if (extra.length > 0) {
      report(
        releaseFile,
        'publish-permissions',
        `job "publish" holds the OIDC token, so it may have nothing besides "contents: read" and "id-token: write", found ${JSON.stringify(publish.permissions)}`,
      )
    }
    for (const step of publish.steps) {
      if (step.uses?.value.startsWith('actions/checkout@') === true) {
        report(
          releaseFile,
          'publish-checkout',
          `job "publish", step ${step.index + 1} checks the repository out: publish runs next to the OIDC token and must run no repository code`,
        )
      }
    }
    const nodeSteps = publish.steps.filter(
      (step) => step.uses?.value.startsWith('actions/setup-node@') === true,
    )
    const expected = input.nodeVersion.trim()
    if (nodeSteps.length === 0) {
      report(
        releaseFile,
        'publish-node-version',
        'job "publish" must set up Node with actions/setup-node at the exact version of .node-version',
      )
    }
    for (const step of nodeSteps) {
      const version = step.inputs['node-version']
      if (version !== expected) {
        report(
          releaseFile,
          'publish-node-version',
          `job "publish", step ${step.index + 1}: "node-version" must be exactly ${JSON.stringify(expected)}, the content of .node-version, found ${JSON.stringify(version)}`,
        )
      }
      if ('registry-url' in step.inputs) {
        report(
          releaseFile,
          'publish-registry-url',
          `${describeStep('publish', step)}: setup-node must not set "registry-url": it writes an .npmrc that stops npm from using the OIDC token`,
        )
      }
    }
  }

  const ciFile = input.ci
  const ci = parseWorkflow(ciFile)
  for (const error of ci.errors) {
    report(ciFile, 'yaml-error', `the workflow cannot be checked: ${error}`)
  }
  const ciBranches = pushBranches(ci.triggers)
  if (!ciBranches.includes('main') || !ciBranches.includes('release')) {
    report(
      ciFile,
      'ci-triggers',
      `ci.yml must run on pushes to main and release, found ${JSON.stringify(ciBranches)}`,
    )
  }
  const skipOnRelease = "github.ref != 'refs/heads/release'"
  const changesetSteps = ci.jobs.flatMap((job) =>
    job.steps
      .filter((step) => step.run?.includes('changeset-check.sh') === true)
      .map((step) => ({ job: job.id, step })),
  )
  if (changesetSteps.length === 0) {
    report(
      ciFile,
      'ci-changeset',
      'ci.yml has no step that runs .github/scripts/changeset-check.sh: the changeset check is gone',
    )
  }
  for (const { job, step } of changesetSteps) {
    const condition = typeof step.condition === 'string' ? step.condition.replace(/\s+/g, ' ') : ''
    if (!condition.includes(skipOnRelease)) {
      report(
        ciFile,
        'ci-changeset',
        `${describeStep(job, step)}: the changeset check must be skipped on release, its "if:" must contain ${skipOnRelease}, found ${JSON.stringify(step.condition)}`,
      )
    }
  }
  return violations
}
