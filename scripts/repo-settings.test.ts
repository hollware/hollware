import { describe, expect, it } from 'vite-plus/test'

import { readSettings, settingsDrift, type RepoSettings } from './repo-settings.ts'

const ANSWERS: Record<string, unknown> = {
  'repos/o/r/rulesets': [{ id: 1 }],
  'repos/o/r/rulesets/1': {
    name: 'release',
    target: 'branch',
    enforcement: 'active',
    conditions: { ref_name: { include: ['refs/heads/release'], exclude: [] } },
    bypass_actors: [],
    rules: [
      { type: 'deletion', parameters: null },
      { type: 'non_fast_forward', parameters: null },
      {
        type: 'required_status_checks',
        parameters: { required_status_checks: [{ context: 'Check', integration_id: 15368 }] },
      },
    ],
  },
  'repos/o/r/environments': {
    environments: [
      {
        name: 'npm',
        deployment_branch_policy: { custom_branch_policies: true },
        protection_rules: [{ type: 'branch_policy' }],
      },
      {
        name: 'preview',
        deployment_branch_policy: null,
        protection_rules: [
          { type: 'wait_timer', wait_timer: 5 },
          { type: 'required_reviewers', reviewers: [{ type: 'User' }, { type: 'Team' }] },
        ],
      },
    ],
  },
  'repos/o/r/environments/npm/deployment-branch-policies': {
    branch_policies: [
      { name: 'release', type: 'branch' },
      { name: 'v*', type: 'tag' },
    ],
  },
}

const api = (path: string) => {
  if (!(path in ANSWERS)) throw new Error(`no answer for ${path}`)
  return ANSWERS[path]
}

const EXPECTED: RepoSettings = {
  rulesets: [
    {
      name: 'release',
      target: 'branch',
      enforcement: 'active',
      include: ['refs/heads/release'],
      exclude: [],
      bypass: 0,
      rules: ['deletion', 'non_fast_forward', 'required_status_checks'],
      requiredChecks: ['Check'],
    },
  ],
  environments: [
    { name: 'npm', branches: ['release'], reviewers: 0 },
    { name: 'preview', branches: null, reviewers: 2 },
  ],
}

describe('the settings of the repository', () => {
  it('reads them from GitHub in the shape of .github/settings.json', () => {
    expect(readSettings('o/r', api)).toEqual(EXPECTED)
  })

  it('find no drift when they match', () => {
    expect(settingsDrift(EXPECTED, readSettings('o/r', api))).toEqual([])
  })

  it('report a ruleset loosened, one gone, one added, and an environment that takes more', () => {
    const [release] = EXPECTED.rulesets
    if (release === undefined) throw new Error('no ruleset')
    const actual: RepoSettings = {
      rulesets: [
        { ...release, rules: ['deletion'], bypass: 1, include: ['refs/heads/*'] },
        { ...release, name: 'extra' },
      ],
      environments: [
        { name: 'npm', branches: ['release', 'main'], reviewers: 0 },
        { name: 'preview', branches: null, reviewers: 2 },
      ],
    }
    const expected: RepoSettings = {
      ...EXPECTED,
      rulesets: [...EXPECTED.rulesets, { ...release, name: 'tags' }],
    }

    expect(settingsDrift(expected, actual)).toEqual([
      'the ruleset "release" has bypass 1, not 0',
      'the ruleset "release" has include ["refs/heads/*"], not ["refs/heads/release"]',
      'the ruleset "release" has rules ["deletion"], not ["deletion","non_fast_forward","required_status_checks"]',
      'the ruleset "tags" is gone',
      'the ruleset "extra" is not in .github/settings.json',
      'the environment "npm" takes ["main","release"], not ["release"]',
    ])
  })

  it('report an environment that now takes every branch', () => {
    expect(
      settingsDrift(EXPECTED, {
        ...EXPECTED,
        environments: [
          { name: 'npm', branches: null, reviewers: 0 },
          EXPECTED.environments[1] ?? { name: 'preview', branches: null, reviewers: 2 },
        ],
      }),
    ).toEqual(['the environment "npm" takes every branch, not ["release"]'])
  })

  it('report an approval added to an environment that publishes on its own', () => {
    expect(
      settingsDrift(EXPECTED, {
        ...EXPECTED,
        environments: [
          { name: 'npm', branches: ['release'], reviewers: 1 },
          EXPECTED.environments[1] ?? { name: 'preview', branches: null, reviewers: 2 },
        ],
      }),
    ).toEqual(['the environment "npm" waits for 1 required reviewers, not 0'])
  })
})
