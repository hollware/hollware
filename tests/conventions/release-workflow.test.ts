import { describe, expect, it } from 'vite-plus/test'
import { checkReleaseWorkflow } from '../guards/release-workflow.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

// Fails when: release.yml stops running on pushes to main and release only; a job of release.yml
// loses the repository gate or the branch gate of its path (main: select-mode and version;
// release: promotion-check, pack, publish and finalize), takes the other branch's gate, is not
// one the guard knows, or stops waiting for the job before it; the `publish` job loses
// `environment: npm` or `id-token: write`, gets another permission, checks the repository out, or
// sets up Node at a version other than the exact one in .node-version or with a registry-url; or
// ci.yml stops running on release or runs the changeset check there.

const NODE = '24.21.0'
const REPO = "github.repository == 'hollware/hollware'"
const MAIN = `${REPO} && github.ref == 'refs/heads/main'`
const RELEASE = `${REPO} && github.ref == 'refs/heads/release'`
const CHECKOUT = '      - uses: actions/checkout@' + 'a'.repeat(40) + ' # v7.0.1'
const SETUP_NODE = '      - uses: actions/setup-node@' + 'b'.repeat(40) + ' # v7.0.0'

type JobId = 'select-mode' | 'version' | 'promotion-check' | 'pack' | 'publish' | 'finalize'

const ORDER: readonly JobId[] = [
  'select-mode',
  'version',
  'promotion-check',
  'pack',
  'publish',
  'finalize',
]

const JOBS: Record<JobId, string[]> = {
  'select-mode': ['  select-mode:', `    if: ${MAIN}`, '    steps:', '      - run: echo select'],
  version: [
    '  version:',
    '    needs: select-mode',
    `    if: ${MAIN} && needs.select-mode.outputs.mode == 'version'`,
    '    steps:',
    '      - run: echo version',
  ],
  'promotion-check': [
    '  promotion-check:',
    `    if: ${RELEASE}`,
    '    steps:',
    '      - run: echo promote',
  ],
  pack: ['  pack:', '    needs: promotion-check', `    if: ${RELEASE}`, '    steps:', CHECKOUT],
  publish: [
    '  publish:',
    '    needs: pack',
    `    if: ${RELEASE} && needs.pack.outputs.artifact-id != ''`,
    '    environment: npm',
    '    permissions:',
    '      contents: read',
    '      id-token: write',
    '    steps:',
    SETUP_NODE,
    '        with:',
    `          node-version: ${NODE}`,
  ],
  finalize: [
    '  finalize:',
    '    needs: publish',
    '    if: >-',
    `      \${{ !cancelled() && ${RELEASE} &&`,
    "      needs.publish.result == 'success' }}",
    '    steps:',
    '      - run: echo finalize',
  ],
}

/** The lines of a job with the first occurrence of `from` in each line replaced by `to`. */
function change(id: JobId, from: string, to: string): string[] {
  const lines = JOBS[id]
  if (!lines.some((line) => line.includes(from)))
    throw new Error(`the ${id} fixture has no "${from}"`)
  return lines.map((line) => line.replace(from, to))
}

/** The lines of a job without the lines that contain `part`. */
function without(id: JobId, part: string): string[] {
  const lines = JOBS[id]
  if (!lines.some((line) => line.includes(part)))
    throw new Error(`the ${id} fixture has no "${part}"`)
  return lines.filter((line) => !line.includes(part))
}

const PUSH_TO_BOTH = ['on:', '  push:', '    branches: [main, release]']

/** A release.yml. A job overridden with `null` is left out. */
function release(
  overrides: Partial<Record<JobId, string[] | null>> = {},
  triggers: string[] = PUSH_TO_BOTH,
  extraJobs: string[] = [],
): string {
  return [
    ...triggers,
    'permissions: {}',
    'jobs:',
    ...ORDER.flatMap((id) => overrides[id] ?? (overrides[id] === null ? [] : JOBS[id])),
    ...extraJobs,
  ].join('\n')
}

