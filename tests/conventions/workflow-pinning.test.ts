import { describe, expect, it } from 'vite-plus/test'
import { describeViolations } from '../guards/types.ts'
import { checkWorkflowPinning } from '../guards/workflow-pinning.ts'
import { allUses, parseWorkflow } from '../guards/workflow-model.ts'
import { file } from '../support/fixtures.ts'
import { isWorkflowPath, readRepoFiles } from '../support/repo.ts'

// Fails when: a `uses:` in .github/workflows is not owner/repo[/subpath]@<40 hex> # vX.Y.Z (a
// tag, a branch, a short SHA, a missing or malformed version comment, a local action or an
// image), or one action is pinned to two different commits across the workflows.

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const workflow = (...uses: string[]) =>
  [
    'permissions: {}',
    'jobs:',
    '  build:',
    '    steps:',
    ...uses.map((value) => `      - uses: ${value}`),
  ].join('\n')

const check = (...workflows: string[]) =>
  checkWorkflowPinning({
    workflows: workflows.map((text, index) => file(`.github/workflows/w${index}.yml`, text)),
  })

describe('workflow action pinning', () => {
  it('every action of every workflow is pinned to a commit with its version', () => {
    const workflows = readRepoFiles(isWorkflowPath)
    const total = workflows.flatMap((item) => allUses(parseWorkflow(item))).length
    expect(workflows.length).toBeGreaterThanOrEqual(3)
    expect(total).toBeGreaterThan(20)
    expect(describeViolations(checkWorkflowPinning({ workflows }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts pinned actions, subpaths included', () => {
      const good = workflow(
        `actions/checkout@${SHA_A} # v7.0.1`,
        `changesets/action/version@${SHA_B} # v2.1.2`,
        `github/codeql-action/upload-sarif@${SHA_A} # v4.38.3`,
      )
      expect(check(good)).toEqual([])
    })

    it('reports a tag and a branch', () => {
      expect(check(workflow('actions/checkout@v4', 'actions/checkout@main'))).toEqual([
        {
          rule: 'workflow-pinning/unpinned',
          file: '.github/workflows/w0.yml',
          message:
            'line 5: "uses: actions/checkout@v4" must be owner/repo[/subpath]@<40-character commit SHA>, never a tag, a branch, a local path or an image',
        },
        {
          rule: 'workflow-pinning/unpinned',
          file: '.github/workflows/w0.yml',
          message:
            'line 6: "uses: actions/checkout@main" must be owner/repo[/subpath]@<40-character commit SHA>, never a tag, a branch, a local path or an image',
        },
      ])
    })

    it('reports a short SHA, an uppercase SHA, a local action and an image', () => {
      const result = check(
        workflow(
          `actions/checkout@${SHA_A.slice(0, 39)} # v1.0.0`,
          `actions/checkout@${SHA_A.toUpperCase()} # v1.0.0`,
          './.github/actions/local',
          'docker://alpine:3.20',
        ),
      )
      expect(result.map((violation) => violation.rule)).toEqual(
        Array.from({ length: 4 }, () => 'workflow-pinning/unpinned'),
      )
    })

    it('reports a SHA without its version comment, or with the wrong kind of comment', () => {
      const result = check(
        workflow(
          `actions/checkout@${SHA_A}`,
          `actions/checkout@${SHA_A} # latest`,
          `actions/checkout@${SHA_A} # v4`,
          `actions/checkout@${SHA_A} # release v1.2.3`,
        ),
      )
      expect(result.map((violation) => violation.message)).toEqual([
        `line 5: "uses: actions/checkout@${SHA_A}" needs a trailing "# vX.Y.Z" comment with the release of that commit, found none`,
        `line 6: "uses: actions/checkout@${SHA_A}" needs a trailing "# vX.Y.Z" comment with the release of that commit, found "# latest"`,
        `line 7: "uses: actions/checkout@${SHA_A}" needs a trailing "# vX.Y.Z" comment with the release of that commit, found "# v4"`,
        `line 8: "uses: actions/checkout@${SHA_A}" needs a trailing "# vX.Y.Z" comment with the release of that commit, found "# release v1.2.3"`,
      ])
    })

    it('reports one action pinned to two commits across workflows, and across subpaths', () => {
      const result = check(
        workflow(`changesets/action/version@${SHA_A} # v2.1.2`),
        workflow(`changesets/action/pack@${SHA_B} # v2.1.2`),
      )
      expect(result).toEqual([
        {
          rule: 'workflow-pinning/inconsistent',
          file: '.github/workflows/w1.yml',
          message: `line 5: changesets/action is pinned to ${SHA_B} (v2.1.2) here and to ${SHA_A} (v2.1.2) at .github/workflows/w0.yml:5: bump an action everywhere at once`,
        },
      ])
    })

    it('reports a version comment that differs for the same commit', () => {
      const result = check(
        workflow(`actions/checkout@${SHA_A} # v7.0.1`),
        workflow(`actions/checkout@${SHA_A} # v7.0.0`),
      )
      expect(result.map((violation) => violation.rule)).toEqual(['workflow-pinning/inconsistent'])
    })

    it('also checks the uses of a job that calls a reusable workflow', () => {
      const text = [
        'permissions: {}',
        'jobs:',
        '  call:',
        '    uses: org/repo/.github/workflows/x.yml@main',
      ].join('\n')
      expect(check(text).map((violation) => violation.rule)).toEqual(['workflow-pinning/unpinned'])
    })

    it('reports a workflow that is not valid YAML', () => {
      const result = check('jobs: [unclosed')
      expect(result.map((violation) => violation.rule)).toContain('workflow-pinning/yaml-error')
    })

    it('reports YAML aliases, which would hide an unpinned step from the guard', () => {
      const text = [
        'permissions: {}',
        'jobs:',
        '  build:',
        '    steps:',
        '      - &checkout',
        '        uses: actions/checkout@main',
        '      - *checkout',
      ].join('\n')
      expect(check(text)).toEqual([
        {
          rule: 'workflow-pinning/yaml-error',
          file: '.github/workflows/w0.yml',
          message:
            'the workflow cannot be checked: YAML aliases hide steps from the guards: write each step out',
        },
        {
          rule: 'workflow-pinning/unpinned',
          file: '.github/workflows/w0.yml',
          message:
            'line 6: "uses: actions/checkout@main" must be owner/repo[/subpath]@<40-character commit SHA>, never a tag, a branch, a local path or an image',
        },
      ])
    })
  })
})
