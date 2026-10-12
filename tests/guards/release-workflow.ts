import { isRecord, isStringArray } from '../support/values.ts'
import { GITHUB_REPOSITORY } from './project.ts'
import type { TextFile, Violation } from './types.ts'
import { describeStep, parseWorkflow } from './workflow-model.ts'
import type { WorkflowJob, WorkflowStep } from './workflow-model.ts'

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
 * - Runs of `release.yml` go one at a time per ref: its top-level `concurrency` is
 *   `group: release-${{ github.ref }}` with `cancel-in-progress: false`, and no job sets a
 *   `concurrency` of its own. A run that waits for the approval of `publish` is never replaced
 *   by a push to `main`, and nothing is cancelled half-way through a publish.
 * - The steps that run a script hand it what it reads. `promotion-check.sh` gets `PROMOTED_SHA`
 *   and `BEFORE_SHA`, which the fast-forward check cannot run without. `finalize-release.sh` gets
 *   `GH_TOKEN`, `RELEASE_SHA` and, optionally, `WAIT_SECONDS`. No step sets another key: a
 *   `DRY_RUN` would turn the release into a no-op. Both jobs check the repository out with
 *   `fetch-depth: 0`, because the scripts read its history.
 * - `finalize_only` is wired from the trigger to the script, so that a failed finalize can run
 *   again and nothing else runs with it. `workflow_dispatch` takes a boolean input
 *   `finalize_only`. `promotion-check` is skipped on a finalize-only run (`!inputs.finalize_only`),
 *   and so are `pack` and `publish`, which skip with it as long as their `if:` calls no status
 *   function (`always()`, `cancelled()`, `failure()`). `finalize` runs on a `workflow_dispatch`
 *   with `finalize_only`, and has a status function for that, because `publish` is skipped. Its
 *   `RELEASE_SHA` is empty on a finalize-only run, when the script looks for the latest "Version
 *   Packages" commit, unless the maintainer names the commit in a string input `release_sha`
 *   (empty by default), which the script uses as given. On every other run it is the head of
 *   `release`. A `RELEASE_SHA` that hands `inputs.release_sha` over needs that input.
 * - `ci.yml` also runs on pushes to `release`, and skips its changeset check there: `release`
 *   only takes commits of `main` whose changesets are consumed. The job that runs the check
 *   checks the repository out with `fetch-depth: 0`, because the check fails on a push whose
 *   previous tip is not in the clone.
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

/** The group that serializes the runs of `release.yml`: one run at a time per ref. */
const RELEASE_GROUP = 'release-${{ github.ref }}'

/**
 * What `RELEASE_SHA` may be: the head of `release` on every run but a finalize-only one, and on
 * that one empty, or the commit named in the `release_sha` input (empty by default).
 */
const RELEASE_SHA_EXPRESSIONS: readonly string[] = [
  "${{ inputs.finalize_only != true && github.sha || '' }}",
  '${{ inputs.finalize_only != true && github.sha || inputs.release_sha }}',
]

/** A step that runs a script of `.github/scripts/`, and what it hands to the script. */
interface ScriptStep {
  /** The job that runs the script. */
  job: string
  script: string
  /** The `env:` keys the step must set, each to exactly one of these texts. */
  env: Record<string, { values: readonly string[]; why: string; rule?: string }>
  /** The keys it may set besides, each with the pattern its value must match. */
  optional: Record<string, RegExp>
  /** What the script reads from the history, so that the checkout has to fetch it. */
  history: string
}

const SCRIPT_STEPS: readonly ScriptStep[] = [
  {
    job: 'promotion-check',
    script: 'promotion-check.sh',
    env: {
      PROMOTED_SHA: { values: ['${{ github.sha }}'], why: 'the commit that was pushed to release' },
      BEFORE_SHA: {
        values: ['${{ github.event.before }}'],
        why: 'the tip release had before the push: without it the fast-forward check cannot run',
      },
    },
    optional: {},
    history: 'origin/main, and the history between the two tips of release',
  },
  {
    job: 'finalize',
    script: 'finalize-release.sh',
    env: {
      GH_TOKEN: {
        values: ['${{ github.token }}'],
        why: 'gh authenticates with it, and git never pushes',
      },
      RELEASE_SHA: {
        values: RELEASE_SHA_EXPRESSIONS,
        why: 'the head of release, and empty on a finalize-only run, which has no build of its own: the script then looks for the latest "Version Packages" commit, unless the release_sha input names it',
        rule: 'finalize-only-release-sha',
      },
    },
    optional: { WAIT_SECONDS: /^[1-9][0-9]*$/ },
    history: 'the release commit is found in the history',
  },
]

