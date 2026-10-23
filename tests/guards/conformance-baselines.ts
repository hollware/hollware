import { parseDocument } from 'yaml'
import { isRecord } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

export const CONFORMANCE_REVISIONS = ['2026-07-28', '2025-11-25'] as const

export const BASELINE_CLASSES = ['not-offered', 'fixture', 'upstream'] as const

export type BaselineClass = (typeof BASELINE_CLASSES)[number]

export const ANY_SCENARIO = '*'

export const MIN_REASON_LENGTH = 20

const UPSTREAM_ISSUE =
  /https:\/\/github\.com\/modelcontextprotocol\/conformance\/(?:issues|pull)\/\d+/

const BASELINE_PATH = /^tests\/conformance\/baselines\/(\d{4}-\d{2}-\d{2})\.yaml$/

export interface BaselineEntry {
  readonly check: string
  readonly class: BaselineClass
  readonly reason: string
}

export interface Baseline {
  readonly revision: string
  readonly recordedSize: number
  readonly entries: readonly BaselineEntry[]
}

export interface ProfileEntry {
  readonly claim: string
  readonly revisions: readonly string[]
  readonly scenario: string
  readonly checks: readonly string[] | undefined
}

export interface ConformanceBaselinesInput {
  baselines: readonly TextFile[]
  profile: TextFile
  revisions: readonly string[]
  requiredClaims: Readonly<Record<string, readonly string[]>>
}

export function splitCheck(check: string): { scenario: string; id: string | undefined } {
  const colon = check.indexOf(':')
  if (colon === -1) return { scenario: check, id: undefined }
  return { scenario: check.slice(0, colon), id: check.slice(colon + 1) }
}

export function profileCovers(
  entry: ProfileEntry,
  revision: string,
  scenario: string,
  id: string | undefined,
): boolean {
  if (!entry.revisions.includes(revision)) return false
  if (entry.scenario !== ANY_SCENARIO && entry.scenario !== scenario) return false
  if (entry.checks === undefined || id === undefined) return true
  return entry.checks.includes(id)
}

function isClass(value: unknown): value is BaselineClass {
  return BASELINE_CLASSES.some((name) => name === value)
}

function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value)
}

function reporter(file: TextFile, violations: Violation[]) {
  return (rule: string, message: string): void => {
    violations.push({ rule: `conformance-baselines/${rule}`, file: file.path, message })
  }
}

function readMapping(
  file: TextFile,
  rule: string,
  violations: Violation[],
): Record<string, unknown> | undefined {
  const report = reporter(file, violations)
  const document = parseDocument(file.text)
  const [first] = document.errors
  if (first !== undefined) {
    report(rule, `the file is not valid YAML: ${first.message.split('\n')[0] ?? first.message}`)
    return undefined
  }
  const value: unknown = document.toJS()
  if (!isRecord(value)) {
    report(rule, 'the file must hold a mapping at its top level')
    return undefined
  }
  return value
}

function reportUnknownKeys(
  report: (rule: string, message: string) => void,
  rule: string,
  record: Record<string, unknown>,
  known: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(record)) {
    if (known.includes(key)) continue
    report(
      rule,
      `${where} has the key "${key}", which nothing reads: the keys are ${known.join(', ')}`,
    )
  }
}

interface BaselineReading {
  readonly revision: string | undefined
  readonly recordedSize: number | undefined
  readonly checks: readonly string[]
  readonly entries: readonly BaselineEntry[]
  readonly violations: Violation[]
}

