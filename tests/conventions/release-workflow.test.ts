import { describe, expect, it } from 'vite-plus/test'
import { AUDIT_COMMAND, checkReleaseWorkflow } from '../guards/release-workflow.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

const NODE = '24.21.0'
const REPO = "github.repository == 'hollware/hollware'"
const MAIN = `${REPO} && github.ref == 'refs/heads/main'`
const RELEASE = `${REPO} && github.ref == 'refs/heads/release'`
const CHECKOUT = '      - uses: actions/checkout@' + 'a'.repeat(40) + ' # v7.0.1'
const FULL_HISTORY = ['        with:', '          fetch-depth: 0']
const SETUP_NODE = '      - uses: actions/setup-node@' + 'b'.repeat(40) + ' # v7.0.0'

const finalizeIf = (gate: string) =>
  `\${{ !cancelled() && ${gate} && (needs.publish.result == 'success' || (github.event_name == 'workflow_dispatch' && inputs.finalize_only)) }}`

const RELEASE_SHA_EXPRESSION = "${{ inputs.finalize_only != true && github.sha || '' }}"
const RELEASE_SHA_WITH_INPUT =
  '${{ inputs.finalize_only != true && github.sha || inputs.release_sha }}'

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
    `    if: ${RELEASE} && !inputs.finalize_only`,
    '    steps:',
    CHECKOUT,
    ...FULL_HISTORY,
    '      - name: Check the promotion',
    '        env:',
    '          PROMOTED_SHA: ${{ github.sha }}',
    '          BEFORE_SHA: ${{ github.event.before }}',
    '        run: bash .github/scripts/promotion-check.sh',
    '      - name: Audit what is published',
    `        run: ${AUDIT_COMMAND}`,
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
    "      (needs.publish.result == 'success' || (github.event_name == 'workflow_dispatch' && inputs.finalize_only)) }}",
    '    steps:',
    CHECKOUT,
    ...FULL_HISTORY,
    '      - name: Wait for npm, then tag and release',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    `          RELEASE_SHA: ${RELEASE_SHA_EXPRESSION}`,
    "          WAIT_SECONDS: '1800'",
    '        run: bash .github/scripts/finalize-release.sh',
  ],
}

function change(id: JobId, from: string, to: string): string[] {
  const lines = JOBS[id]
  if (!lines.some((line) => line.includes(from)))
    throw new Error(`the ${id} fixture has no "${from}"`)
  return lines.map((line) => line.replace(from, to))
}

function without(id: JobId, part: string): string[] {
  const lines = JOBS[id]
  if (!lines.some((line) => line.includes(part)))
    throw new Error(`the ${id} fixture has no "${part}"`)
  return lines.filter((line) => !line.includes(part))
}

const DISPATCH = [
  '  workflow_dispatch:',
  '    inputs:',
  '      finalize_only:',
  '        type: boolean',
]
const PUSH_TO_BOTH = ['on:', '  push:', '    branches: [main, release]', ...DISPATCH]
const CONCURRENCY = [
  'concurrency:',
  '  group: release-${{ github.ref }}',
  '  cancel-in-progress: false',
]