const CI = [
  'on:',
  '  push:',
  '    branches: [main, release]',
  '  pull_request:',
  'permissions: {}',
  'jobs:',
  '  check:',
  '    steps:',
  '      - name: Check changesets',
  "        if: github.ref != 'refs/heads/release'",
  '        run: bash .github/scripts/changeset-check.sh',
].join('\n')

const check = (releaseText: string = release(), ciText: string = CI, nodeVersion = `${NODE}\n`) =>
  checkReleaseWorkflow({
    release: file('.github/workflows/release.yml', releaseText),
    ci: file('.github/workflows/ci.yml', ciText),
    nodeVersion,
  })

const messages = (releaseText?: string, ciText?: string, nodeVersion?: string) =>
  check(releaseText, ciText, nodeVersion).map(
    (violation) => `${violation.rule}: ${violation.message}`,
  )

describe('release workflow', () => {
  it('release.yml gates every job to its branch, chains them and keeps publish isolated; ci.yml runs on release', () => {
    const violations = checkReleaseWorkflow({
      release: file('.github/workflows/release.yml', readText('.github/workflows/release.yml')),
      ci: file('.github/workflows/ci.yml', readText('.github/workflows/ci.yml')),
      nodeVersion: readText('.node-version'),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the good fixtures, a folded multi-line `if` and `needs` written as a list', () => {
      expect(check()).toEqual([])
      const listed = release({
        pack: change('pack', 'needs: promotion-check', 'needs: [promotion-check]'),
      })
      expect(check(listed)).toEqual([])
    })

    it('reports a release.yml that runs on a branch it should not, or on one it should', () => {
      const run = (branches: string) =>
        messages(release({}, ['on:', '  push:', `    branches: ${branches}`]))
      expect(run('[main]')).toEqual([
        'release-workflow/triggers: release.yml must run on pushes to main and release and to no other branch, found ["main"]',
      ])
      expect(run('[main, release, dev]')).toEqual([
        'release-workflow/triggers: release.yml must run on pushes to main and release and to no other branch, found ["main","release","dev"]',
      ])
      expect(run('[main, main]')).toEqual([
        'release-workflow/triggers: release.yml must run on pushes to main and release and to no other branch, found ["main","main"]',
      ])
      expect(messages(release({}, ['on: workflow_dispatch']))).toEqual([
        'release-workflow/triggers: release.yml must run on pushes to main and release and to no other branch, found []',
      ])
    })

    it('reports a job without the repository gate, and one without the branch gate', () => {
      const noRepository = release({
        pack: change('pack', RELEASE, "github.ref == 'refs/heads/release'"),
      })
      expect(messages(noRepository)).toEqual([
        'release-workflow/job-gate: job "pack": its "if:" must contain github.repository == \'hollware/hollware\', found "github.ref == \'refs/heads/release\'"',
      ])
      const noBranch = release({ finalize: change('finalize', RELEASE, REPO) })
      expect(messages(noBranch)).toEqual([
        'release-workflow/job-gate: job "finalize": its "if:" must contain github.ref == \'refs/heads/release\', found "${{ !cancelled() && github.repository == \'hollware/hollware\' && needs.publish.result == \'success\' }}"',
      ])
    })

    it('reports a release job that is gated to main, and a main job gated to release', () => {
      const packOnMain = release({ pack: change('pack', RELEASE, MAIN) })
      expect(messages(packOnMain)).toEqual([
        `release-workflow/job-gate: job "pack": its "if:" must contain github.ref == 'refs/heads/release', found "${MAIN}"`,
        `release-workflow/job-branch: job "pack" runs on release only: its "if:" must not contain github.ref == 'refs/heads/main', found "${MAIN}"`,
      ])
      const versionOnRelease = release({ version: change('version', MAIN, RELEASE) })
      expect(messages(versionOnRelease).map((message) => message.split(':')[0])).toEqual([
        'release-workflow/job-gate',
        'release-workflow/job-branch',
      ])
    })

    it('reports a job with no `if` at all', () => {
      const text = release({ publish: without('publish', 'if: ') })
      expect(messages(text).map((message) => message.split(':')[0])).toEqual([
        'release-workflow/job-gate',
        'release-workflow/job-gate',
      ])
    })

    it('reports a job the guard does not know, and a known job that is missing', () => {
      const deploy = ['  deploy:', `    if: ${RELEASE}`, '    steps:', '      - run: echo deploy']
      expect(messages(release({}, PUSH_TO_BOTH, deploy))).toEqual([
        'release-workflow/job-unknown: job "deploy" is not one of select-mode, version, promotion-check, pack, publish, finalize: decide which branch it runs on and add it to the release-workflow guard',
      ])
      expect(messages(release({ 'promotion-check': null }))).toEqual([
        'release-workflow/job-missing: release.yml has no "promotion-check" job',
      ])
      expect(messages(release({ finalize: null }))).toEqual([
        'release-workflow/job-missing: release.yml has no "finalize" job',
      ])
    })

    it('reports a job that stops waiting for the job before it', () => {
      const waits = (id: JobId, need: string) =>
        `release-workflow/job-needs: job "${id}" must wait for "${need}": list it in "needs"`
      expect(messages(release({ version: without('version', 'needs: ') }))).toEqual([
        `${waits('version', 'select-mode')}, found []`,
      ])
      expect(messages(release({ pack: without('pack', 'needs: ') }))).toEqual([
        `${waits('pack', 'promotion-check')}, found []`,
      ])
      expect(messages(release({ publish: without('publish', 'needs: ') }))).toEqual([
        `${waits('publish', 'pack')}, found []`,
      ])
      expect(messages(release({ finalize: without('finalize', 'needs: ') }))).toEqual([
        `${waits('finalize', 'publish')}, found []`,
      ])
      const wrong = release({
        pack: change('pack', 'needs: promotion-check', 'needs: select-mode'),
      })
      expect(messages(wrong)).toEqual([
        `${waits('pack', 'promotion-check')}, found ["select-mode"]`,
      ])
    })

    it('reports a publish without the npm environment, or with another one', () => {
      const withEnvironment = (environment: string) =>
        release({ publish: change('publish', 'environment: npm', environment) })
      expect(messages(withEnvironment('environment: staging'))).toEqual([
        'release-workflow/publish-environment: job "publish" must have "environment: npm", found "staging"',
      ])
      expect(messages(release({ publish: without('publish', 'environment: ') }))).toEqual([
        'release-workflow/publish-environment: job "publish" must have "environment: npm", found undefined',
      ])
      expect(check(withEnvironment('environment:\n      name: npm'))).toEqual([])
    })

    it('reports a publish without id-token, or with a permission besides contents: read and id-token: write', () => {
      const noToken = release({ publish: without('publish', 'id-token: write') })
      expect(messages(noToken)).toEqual([
        'release-workflow/publish-id-token: job "publish" must grant "id-token: write": trusted publishing cannot work without it',
      ])
      const writes = release({ publish: change('publish', 'contents: read', 'contents: write') })
      expect(messages(writes)).toEqual([
        'release-workflow/publish-permissions: job "publish" holds the OIDC token, so it may have nothing besides "contents: read" and "id-token: write", found {"contents":"write","id-token":"write"}',
      ])
      const more = release({
        publish: change(
          'publish',
          '      id-token: write',
          '      id-token: write\n      pull-requests: write',
        ),
      })
      expect(messages(more).map((message) => message.split(':')[0])).toEqual([
        'release-workflow/publish-permissions',
      ])
      const allowed = release({ publish: without('publish', 'contents: read') })
      expect(check(allowed)).toEqual([])
    })

    it('reports a publish that checks the repository out', () => {
      const steps = JOBS.publish.map((line) =>
        line === '    steps:' ? `    steps:\n${CHECKOUT}` : line,
      )
      expect(messages(release({ publish: steps }))).toEqual([
        'release-workflow/publish-checkout: job "publish", step 1 checks the repository out: publish runs next to the OIDC token and must run no repository code',
      ])
    })

    it('reports a Node version that is not the exact one of .node-version', () => {
      expect(messages(release(), CI, '24.21.1\n')).toEqual([
        'release-workflow/publish-node-version: job "publish", step 1: "node-version" must be exactly "24.21.1", the content of .node-version, found "24.21.0"',
      ])
      const range = release({
        publish: change('publish', `node-version: ${NODE}`, "node-version: '24'"),
      })
      expect(messages(range)).toEqual([
        'release-workflow/publish-node-version: job "publish", step 1: "node-version" must be exactly "24.21.0", the content of .node-version, found "24"',
      ])
    })

    it('reports a publish without setup-node, and a setup-node that writes an .npmrc', () => {
      const noNode = JOBS.publish
        .slice(0, JOBS.publish.indexOf(SETUP_NODE))
        .concat('      - run: echo')
      expect(messages(release({ publish: noNode }))).toEqual([
        'release-workflow/publish-node-version: job "publish" must set up Node with actions/setup-node at the exact version of .node-version',
      ])
      const registry = release({
        publish: change(
          'publish',
          `node-version: ${NODE}`,
          `node-version: ${NODE}\n          registry-url: https://registry.npmjs.org`,
        ),
      })
      expect(messages(registry)).toEqual([
        'release-workflow/publish-registry-url: job "publish", step 1: setup-node must not set "registry-url": it writes an .npmrc that stops npm from using the OIDC token',
      ])
    })

    it('reports a release.yml without a publish job', () => {
      expect(messages(release({ publish: null }))).toEqual([
        'release-workflow/job-missing: release.yml has no "publish" job',
      ])
    })

    it('reports a ci.yml that stops running on release, or runs the changeset check there', () => {
      const onlyMain = CI.replace('[main, release]', '[main]')
      expect(messages(release(), onlyMain)).toEqual([
        'release-workflow/ci-triggers: ci.yml must run on pushes to main and release, found ["main"]',
      ])
      const always = CI.replace("        if: github.ref != 'refs/heads/release'\n", '')
      expect(messages(release(), always)).toEqual([
        'release-workflow/ci-changeset: job "check", step 1 "Check changesets": the changeset check must be skipped on release, its "if:" must contain github.ref != \'refs/heads/release\', found undefined',
      ])
      const onMain = CI.replace(
        "github.ref != 'refs/heads/release'",
        "github.ref == 'refs/heads/main'",
      )
      expect(messages(release(), onMain).map((message) => message.split(':')[0])).toEqual([
        'release-workflow/ci-changeset',
      ])
    })

    it('reports a ci.yml that no longer runs the changeset check', () => {
      const gone = CI.replace('bash .github/scripts/changeset-check.sh', 'echo nothing')
      expect(messages(release(), gone)).toEqual([
        'release-workflow/ci-changeset: ci.yml has no step that runs .github/scripts/changeset-check.sh: the changeset check is gone',
      ])
    })

    it('reports a workflow that is not valid YAML, and one that hides steps behind an alias', () => {
      expect(messages('jobs: [unclosed').map((message) => message.split(':')[0])).toContain(
        'release-workflow/yaml-error',
      )
      expect(
        messages(release(), 'jobs: [unclosed').map((message) => message.split(':')[0]),
      ).toContain('release-workflow/yaml-error')
      const aliased = release({
        pack: [
          '  pack:',
          '    needs: promotion-check',
          `    if: ${RELEASE}`,
          '    steps:',
          '      - &step',
          '        run: echo pack',
          '      - *step',
        ],
      })
      expect(messages(aliased)).toEqual([
        'release-workflow/yaml-error: the workflow cannot be checked: YAML aliases hide steps from the guards: write each step out',
      ])
    })
  })
})