/** A job that calls one runs after a job that was skipped. */
const STATUS_FUNCTION = /\b(?:always|cancelled|failure)\(\)/

const branchGate = (branch: string): string => `github.ref == 'refs/heads/${branch}'`

/** An `if:` or an `env:` value, on one line. */
const normalize = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''

/** The branches a workflow runs on for a `push`, as `on.push.branches`. */
function pushBranches(triggers: unknown): string[] {
  if (!isRecord(triggers) || !isRecord(triggers.push)) return []
  const branches = triggers.push.branches
  return isStringArray(branches) ? branches : []
}

type Report = (file: TextFile, rule: string, message: string) => void

/** The checkout before the step that runs a script has to fetch the whole history. */
function checkFullHistory(
  report: Report,
  file: TextFile,
  job: WorkflowJob,
  step: WorkflowStep,
  script: string,
  history: string,
  rule: string,
): void {
  const checkout = job.steps.find(
    (candidate) =>
      candidate.index < step.index &&
      candidate.uses?.value.startsWith('actions/checkout@') === true,
  )
  if (checkout === undefined) {
    report(file, rule, `job "${job.id}" runs ${script} with no actions/checkout step before it`)
    return
  }
  const depth = checkout.inputs['fetch-depth']
  if (depth !== 0 && depth !== '0') {
    report(
      file,
      rule,
      `${describeStep(job.id, checkout)}: actions/checkout must set "fetch-depth: 0" (${history}), found ${JSON.stringify(depth)}`,
    )
  }
}