function release(
  overrides: Partial<Record<JobId, string[] | null>> = {},
  triggers: string[] = PUSH_TO_BOTH,
  extraJobs: string[] = [],
  concurrency: string[] = CONCURRENCY,
): string {
  return [
    ...triggers,
    ...concurrency,
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
  CHECKOUT,
  ...FULL_HISTORY,
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
  it('release.yml gates every job to its branch, chains them and keeps publish isolated, runs once per ref and wires finalize_only; ci.yml runs on release', () => {
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
        messages(release({}, ['on:', '  push:', `    branches: ${branches}`, ...DISPATCH]))
      expect(run('[main]')).toEqual([
        'release-workflow/triggers: release.yml must run on pushes to main and release and to no other branch, found ["main"]',
      ])
      expect(run('[main, release, dev]')).toEqual([
        'release-workflow/triggers: release.yml must run on pushes to main and release and to no other branch, found ["main","release","dev"]',
      ])
      expect(run('[main, main]')).toEqual([
        'release-workflow/triggers: release.yml must run on pushes to main and release and to no other branch, found ["main","main"]',
      ])
      expect(messages(release({}, ['on:', ...DISPATCH]))).toEqual([
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
        `release-workflow/job-gate: job "finalize": its "if:" must contain github.ref == 'refs/heads/release', found ${JSON.stringify(finalizeIf(REPO))}`,
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

    it('reports a promotion check that no longer audits what is published', () => {
      const unaudited = change(
        'promotion-check',
        `        run: ${AUDIT_COMMAND}`,
        '        run: pnpm audit --prod',
      )
      expect(messages(release({ 'promotion-check': unaudited }))).toEqual([
        `release-workflow/audit: job "promotion-check" must run \`${AUDIT_COMMAND}\`: a release of a package whose production dependencies have a known high vulnerability stops before anything is packed`,
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

    describe('one run at a time per ref', () => {
      const wanted =
        'release-workflow/concurrency: release.yml must run one run at a time per ref: its top-level "concurrency" must be {"group":"release-${{ github.ref }}","cancel-in-progress":false}, found '

      it('reports a release.yml without a concurrency group, with a group that every ref shares, or one that cancels or does not say', () => {
        expect(messages(release({}, PUSH_TO_BOTH, [], []))).toEqual([`${wanted}undefined`])
        const sharedGroup = ['concurrency:', '  group: release', '  cancel-in-progress: false']
        expect(messages(release({}, PUSH_TO_BOTH, [], sharedGroup))).toEqual([
          `${wanted}{"group":"release","cancel-in-progress":false}`,
        ])
        const cancels = CONCURRENCY.map((line) => line.replace('false', 'true'))
        expect(messages(release({}, PUSH_TO_BOTH, [], cancels))).toEqual([
          `${wanted}{"group":"release-\${{ github.ref }}","cancel-in-progress":true}`,
        ])
        const silent = CONCURRENCY.filter((line) => !line.includes('cancel-in-progress'))
        expect(messages(release({}, PUSH_TO_BOTH, [], silent))).toEqual([
          `${wanted}{"group":"release-\${{ github.ref }}"}`,
        ])
        const name = ['concurrency: release-${{ github.ref }}']
        expect(messages(release({}, PUSH_TO_BOTH, [], name))).toEqual([
          `${wanted}"release-\${{ github.ref }}"`,
        ])
      })

      it('reports a job that sets a concurrency of its own', () => {
        const own = release({
          version: change(
            'version',
            'needs: select-mode',
            'needs: select-mode\n    concurrency: version',
          ),
        })
        expect(messages(own)).toEqual([
          'release-workflow/job-concurrency: job "version" sets its own "concurrency", found "version": the group of the workflow is the only one, or runs overlap or cancel each other',
        ])
      })
    })

    describe('the scripts and what they are handed', () => {
      const promotion = 'job "promotion-check", step 2 "Check the promotion"'
      const finalize = 'job "finalize", step 2 "Wait for npm, then tag and release"'

      it('reports a promotion check that is not handed the commit or the previous tip of release', () => {
        expect(
          messages(release({ 'promotion-check': without('promotion-check', 'BEFORE_SHA') })),
        ).toEqual([
          `release-workflow/script-env: ${promotion}: env "BEFORE_SHA" must be "\${{ github.event.before }}" (the tip release had before the push: without it the fast-forward check cannot run), found undefined`,
        ])
        const blank = release({
          'promotion-check': change('promotion-check', '${{ github.event.before }}', "''"),
        })
        expect(messages(blank)).toEqual([
          `release-workflow/script-env: ${promotion}: env "BEFORE_SHA" must be "\${{ github.event.before }}" (the tip release had before the push: without it the fast-forward check cannot run), found ""`,
        ])
        const another = release({
          'promotion-check': change('promotion-check', 'github.sha', 'github.event.after'),
        })
        expect(messages(another)).toEqual([
          `release-workflow/script-env: ${promotion}: env "PROMOTED_SHA" must be "\${{ github.sha }}" (the commit that was pushed to release), found "\${{ github.event.after }}"`,
        ])
      })

      it('reports a finalize that is not handed its token, or another one than the workflow token', () => {
        const noToken = release({ finalize: without('finalize', 'GH_TOKEN') })
        expect(messages(noToken)).toEqual([
          `release-workflow/script-env: ${finalize}: env "GH_TOKEN" must be "\${{ github.token }}" (gh authenticates with it, and git never pushes), found undefined`,
        ])
        const secret = release({
          finalize: change('finalize', 'github.token', 'secrets.RELEASE_TOKEN'),
        })
        expect(messages(secret)).toEqual([
          `release-workflow/script-env: ${finalize}: env "GH_TOKEN" must be "\${{ github.token }}" (gh authenticates with it, and git never pushes), found "\${{ secrets.RELEASE_TOKEN }}"`,
        ])
      })

      it('reports a step that sets a key its script does not take, and a WAIT_SECONDS that is no number of seconds', () => {
        const dryRun = release({
          finalize: change(
            'finalize',
            "          WAIT_SECONDS: '1800'",
            "          DRY_RUN: 'true'",
          ),
        })
        expect(messages(dryRun)).toEqual([
          `release-workflow/script-env: ${finalize}: env "DRY_RUN" is not an input that finalize-release.sh takes from the workflow, which are GH_TOKEN, RELEASE_SHA, WAIT_SECONDS`,
        ])
        const event = release({
          'promotion-check': change(
            'promotion-check',
            '        env:',
            '        env:\n          GITHUB_EVENT_NAME: workflow_dispatch',
          ),
        })
        expect(messages(event)).toEqual([
          `release-workflow/script-env: ${promotion}: env "GITHUB_EVENT_NAME" is not an input that promotion-check.sh takes from the workflow, which are PROMOTED_SHA, BEFORE_SHA`,
        ])
        for (const wait of ["'soon'", "'0'", "''"]) {
          const bad = release({
            finalize: change('finalize', "'1800'", wait),
          })
          expect(messages(bad)).toEqual([
            `release-workflow/script-env: ${finalize}: env "WAIT_SECONDS" must match /^[1-9][0-9]*$/, found ${JSON.stringify(wait.slice(1, -1))}`,
          ])
        }
        expect(check(release({ finalize: without('finalize', 'WAIT_SECONDS') }))).toEqual([])
        expect(check(release({ finalize: change('finalize', "'1800'", '3600') }))).toEqual([])
      })

      it('reports a job that no longer runs its script', () => {
        const gone = release({
          'promotion-check': change(
            'promotion-check',
            'bash .github/scripts/promotion-check.sh',
            'echo promote',
          ),
        })
        expect(messages(gone)).toEqual([
          'release-workflow/script-step: job "promotion-check" has no step that runs .github/scripts/promotion-check.sh',
        ])
        const finalizeGone = release({
          finalize: change('finalize', 'finalize-release.sh', 'finalize.sh'),
        })
        expect(messages(finalizeGone)).toEqual([
          'release-workflow/script-step: job "finalize" has no step that runs .github/scripts/finalize-release.sh',
        ])
      })

      it('reports a script that follows a checkout that does not fetch the whole history, or no checkout', () => {
        const shallow = release({
          'promotion-check': without('promotion-check', 'fetch-depth: 0'),
        })
        expect(messages(shallow)).toEqual([
          'release-workflow/fetch-depth: job "promotion-check", step 1: actions/checkout must set "fetch-depth: 0" (origin/main, and the history between the two tips of release), found undefined',
        ])
        const one = release({ finalize: change('finalize', 'fetch-depth: 0', 'fetch-depth: 1') })
        expect(messages(one)).toEqual([
          'release-workflow/fetch-depth: job "finalize", step 1: actions/checkout must set "fetch-depth: 0" (the release commit is found in the history), found 1',
        ])
        const noCheckout = release({
          finalize: JOBS.finalize.filter(
            (line) => line !== CHECKOUT && !FULL_HISTORY.includes(line),
          ),
        })
        expect(messages(noCheckout)).toEqual([
          'release-workflow/fetch-depth: job "finalize" runs .github/scripts/finalize-release.sh with no actions/checkout step before it',
        ])
        const quoted = release({
          finalize: change('finalize', 'fetch-depth: 0', "fetch-depth: '0'"),
        })
        expect(check(quoted)).toEqual([])
      })
    })

    describe('finalize_only', () => {
      const releaseSha = (found: string) =>
        `release-workflow/finalize-only-release-sha: job "finalize", step 2 "Wait for npm, then tag and release": env "RELEASE_SHA" must be ${JSON.stringify(RELEASE_SHA_EXPRESSION)} or ${JSON.stringify(RELEASE_SHA_WITH_INPUT)} (the head of release, and empty on a finalize-only run, which has no build of its own: the script then looks for the latest "Version Packages" commit, unless the release_sha input names it), found ${found}`

      it('reports a workflow_dispatch without a boolean finalize_only input', () => {
        const wanted = (found: string) =>
          `release-workflow/finalize-only-input: release.yml must take a boolean input "finalize_only" on workflow_dispatch: it is how a failed finalize runs again, found ${found}`
        const push = ['on:', '  push:', '    branches: [main, release]']
        expect(messages(release({}, push))).toEqual([wanted('undefined')])
        expect(messages(release({}, [...push, '  workflow_dispatch:']))).toEqual([
          wanted('undefined'),
        ])
        const text = release({}, [
          ...push,
          ...DISPATCH.map((line) => line.replace('boolean', 'string')),
        ])
        expect(messages(text)).toEqual([wanted('{"type":"string"}')])
      })

      it('reports a promotion check that a finalize-only run does not skip', () => {
        const wanted = (found: string) =>
          `release-workflow/finalize-only-promotion: job "promotion-check": its "if:" must contain !inputs.finalize_only, so that a finalize-only run skips the promotion check, found ${JSON.stringify(found)}`
        const never = release({
          'promotion-check': change('promotion-check', ' && !inputs.finalize_only', ''),
        })
        expect(messages(never)).toEqual([wanted(RELEASE)])
        const flipped = release({
          'promotion-check': change(
            'promotion-check',
            '!inputs.finalize_only',
            'inputs.finalize_only',
          ),
        })
        expect(messages(flipped)).toEqual([wanted(`${RELEASE} && inputs.finalize_only`)])
      })

      it('reports a pack or a publish that would run after the skipped promotion check', () => {
        const wanted = (id: string, found: string) =>
          `release-workflow/finalize-only-chain: job "${id}": its "if:" must call no status function (always(), cancelled(), failure()): it would run after the skipped "promotion-check", and a finalize-only run would pack and publish, found ${JSON.stringify(found)}`
        const always = release({
          pack: change('pack', `if: ${RELEASE}`, `if: always() && ${RELEASE}`),
        })
        expect(messages(always)).toEqual([wanted('pack', `always() && ${RELEASE}`)])
        const notCancelled = `\${{ !cancelled() && ${RELEASE} && needs.pack.outputs.artifact-id != '' }}`
        const text = release({
          publish: change(
            'publish',
            `if: ${RELEASE} && needs.pack.outputs.artifact-id != ''`,
            `if: ${notCancelled}`,
          ),
        })
        expect(messages(text)).toEqual([wanted('publish', notCancelled)])
        const failure = release({
          pack: change('pack', `if: ${RELEASE}`, `if: failure() && ${RELEASE}`),
        })
        expect(messages(failure)).toEqual([wanted('pack', `failure() && ${RELEASE}`)])
      })

      it('reports a finalize that does not run on a manual run with finalize_only, or after the skipped publish', () => {
        const dispatch = (found: string) =>
          `release-workflow/finalize-only-finalize: job "finalize": its "if:" must run it on a manual run with finalize_only, so it must contain github.event_name == 'workflow_dispatch' && inputs.finalize_only, found ${JSON.stringify(found)}`
        const status = (found: string) =>
          `release-workflow/finalize-only-finalize: job "finalize": its "if:" must call a status function (!cancelled() or always()): "publish" is skipped on a finalize-only run, and a job after a skipped one is skipped too without it, found ${JSON.stringify(found)}`
        const noDispatch = release({
          finalize: change(
            'finalize',
            " || (github.event_name == 'workflow_dispatch' && inputs.finalize_only)",
            '',
          ),
        })
        expect(messages(noDispatch)).toEqual([
          dispatch(`\${{ !cancelled() && ${RELEASE} && (needs.publish.result == 'success') }}`),
        ])
        const noStatus = release({ finalize: change('finalize', '!cancelled() && ', '') })
        expect(messages(noStatus)).toEqual([
          status(finalizeIf(RELEASE).replace('!cancelled() && ', '')),
        ])
        const always = release({ finalize: change('finalize', '!cancelled()', 'always()') })
        expect(check(always)).toEqual([])
      })

      it('reports a RELEASE_SHA that is not empty on a finalize-only run, or that is gone', () => {
        const withSha = (expression: string) =>
          release({ finalize: change('finalize', RELEASE_SHA_EXPRESSION, expression) })
        expect(messages(withSha('${{ github.sha }}'))).toEqual([releaseSha('"${{ github.sha }}"')])
        expect(messages(withSha("${{ inputs.finalize_only && github.sha || '' }}"))).toEqual([
          releaseSha(`"\${{ inputs.finalize_only && github.sha || '' }}"`),
        ])
        expect(messages(withSha('${{ inputs.finalize_only != true && github.sha }}'))).toEqual([
          releaseSha('"${{ inputs.finalize_only != true && github.sha }}"'),
        ])
        expect(messages(release({ finalize: without('finalize', 'RELEASE_SHA') }))).toEqual([
          releaseSha('undefined'),
        ])
        expect(
          check(withSha("${{  inputs.finalize_only != true  &&  github.sha  ||  '' }}")),
        ).toEqual([])
      })

      it('accepts a RELEASE_SHA that is the commit named in the release_sha input on a finalize-only run, and reports one without that input', () => {
        const triggers = (type: string) => [
          ...PUSH_TO_BOTH,
          '      release_sha:',
          `        type: ${type}`,
        ]
        const named = release(
          { finalize: change('finalize', RELEASE_SHA_EXPRESSION, RELEASE_SHA_WITH_INPUT) },
          triggers('string'),
        )
        expect(check(named)).toEqual([])
        const wanted = (found: string) =>
          `release-workflow/finalize-only-release-sha: release.yml hands inputs.release_sha to finalize as RELEASE_SHA, so workflow_dispatch must take a string input "release_sha", found ${found}`
        const noInput = release({
          finalize: change('finalize', RELEASE_SHA_EXPRESSION, RELEASE_SHA_WITH_INPUT),
        })
        expect(messages(noInput)).toEqual([wanted('undefined')])
        const boolean = release(
          { finalize: change('finalize', RELEASE_SHA_EXPRESSION, RELEASE_SHA_WITH_INPUT) },
          triggers('boolean'),
        )
        expect(messages(boolean)).toEqual([wanted('{"type":"boolean"}')])
      })
    })

    it('reports a ci.yml that stops running on release, or runs the changeset check there', () => {
      const onlyMain = CI.replace('[main, release]', '[main]')
      expect(messages(release(), onlyMain)).toEqual([
        'release-workflow/ci-triggers: ci.yml must run on pushes to main and release, found ["main"]',
      ])
      const always = CI.replace("        if: github.ref != 'refs/heads/release'\n", '')
      expect(messages(release(), always)).toEqual([
        'release-workflow/ci-changeset: job "check", step 2 "Check changesets": the changeset check must be skipped on release, its "if:" must contain github.ref != \'refs/heads/release\', found undefined',
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

    it('reports a ci.yml that runs the changeset check after a shallow checkout, or none', () => {
      const wanted = (found: string) =>
        `release-workflow/ci-fetch-depth: job "check", step 1: actions/checkout must set "fetch-depth: 0" (the check compares a push with the tip the branch had before it, and fails when that tip is not in the clone), found ${found}`
      const shallow = CI.replace('          fetch-depth: 0', '          fetch-depth: 1')
      expect(messages(release(), shallow)).toEqual([wanted('1')])
      const unset = CI.replace('        with:\n          fetch-depth: 0\n', '')
      expect(messages(release(), unset)).toEqual([wanted('undefined')])
      const noCheckout = CI.replace(`${CHECKOUT}\n        with:\n          fetch-depth: 0\n`, '')
      expect(messages(release(), noCheckout)).toEqual([
        'release-workflow/ci-fetch-depth: job "check" runs .github/scripts/changeset-check.sh with no actions/checkout step before it',
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
