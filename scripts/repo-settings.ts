/**
 * Whether the settings of the repository on GitHub are still those of `.github/settings.json`
 * (T-91 of docs/security/threat-model.md): its rulesets (the branches and tags no one may delete or
 * force-push, and the check `release` needs) and the branches each environment takes (only
 * `release` may publish to npm). Nothing in a workflow sets them, so they can only drift by hand;
 * the weekly job of security.yml runs this, with a token that reads them.
 *
 *   node scripts/repo-settings.ts
 *
 * It exits 1 and lists every difference when they drift, and 0 when they match.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export interface RulesetSettings {
  readonly name: string
  readonly target: string
  readonly enforcement: string
  readonly include: readonly string[]
  readonly exclude: readonly string[]
  /** How many actors may bypass it: none, for every ruleset of this repository. */
  readonly bypass: number
  readonly rules: readonly string[]
  readonly requiredChecks: readonly string[]
}

export interface EnvironmentSettings {
  readonly name: string
  /** The branches its deployment policy takes; `null` when it takes every branch. */
  readonly branches: readonly string[] | null
}

export interface RepoSettings {
  readonly rulesets: readonly RulesetSettings[]
  readonly environments: readonly EnvironmentSettings[]
}

const sorted = (values: readonly string[]) => [...values].sort()
const same = (a: readonly string[] | null, b: readonly string[] | null) =>
  JSON.stringify(a === null ? null : sorted(a)) === JSON.stringify(b === null ? null : sorted(b))

/** Every way `actual` differs from `expected`, one sentence each; none when they match. */
export function settingsDrift(expected: RepoSettings, actual: RepoSettings): string[] {
  const drift: string[] = []
  for (const want of expected.rulesets) {
    const have = actual.rulesets.find((ruleset) => ruleset.name === want.name)
    if (have === undefined) {
      drift.push(`the ruleset "${want.name}" is gone`)
      continue
    }
    const fields = ['target', 'enforcement', 'bypass'] as const
    for (const field of fields) {
      if (have[field] !== want[field]) {
        drift.push(
          `the ruleset "${want.name}" has ${field} ${JSON.stringify(have[field])}, not ${JSON.stringify(want[field])}`,
        )
      }
    }
    const lists = ['include', 'exclude', 'rules', 'requiredChecks'] as const
    for (const field of lists) {
      if (!same(have[field], want[field])) {
        drift.push(
          `the ruleset "${want.name}" has ${field} ${JSON.stringify(sorted(have[field]))}, not ${JSON.stringify(sorted(want[field]))}`,
        )
      }
    }
  }
  for (const have of actual.rulesets) {
    if (!expected.rulesets.some((ruleset) => ruleset.name === have.name)) {
      drift.push(`the ruleset "${have.name}" is not in .github/settings.json`)
    }
  }
  for (const want of expected.environments) {
    const have = actual.environments.find((environment) => environment.name === want.name)
    if (have === undefined) {
      drift.push(`the environment "${want.name}" is gone`)
    } else if (!same(have.branches, want.branches)) {
      drift.push(
        `the environment "${want.name}" takes ${have.branches === null ? 'every branch' : JSON.stringify(sorted(have.branches))}, not ${want.branches === null ? 'every branch' : JSON.stringify(sorted(want.branches))}`,
      )
    }
  }
  return drift
}

/** One call of the GitHub API through `gh`, which reads its token from `GH_TOKEN`. */
type Api = (path: string) => unknown

const gh: Api = (path) =>
  JSON.parse(
    execFileSync('gh', ['api', path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }),
  )

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {}
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** The settings of a repository as GitHub answers them, in the shape of `.github/settings.json`. */
export function readSettings(repository: string, api: Api): RepoSettings {
  const rulesets = list(api(`repos/${repository}/rulesets`)).map((summary) => {
    const ruleset = record(api(`repos/${repository}/rulesets/${String(record(summary)['id'])}`))
    const refName = record(record(ruleset['conditions'])['ref_name'])
    const rules = list(ruleset['rules']).map(record)
    const checks = rules
      .filter((rule) => rule['type'] === 'required_status_checks')
      .flatMap((rule) => list(record(rule['parameters'])['required_status_checks']))
      .map((check) => String(record(check)['context']))
    return {
      name: String(ruleset['name']),
      target: String(ruleset['target']),
      enforcement: String(ruleset['enforcement']),
      include: strings(refName['include']),
      exclude: strings(refName['exclude']),
      bypass: list(ruleset['bypass_actors']).length,
      rules: rules.map((rule) => String(rule['type'])),
      requiredChecks: checks,
    }
  })
  const environments = list(record(api(`repos/${repository}/environments`))['environments'])
    .map(record)
    .map((environment) => {
      const name = String(environment['name'])
      const policy = record(environment['deployment_branch_policy'])
      if (
        environment['deployment_branch_policy'] === null ||
        policy['custom_branch_policies'] !== true
      ) {
        return { name, branches: null }
      }
      const branches = list(
        record(api(`repos/${repository}/environments/${name}/deployment-branch-policies`))[
          'branch_policies'
        ],
      )
        .map(record)
        .filter((branch) => branch['type'] === 'branch')
        .map((branch) => String(branch['name']))
      return { name, branches }
    })
  return { rulesets, environments }
}

export function main(root: string, api: Api = gh): number {
  const expected: RepoSettings = JSON.parse(
    readFileSync(resolve(root, '.github/settings.json'), 'utf8'),
  )
  const drift = settingsDrift(expected, readSettings('hollware/hollware', api))
  for (const line of drift) console.error(`repo-settings: ${line}`)
  if (drift.length === 0) console.log('repo-settings: GitHub matches .github/settings.json')
  return drift.length === 0 ? 0 : 1
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  process.exit(main(resolve(import.meta.dirname, '..')))
}