export function checkReleaseWorkflow(input: ReleaseWorkflowInput): Violation[] {
  const violations: Violation[] = []
  const report: Report = (file, rule, message) => {
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
    const condition = normalize(job.condition)
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

  // One run at a time per ref, and never cancelled: the workflow's group is the only one.
  const concurrency = workflow.concurrency
  const group = isRecord(concurrency) ? normalize(concurrency.group) : undefined
  if (
    !isRecord(concurrency) ||
    group !== RELEASE_GROUP ||
    concurrency['cancel-in-progress'] !== false
  ) {
    report(
      releaseFile,
      'concurrency',
      `release.yml must run one run at a time per ref: its top-level "concurrency" must be ${JSON.stringify({ group: RELEASE_GROUP, 'cancel-in-progress': false })}, found ${JSON.stringify(concurrency)}`,
    )
  }
  for (const job of workflow.jobs) {
    if (job.concurrency !== undefined) {
      report(
        releaseFile,
        'job-concurrency',
        `job "${job.id}" sets its own "concurrency", found ${JSON.stringify(job.concurrency)}: the group of the workflow is the only one, or runs overlap or cancel each other`,
      )
    }
  }

  // What the steps that run a script hand to it, and the history they check out.
  for (const spec of SCRIPT_STEPS) {
    const job = workflow.jobs.find((candidate) => candidate.id === spec.job)
    if (job === undefined) continue
    const path = `.github/scripts/${spec.script}`
    const step = job.steps.find((candidate) => candidate.run?.includes(path) === true)
    if (step === undefined) {
      report(releaseFile, 'script-step', `job "${job.id}" has no step that runs ${path}`)
      continue
    }
    for (const [key, expected] of Object.entries(spec.env)) {
      const found = step.env[key]
      if (!expected.values.includes(normalize(found))) {
        report(
          releaseFile,
          expected.rule ?? 'script-env',
          `${describeStep(job.id, step)}: env "${key}" must be ${expected.values.map((value) => JSON.stringify(value)).join(' or ')} (${expected.why}), found ${JSON.stringify(found)}`,
        )
      }
    }
    for (const [key, found] of Object.entries(step.env)) {
      if (key in spec.env) continue
      const pattern = spec.optional[key]
      if (pattern === undefined) {
        report(
          releaseFile,
          'script-env',
          `${describeStep(job.id, step)}: env "${key}" is not an input that ${spec.script} takes from the workflow, which are ${[...Object.keys(spec.env), ...Object.keys(spec.optional)].join(', ')}`,
        )
      } else if (!pattern.test(String(found))) {
        report(
          releaseFile,
          'script-env',
          `${describeStep(job.id, step)}: env "${key}" must match ${String(pattern)}, found ${JSON.stringify(found)}`,
        )
      }
    }
    checkFullHistory(report, releaseFile, job, step, path, spec.history, 'fetch-depth')
  }

  // `finalize_only`: how a failed finalize runs again, and the only job that runs with it.
  const dispatch = isRecord(workflow.triggers) ? workflow.triggers.workflow_dispatch : undefined
  const dispatchInputs = isRecord(dispatch) ? dispatch.inputs : undefined
  const finalizeOnly = isRecord(dispatchInputs) ? dispatchInputs.finalize_only : undefined
  if (!isRecord(finalizeOnly) || finalizeOnly.type !== 'boolean') {
    report(
      releaseFile,
      'finalize-only-input',
      `release.yml must take a boolean input "finalize_only" on workflow_dispatch: it is how a failed finalize runs again, found ${JSON.stringify(finalizeOnly)}`,
    )
  }
  const promotion = workflow.jobs.find((job) => job.id === 'promotion-check')
  if (
    promotion !== undefined &&
    !normalize(promotion.condition).includes('!inputs.finalize_only')
  ) {
    report(
      releaseFile,
      'finalize-only-promotion',
      `job "promotion-check": its "if:" must contain !inputs.finalize_only, so that a finalize-only run skips the promotion check, found ${JSON.stringify(promotion.condition)}`,
    )
  }
  for (const id of ['pack', 'publish']) {
    const job = workflow.jobs.find((candidate) => candidate.id === id)
    if (job !== undefined && STATUS_FUNCTION.test(normalize(job.condition))) {
      report(
        releaseFile,
        'finalize-only-chain',
        `job "${id}": its "if:" must call no status function (always(), cancelled(), failure()): it would run after the skipped "promotion-check", and a finalize-only run would pack and publish, found ${JSON.stringify(job.condition)}`,
      )
    }
  }
  const finalize = workflow.jobs.find((job) => job.id === 'finalize')
  const finalizeStep = finalize?.steps.find(
    (step) => step.run?.includes('.github/scripts/finalize-release.sh') === true,
  )
  if (normalize(finalizeStep?.env.RELEASE_SHA).includes('inputs.release_sha')) {
    const releaseShaInput = isRecord(dispatchInputs) ? dispatchInputs.release_sha : undefined
    if (!isRecord(releaseShaInput) || releaseShaInput.type !== 'string') {
      report(
        releaseFile,
        'finalize-only-release-sha',
        `release.yml hands inputs.release_sha to finalize as RELEASE_SHA, so workflow_dispatch must take a string input "release_sha", found ${JSON.stringify(releaseShaInput)}`,
      )
    }
  }
  if (finalize !== undefined) {
    const condition = normalize(finalize.condition)
    if (!condition.includes("github.event_name == 'workflow_dispatch' && inputs.finalize_only")) {
      report(
        releaseFile,
        'finalize-only-finalize',
        `job "finalize": its "if:" must run it on a manual run with finalize_only, so it must contain github.event_name == 'workflow_dispatch' && inputs.finalize_only, found ${JSON.stringify(finalize.condition)}`,
      )
    }
    if (!condition.includes('!cancelled()') && !condition.includes('always()')) {
      report(
        releaseFile,
        'finalize-only-finalize',
        `job "finalize": its "if:" must call a status function (!cancelled() or always()): "publish" is skipped on a finalize-only run, and a job after a skipped one is skipped too without it, found ${JSON.stringify(finalize.condition)}`,
      )
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
  const changesetScript = '.github/scripts/changeset-check.sh'
  const changesetSteps = ci.jobs.flatMap((job) =>
    job.steps
      .filter((step) => step.run?.includes('changeset-check.sh') === true)
      .map((step) => ({ job, step })),
  )
  if (changesetSteps.length === 0) {
    report(
      ciFile,
      'ci-changeset',
      `ci.yml has no step that runs ${changesetScript}: the changeset check is gone`,
    )
  }
  for (const { job, step } of changesetSteps) {
    const condition = normalize(step.condition)
    if (!condition.includes(skipOnRelease)) {
      report(
        ciFile,
        'ci-changeset',
        `${describeStep(job.id, step)}: the changeset check must be skipped on release, its "if:" must contain ${skipOnRelease}, found ${JSON.stringify(step.condition)}`,
      )
    }
    checkFullHistory(
      report,
      ciFile,
      job,
      step,
      changesetScript,
      'the check compares a push with the tip the branch had before it, and fails when that tip is not in the clone',
      'ci-fetch-depth',
    )
  }
  return violations
}
