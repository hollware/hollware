import { isMap, isScalar, isSeq, plain, readYaml, scalarString } from '../support/yaml.ts'
import { isRecord, parseJson } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `pnpm-policy`: the supply-chain policy of `pnpm-workspace.yaml` stays what ADR-010
 * and `AGENTS.md` say it is.
 *
 * - `minimumReleaseAge` is at least 1440 minutes (24 hours) and `trustPolicy` is
 *   `no-downgrade`.
 * - Every `allowBuilds` entry carries a trailing `# reason`.
 * - Every `minimumReleaseAgeExclude` and `trustPolicyExclude` entry is one exact `name@version`
 *   with a trailing `# reason; expires YYYY-MM-DD` comment whose date has not passed.
 * - Every catalog version is exact: no `^`, `~`, `*` or range, `npm:` aliases included. The
 *   keys stay sorted, as the file says.
 * - The root `packageManager` pins pnpm with its `sha512` hash.
 */

export interface PnpmPolicyInput {
  workspace: TextFile
  /** The root `package.json`. */
  rootManifest: TextFile
  /** Today, as `YYYY-MM-DD`. Injected so the guard stays pure. */
  today: string
}

export const MINIMUM_RELEASE_AGE = 1440

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const NPM_ALIAS = /^npm:(?:@[^/@]+\/)?[^/@]+@(.+)$/
const EXACT_PACKAGE_VERSION = /^(?:@[^/@]+\/)?[^/@\s]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/
const PACKAGE_MANAGER = /^pnpm@\d+\.\d+\.\d+\+sha512\.[0-9a-f]{128}$/

/** Whether a catalog value is an exact version, or an `npm:` alias of one. */
export function isExactCatalogVersion(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const alias = NPM_ALIAS.exec(value)
  return EXACT_VERSION.test(alias?.[1] ?? value)
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

export function checkPnpmPolicy(input: PnpmPolicyInput): Violation[] {
  const violations: Violation[] = []
  const file = input.workspace.path
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `pnpm-policy/${rule}`, file, message })
  }

  const yaml = readYaml(input.workspace.text)
  for (const error of yaml.errors) report('invalid-yaml', `${file} is not valid YAML: ${error}`)
  const { doc } = yaml

  const age = doc.get('minimumReleaseAge')
  if (typeof age !== 'number' || age < MINIMUM_RELEASE_AGE) {
    report(
      'minimum-release-age',
      `"minimumReleaseAge" must be at least ${MINIMUM_RELEASE_AGE} (24 hours), found ${JSON.stringify(age)}; never lower it, use a minimumReleaseAgeExclude entry for an urgent fix`,
    )
  }
  if (doc.get('trustPolicy') !== 'no-downgrade') {
    report(
      'trust-policy',
      `"trustPolicy" must be "no-downgrade", found ${JSON.stringify(doc.get('trustPolicy'))}`,
    )
  }

  const allowBuilds = doc.get('allowBuilds', true)
  if (isMap(allowBuilds)) {
    for (const pair of allowBuilds.items) {
      const name = scalarString(pair.key) ?? '?'
      const comment = isScalar(pair.value) ? yaml.trailingComment(pair.value) : undefined
      if (comment === undefined || comment === '') {
        report(
          'allow-builds-reason',
          `allowBuilds.${name} has no trailing "# reason": say why its build script may run, or why it must not`,
        )
      }
    }
  }

  // Each exception to a policy is one exact version, with why and until when.
  for (const [key, policy] of [
    ['minimumReleaseAgeExclude', 'minimumReleaseAge'],
    ['trustPolicyExclude', 'trustPolicy'],
  ] as const) {
    const exclude = doc.get(key, true)
    if (isSeq(exclude)) {
      for (const item of exclude.items) {
        const entry = scalarString(item) ?? JSON.stringify(plain(item))
        if (!EXACT_PACKAGE_VERSION.test(entry)) {
          report(
            'exclude-entry',
            `${key} entry ${entry} must be one exact name@version, never a range or a pattern`,
          )
        }
        const comment = isScalar(item) ? (yaml.trailingComment(item) ?? '') : ''
        const expires = /\bexpires (\d{4}-\d{2}-\d{2})\b/.exec(comment)?.[1]
        const reason = comment
          .replace(/\bexpires \d{4}-\d{2}-\d{2}\b/, '')
          .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, '')
        if (reason === '') {
          report(
            'exclude-reason',
            `${key} entry ${entry} needs a trailing "# <reason>; expires YYYY-MM-DD" comment with a reason`,
          )
        }
        if (expires === undefined || !isCalendarDate(expires)) {
          report(
            'exclude-expiry',
            `${key} entry ${entry} needs "expires YYYY-MM-DD" with a real date in its trailing comment`,
          )
        } else if (expires < input.today) {
          report(
            'exclude-expired',
            `${key} entry ${entry} expired on ${expires}: remove it and let ${policy} apply`,
          )
        }
      }
    } else if (exclude !== undefined && exclude !== null) {
      report('exclude-entry', `${key} must be a list`)
    }
  }

  const catalogs: { label: string; node: unknown }[] = [
    { label: 'catalog', node: doc.get('catalog', true) },
  ]
  const named = doc.get('catalogs', true)
  if (isMap(named)) {
    for (const pair of named.items) {
      catalogs.push({ label: `catalogs.${scalarString(pair.key) ?? '?'}`, node: pair.value })
    }
  }
  for (const { label, node } of catalogs) {
    if (!isMap(node)) continue
    const names: string[] = []
    for (const pair of node.items) {
      const name = scalarString(pair.key) ?? '?'
      const value = plain(pair.value)
      names.push(name)
      if (!isExactCatalogVersion(value)) {
        report(
          'catalog-version',
          `${label}.${name} is ${JSON.stringify(value)}: catalog versions are exact (no ^, ~, * or range)`,
        )
      }
    }
    const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    if (names.some((name, index) => name !== sorted[index])) {
      report('catalog-unsorted', `${label} must stay sorted: expected ${sorted.join(', ')}`)
    }
  }

  const root = parseJson(input.rootManifest.text)
  const packageManager = root.ok && isRecord(root.value) ? root.value.packageManager : undefined
  if (typeof packageManager !== 'string' || !PACKAGE_MANAGER.test(packageManager)) {
    violations.push({
      rule: 'pnpm-policy/package-manager',
      file: input.rootManifest.path,
      message: `"packageManager" must pin pnpm with its hash, "pnpm@<version>+sha512.<128 hex digits>", found ${JSON.stringify(packageManager)}`,
    })
  }
  return violations
}