function readBaseline(file: TextFile): BaselineReading {
  const violations: Violation[] = []
  const report = reporter(file, violations)
  const empty: BaselineReading = {
    revision: undefined,
    recordedSize: undefined,
    checks: [],
    entries: [],
    violations,
  }
  const root = readMapping(file, 'invalid-file', violations)
  if (root === undefined) return empty
  reportUnknownKeys(
    report,
    'invalid-file',
    root,
    ['revision', 'recordedSize', 'entries'],
    'the file',
  )

  const revision = typeof root.revision === 'string' ? root.revision : undefined
  const named = BASELINE_PATH.exec(file.path)?.[1]
  if (revision === undefined) {
    report('revision', 'the file has no "revision": name the specification revision it covers')
  } else if (named !== undefined && revision !== named) {
    report('revision', `the file is named for ${named} but says "revision: ${revision}"`)
  }

  const size = root.recordedSize
  const recordedSize =
    typeof size === 'number' && Number.isInteger(size) && size >= 0 ? size : undefined
  if (recordedSize === undefined) {
    report('invalid-file', '"recordedSize" must be the number of entries, a whole number from 0 up')
  }

  const items = root.entries
  if (!isList(items)) {
    report('invalid-file', '"entries" must be a list')
    return { ...empty, revision, recordedSize }
  }
  const checks: string[] = []
  const entries: BaselineEntry[] = []
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const where = `entry ${index + 1}`
    if (!isRecord(item)) {
      report('entry-shape', `${where} must be a mapping with a check, a class and a reason`)
      return
    }
    reportUnknownKeys(report, 'entry-shape', item, ['check', 'class', 'reason'], where)
    const check = typeof item.check === 'string' ? item.check.trim() : ''
    if (check === '') {
      report('no-check', `${where} names no check: write "<scenario>:<check id>"`)
      return
    }
    checks.push(check)
    const { scenario, id } = splitCheck(check)
    if (scenario === '' || id === undefined || id === '') {
      report(
        'whole-scenario',
        `entry "${check}" does not name one check: write "<scenario>:<check id>", because an entry for a whole scenario excuses every check in it`,
      )
    }
    if (seen.has(check)) report('duplicate', `entry "${check}" is listed twice`)
    seen.add(check)

    const kind: unknown = item.class
    if (kind === undefined || kind === null || kind === '') {
      report(
        'no-class',
        `entry "${check}" has no class: say why it fails, with one of ${BASELINE_CLASSES.join(', ')}`,
      )
    } else if (!isClass(kind)) {
      report(
        'unknown-class',
        `entry "${check}" has the class ${JSON.stringify(kind)}: use one of ${BASELINE_CLASSES.join(', ')}`,
      )
    }
    const reason = typeof item.reason === 'string' ? item.reason.trim() : ''
    if (reason.length < MIN_REASON_LENGTH) {
      report(
        'no-reason',
        `entry "${check}" needs a reason of at least ${MIN_REASON_LENGTH} characters: say what makes the check fail and why that is expected`,
      )
    }
    if (kind === 'upstream' && !UPSTREAM_ISSUE.test(reason)) {
      report(
        'no-issue-link',
        `entry "${check}" is a defect of the suite, so its reason must link its issue in https://github.com/modelcontextprotocol/conformance/issues`,
      )
    }
    if (isClass(kind) && reason.length >= MIN_REASON_LENGTH)
      entries.push({ check, class: kind, reason })
  })
  return { revision, recordedSize, checks, entries, violations }
}

export function parseBaseline(file: TextFile): {
  baseline: Baseline | undefined
  violations: Violation[]
} {
  const reading = readBaseline(file)
  const { revision, recordedSize } = reading
  if (reading.violations.length > 0 || revision === undefined || recordedSize === undefined) {
    return { baseline: undefined, violations: reading.violations }
  }
  return {
    baseline: { revision, recordedSize, entries: reading.entries },
    violations: reading.violations,
  }
}

