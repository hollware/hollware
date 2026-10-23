import { describe, expect, it } from 'vite-plus/test'
import { describeViolations } from '../guards/types.ts'
import { checkWorkflowPermissions } from '../guards/workflow-permissions.ts'
import { file } from '../support/fixtures.ts'
import { isWorkflowPath, readRepoFiles } from '../support/repo.ts'

const CHECKOUT = '      - uses: actions/checkout@' + 'a'.repeat(40) + ' # v7.0.1'

const check = (path: string, text: string) =>
  checkWorkflowPermissions({ workflows: [file(`.github/workflows/${path}`, text)] })

const goodRelease = [
  'permissions: {}',
  'jobs:',
  '  pack:',
  '    permissions:',
  '      contents: read',
  '    steps:',
  CHECKOUT,
  '        with:',
  '          persist-credentials: false',
  '  publish:',
  '    permissions:',
  '      contents: read',
  '      id-token: write',
  '    steps:',
  '      - run: echo published',
].join('\n')

describe('workflow permissions', () => {
  it('every workflow starts from no permissions and grants id-token and credentials sparingly', () => {
    const workflows = readRepoFiles(isWorkflowPath)
    expect(workflows.length).toBeGreaterThanOrEqual(3)
    expect(describeViolations(checkWorkflowPermissions({ workflows }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts a release with id-token only in publish', () => {
      expect(check('release.yml', goodRelease)).toEqual([])
    })

    it('reports a workflow without top-level permissions', () => {
      expect(check('release.yml', goodRelease.replace('permissions: {}\n', ''))).toEqual([
        {
          rule: 'workflow-permissions/top-level',
          file: '.github/workflows/release.yml',
          message: 'the workflow must start with "permissions: {}" and grant permissions per job',
        },
      ])
    })

    it('reports top-level permissions that grant anything, and write-all', () => {
      const granted = check(
        'release.yml',
        goodRelease.replace('permissions: {}', 'permissions:\n  contents: read'),
      )
      expect(granted).toEqual([
        {
          rule: 'workflow-permissions/top-level',
          file: '.github/workflows/release.yml',
          message: 'the top-level "permissions" must be {}, found {"contents":"read"}',
        },
      ])
      const writeAll = check(
        'release.yml',
        goodRelease.replace('permissions: {}', 'permissions: write-all'),
      )
      expect(writeAll[0]?.message).toBe('the top-level "permissions" must be {}, found "write-all"')
    })

    it('reports id-token: write in a job that may not have it', () => {
      const text = goodRelease.replace(
        '  pack:\n    permissions:\n      contents: read',
        '  pack:\n    permissions:\n      id-token: write',
      )
      expect(check('release.yml', text)).toEqual([
        {
          rule: 'workflow-permissions/id-token',
          file: '.github/workflows/release.yml',
          message:
            'job "pack" grants "id-token: write", which only release.yml#publish and security.yml#scorecard may: it lets a job mint OIDC tokens',
        },
      ])
    })

    it('reports the job named publish in another workflow, and scorecard in release.yml', () => {
      expect(check('ci.yml', goodRelease).map((violation) => violation.message)).toEqual([
        'job "publish" grants "id-token: write", which only release.yml#publish and security.yml#scorecard may: it lets a job mint OIDC tokens',
      ])
      const scorecardInRelease = goodRelease.replace('  publish:', '  scorecard:')
      expect(check('release.yml', scorecardInRelease)).toHaveLength(1)
      expect(check('security.yml', scorecardInRelease)).toEqual([])
    })

    it('reports the old stage job of release.yml: only publish may hold the token now', () => {
      expect(check('release.yml', goodRelease.replace('  publish:', '  stage:'))).toEqual([
        {
          rule: 'workflow-permissions/id-token',
          file: '.github/workflows/release.yml',
          message:
            'job "stage" grants "id-token: write", which only release.yml#publish and security.yml#scorecard may: it lets a job mint OIDC tokens',
        },
      ])
    })

    it('reports a job that grants write-all', () => {
      const text = goodRelease.replace(
        '    permissions:\n      contents: read\n      id-token: write',
        '    permissions: write-all',
      )
      expect(check('release.yml', text)).toEqual([
        {
          rule: 'workflow-permissions/job-permissions',
          file: '.github/workflows/release.yml',
          message:
            'job "publish": "permissions" must be a mapping of the scopes it needs, found "write-all"',
        },
      ])
    })

    it('reports a checkout that keeps its credentials', () => {
      const without = goodRelease.replace(
        '        with:\n          persist-credentials: false\n',
        '',
      )
      expect(check('release.yml', without)).toEqual([
        {
          rule: 'workflow-permissions/checkout-credentials',
          file: '.github/workflows/release.yml',
          message:
            'job "pack", step 1: actions/checkout must set "persist-credentials: false", found undefined',
        },
      ])
      const kept = goodRelease.replace('persist-credentials: false', 'persist-credentials: true')
      expect(check('release.yml', kept)[0]?.message).toBe(
        'job "pack", step 1: actions/checkout must set "persist-credentials: false", found true',
      )
    })

    it('reports top-level env or defaults in security.yml, where Scorecard rejects them', () => {
      const withEnv = goodRelease.replace(
        'permissions: {}\n',
        'permissions: {}\nenv:\n  A: b\ndefaults:\n  run:\n    shell: bash\n',
      )
      expect(
        check('security.yml', withEnv.replace('  publish:', '  scorecard:')).map(
          (violation) => violation.message,
        ),
      ).toEqual([
        'security.yml must have no top-level "env": OpenSSF Scorecard rejects the results of a workflow that has it',
        'security.yml must have no top-level "defaults": OpenSSF Scorecard rejects the results of a workflow that has it',
      ])
      const minimal =
        'permissions: {}\nenv:\n  A: b\njobs:\n  build:\n    steps:\n      - run: echo'
      expect(check('ci.yml', minimal)).toEqual([])
    })

    it('reports a workflow that is not valid YAML', () => {
      expect(check('ci.yml', 'jobs: [unclosed').map((violation) => violation.rule)).toContain(
        'workflow-permissions/yaml-error',
      )
    })
  })
})
