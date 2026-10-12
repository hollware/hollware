import { describe, expect, it } from 'vite-plus/test'
import { checkReleaseWorkflow } from '../guards/release-workflow.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

// Fails when: a job of release.yml loses the repository or the main-branch gate in its `if:`, or
// the `stage` job loses `environment: npm` or `id-token: write`, checks the repository out, or
// sets up Node at a version other than the exact one in .node-version.

const NODE = '24.21.0'
const GATE = "github.repository == 'hollware/hollware' && github.ref == 'refs/heads/main'"

const STAGE = [
  '  stage:',
  `    if: ${GATE}`,
  '    environment: npm',
  '    permissions:',
  '      id-token: write',
  '    steps:',
  '      - uses: actions/setup-node@' + 'b'.repeat(40) + ' # v7.0.0',
  '        with:',
  `          node-version: ${NODE}`,
].join('\n')

const release = (overrides: { gate?: string; stage?: string } = {}) =>
  [
    'permissions: {}',
    'jobs:',
    '  pack:',
    `    if: ${overrides.gate ?? GATE}`,
    '    steps:',
    '      - uses: actions/checkout@' + 'a'.repeat(40) + ' # v7.0.1',
    overrides.stage ?? STAGE,
  ].join('\n')

const check = (text: string, nodeVersion = `${NODE}\n`) =>
  checkReleaseWorkflow({ release: file('.github/workflows/release.yml', text), nodeVersion })

const messages = (text: string, nodeVersion?: string) =>
  check(text, nodeVersion).map((violation) => `${violation.rule}: ${violation.message}`)

describe('release workflow', () => {
  it('release.yml gates every job and keeps stage isolated', () => {
    const violations = checkReleaseWorkflow({
      release: file('.github/workflows/release.yml', readText('.github/workflows/release.yml')),
      nodeVersion: readText('.node-version'),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the good fixture, and a folded multi-line `if`', () => {
      expect(check(release())).toEqual([])
      const folded = release({ gate: `>-\n      \${{ !cancelled() &&\n      ${GATE} }}` })
      expect(check(folded)).toEqual([])
    })

    it('reports a job without the repository gate, and one without the branch gate', () => {
      expect(messages(release({ gate: "github.ref == 'refs/heads/main'" }))).toEqual([
        'release-workflow/job-gate: job "pack": its "if:" must contain github.repository == \'hollware/hollware\', found "github.ref == \'refs/heads/main\'"',
      ])
      expect(messages(release({ gate: "github.repository == 'hollware/hollware'" }))).toEqual([
        'release-workflow/job-gate: job "pack": its "if:" must contain github.ref == \'refs/heads/main\', found "github.repository == \'hollware/hollware\'"',
      ])
    })

    it('reports a job with no `if` at all', () => {
      const text = release().replace(
        `    if: ${GATE}\n    steps:\n      - uses: actions/checkout`,
        '    steps:\n      - uses: actions/checkout',
      )
      expect(messages(text).map((message) => message.split(':')[0])).toEqual([
        'release-workflow/job-gate',
        'release-workflow/job-gate',
      ])
    })

    it('reports a stage without the npm environment, or with another one', () => {
      const withEnvironment = (environment: string) =>
        release({ stage: STAGE.replace('environment: npm', environment) })
      expect(messages(withEnvironment('environment: staging'))).toEqual([
        'release-workflow/stage-environment: job "stage" must have "environment: npm", found "staging"',
      ])
      expect(messages(withEnvironment('')).map((message) => message.split(':')[0])).toEqual([
        'release-workflow/stage-environment',
      ])
      expect(check(withEnvironment('environment:\n      name: npm'))).toEqual([])
    })

    it('reports a stage that checks the repository out', () => {
      const stage = STAGE.replace(
        '    steps:\n',
        '    steps:\n      - uses: actions/checkout@' + 'a'.repeat(40) + ' # v7.0.1\n',
      )
      expect(messages(release({ stage }))).toEqual([
        'release-workflow/stage-checkout: job "stage", step 1 checks the repository out: stage runs next to the OIDC token and must run no repository code',
      ])
    })

    it('reports a Node version that is not the exact one of .node-version', () => {
      expect(messages(release(), '24.21.1\n')).toEqual([
        'release-workflow/stage-node-version: job "stage", step 1: "node-version" must be exactly "24.21.1", the content of .node-version, found "24.21.0"',
      ])
      const range = release().replace(`node-version: ${NODE}`, "node-version: '24'")
      expect(messages(range)).toEqual([
        'release-workflow/stage-node-version: job "stage", step 1: "node-version" must be exactly "24.21.0", the content of .node-version, found "24"',
      ])
    })

    it('reports a stage without setup-node, without id-token, and a release without a stage', () => {
      const noNode = release({ stage: STAGE.split('      - uses:')[0] + '      - run: echo' })
      expect(messages(noNode)).toEqual([
        'release-workflow/stage-node-version: job "stage" must set up Node with actions/setup-node at the exact version of .node-version',
      ])
      const noToken = release({
        stage: STAGE.replace('    permissions:\n      id-token: write\n', ''),
      })
      expect(messages(noToken)).toEqual([
        'release-workflow/stage-id-token: job "stage" must grant "id-token: write": trusted publishing cannot work without it',
      ])
      expect(messages(release({ stage: '' }))).toEqual([
        'release-workflow/stage-missing: release.yml has no "stage" job',
      ])
    })
  })
})