export function parseProfile(file: TextFile): { entries: ProfileEntry[]; violations: Violation[] } {
  const violations: Violation[] = []
  const report = reporter(file, violations)
  const entries: ProfileEntry[] = []
  const root = readMapping(file, 'invalid-profile', violations)
  if (root === undefined) return { entries, violations }
  reportUnknownKeys(report, 'invalid-profile', root, ['entries'], 'the file')
  const items = root.entries
  if (!isList(items)) {
    report('invalid-profile', '"entries" must be a list')
    return { entries, violations }
  }
  const seen = new Set<string>()
  items.forEach((item, index) => {
    const where = `profile entry ${index + 1}`
    if (!isRecord(item)) {
      report(
        'profile-entry',
        `${where} must be a mapping with a claim, revisions, a scenario and checks`,
      )
      return
    }
    reportUnknownKeys(
      report,
      'profile-entry',
      item,
      ['claim', 'revisions', 'scenario', 'checks'],
      where,
    )
    const claim = typeof item.claim === 'string' ? item.claim.trim() : ''
    if (claim === '') report('profile-entry', `${where} has no "claim": name what Hollware claims`)
    const scenario = typeof item.scenario === 'string' ? item.scenario.trim() : ''
    if (scenario === '') report('profile-entry', `${where} has no "scenario"`)

    const revisions: string[] = []
    const listed = item.revisions
    if (!isList(listed) || listed.length === 0) {
      report('profile-entry', `${where} must list the "revisions" it covers`)
    } else {
      for (const revision of listed) {
        if (
          typeof revision === 'string' &&
          CONFORMANCE_REVISIONS.some((known) => known === revision)
        ) {
          revisions.push(revision)
        } else {
          report(
            'profile-entry',
            `${where} lists the revision ${JSON.stringify(revision)}: use ${CONFORMANCE_REVISIONS.join(' or ')}`,
          )
        }
      }
    }

    let checks: string[] | undefined
    const named = item.checks
    if (named !== undefined) {
      const ids = isList(named)
        ? named.filter((id) => typeof id === 'string' && id.trim() !== '')
        : []
      if (!isList(named) || named.length === 0 || ids.length !== named.length) {
        report(
          'profile-entry',
          `${where} has "checks" that is not a list of check ids: leave it out to require every check of the scenario`,
        )
      } else {
        checks = ids.map((id) => String(id).trim())
        const repeated = checks.find((id, at) => checks?.indexOf(id) !== at)
        if (repeated !== undefined)
          report('profile-entry', `${where} lists the check "${repeated}" twice`)
      }
    } else if (scenario === ANY_SCENARIO) {
      report(
        'profile-entry',
        `${where} covers ${ANY_SCENARIO}, so it must name the "checks" that every scenario passes`,
      )
    }

    if (claim === '' || scenario === '' || revisions.length === 0) return
    const key = JSON.stringify([
      claim,
      scenario,
      [...revisions].sort(),
      checks === undefined ? null : [...checks].sort(),
    ])
    if (seen.has(key)) report('profile-entry', `${where} repeats an earlier entry`)
    seen.add(key)
    entries.push({ claim, revisions, scenario, checks })
  })
  return { entries, violations }
}

export function checkConformanceBaselines(input: ConformanceBaselinesInput): Violation[] {
  const violations: Violation[] = []
  const profile = parseProfile(input.profile)
  violations.push(...profile.violations)

  const byRevision = new Map<string, TextFile[]>()
  for (const file of input.baselines) {
    const revision = BASELINE_PATH.exec(file.path)?.[1]
    if (revision === undefined || !input.revisions.includes(revision)) {
      violations.push({
        rule: 'conformance-baselines/unknown-revision',
        file: file.path,
        message: `the file is not the baseline of a revision Hollware serves: name it tests/conformance/baselines/<revision>.yaml, with one of ${input.revisions.join(', ')}`,
      })
      continue
    }
    byRevision.set(revision, [...(byRevision.get(revision) ?? []), file])
  }

  for (const revision of input.revisions) {
    const files = byRevision.get(revision) ?? []
    if (files.length === 0) {
      violations.push({
        rule: 'conformance-baselines/missing-baseline',
        file: `tests/conformance/baselines/${revision}.yaml`,
        message: `there is no baseline for ${revision}: every revision has one file, which may hold no entries`,
      })
      continue
    }
    for (const file of files) {
      const reading = readBaseline(file)
      violations.push(...reading.violations)
      const report = reporter(file, violations)

      const size = reading.checks.length
      if (reading.recordedSize !== undefined && size > reading.recordedSize) {
        report(
          'over-size',
          `the baseline holds ${size} entries but recordedSize is ${reading.recordedSize}: a baseline only shrinks, so fix the cause instead of adding an entry`,
        )
      } else if (reading.recordedSize !== undefined && size < reading.recordedSize) {
        report(
          'slack',
          `the baseline holds ${size} entries but recordedSize is ${reading.recordedSize}: lower recordedSize to ${size}, or it leaves room to add an entry unnoticed`,
        )
      }

      for (const check of reading.checks) {
        const { scenario, id } = splitCheck(check)
        const covered = profile.entries.find((entry) =>
          profileCovers(entry, revision, scenario, id),
        )
        if (covered !== undefined) {
          report(
            'in-must-pass',
            `entry "${check}" excuses a check of the must-pass profile (claim "${covered.claim}"): a regression in what Hollware claims must fail the run, so fix Hollware instead of baselining it`,
          )
        }
      }
    }
  }

  for (const [revision, claims] of Object.entries(input.requiredClaims)) {
    for (const claim of claims) {
      const covered = profile.entries.some(
        (entry) => entry.claim === claim && entry.revisions.includes(revision),
      )
      if (!covered) {
        violations.push({
          rule: 'conformance-baselines/missing-claim',
          file: input.profile.path,
          message: `the must-pass profile has no check of the claim "${claim}" for ${revision}: deleting the last one would leave that claim unguarded`,
        })
      }
    }
  }
  return violations
}
