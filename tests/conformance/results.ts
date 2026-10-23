import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import {
  ANY_SCENARIO,
  splitCheck,
  type Baseline,
  type ProfileEntry,
} from '../guards/conformance-baselines.ts'
import { isRecord } from '../support/values.ts'

export type Status = 'SUCCESS' | 'FAILURE' | 'WARNING' | 'SKIPPED' | 'INFO'

export interface CheckResult {
  readonly id: string
  readonly status: Status
  readonly errorMessage: string | undefined
}

export interface ScenarioResult {
  readonly scenario: string
  readonly checks: readonly CheckResult[]
}

const STATUSES: readonly string[] = ['SUCCESS', 'FAILURE', 'WARNING', 'SKIPPED', 'INFO']

function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && STATUSES.includes(value)
}

const RESULT_DIRECTORY = /^server-(.+)-\d{4}-\d{2}-\d{2}T[\d-]+Z$/

export function readScenarioResults(directory: string): ScenarioResult[] {
  const scenarios: ScenarioResult[] = []
  for (const name of readdirSync(directory).sort()) {
    const scenario = RESULT_DIRECTORY.exec(name)?.[1]
    if (scenario === undefined) continue
    const parsed: unknown = JSON.parse(readFileSync(join(directory, name, 'checks.json'), 'utf8'))
    if (!Array.isArray(parsed)) throw new Error(`${name}/checks.json is not a list of checks`)
    const items: readonly unknown[] = parsed
    const checks: CheckResult[] = []
    for (const item of items) {
      if (!isRecord(item) || typeof item.id !== 'string' || !isStatus(item.status)) {
        throw new Error(`${name}/checks.json holds something that is not a check`)
      }
      checks.push({
        id: item.id,
        status: item.status,
        errorMessage: typeof item.errorMessage === 'string' ? item.errorMessage : undefined,
      })
    }
    scenarios.push({ scenario, checks })
  }
  return scenarios
}

export function readScoredScenarios(requirementsFile: string): ReadonlySet<string> {
  const document: unknown = parse(readFileSync(requirementsFile, 'utf8'))
  const server: unknown = isRecord(document) ? document.server : undefined
  if (!Array.isArray(server)) throw new Error(`${requirementsFile} has no list of server scenarios`)
  const names: string[] = []
  const items: readonly unknown[] = server
  for (const name of items) {
    if (typeof name !== 'string')
      throw new Error(`${requirementsFile} lists a scenario that is not a name`)
    names.push(name)
  }
  return new Set(names)
}

const SEVERITY: Readonly<Record<Status, number>> = {
  FAILURE: 3,
  WARNING: 2,
  SUCCESS: 1,
  SKIPPED: 0,
  INFO: 0,
}

export function verdicts(checks: readonly CheckResult[]): Map<string, CheckResult> {
  const found = new Map<string, CheckResult>()
  for (const check of checks) {
    if (check.status === 'INFO') continue
    const before = found.get(check.id)
    if (before === undefined || SEVERITY[check.status] >= SEVERITY[before.status]) {
      found.set(check.id, check)
    }
  }
  return found
}

export function isFailing(status: Status): boolean {
  return status === 'FAILURE' || status === 'WARNING'
}

function why(check: CheckResult): string {
  return check.errorMessage === undefined
    ? ''
    : `: ${check.errorMessage.replace(/\s+/g, ' ').slice(0, 160)}`
}

export function evaluateProfile(
  entries: readonly ProfileEntry[],
  scenarios: readonly ScenarioResult[],
): { problems: string[]; passed: number } {
  const problems: string[] = []
  let passed = 0
  const verdictsOf = new Map(scenarios.map((result) => [result.scenario, verdicts(result.checks)]))
  for (const entry of entries) {
    const claim = `claim "${entry.claim}"`
    if (entry.scenario === ANY_SCENARIO) {
      for (const id of entry.checks ?? []) {
        let reported = 0
        for (const [scenario, verdict] of verdictsOf) {
          const check = verdict.get(id)
          if (check === undefined) continue
          reported += 1
          if (check.status === 'SUCCESS') {
            passed += 1
          } else {
            problems.push(
              `${scenario}:${id} is ${check.status}, in the must-pass profile (${claim})${why(check)}`,
            )
          }
        }
        if (reported === 0) {
          problems.push(
            `no scenario reported ${id}, which the must-pass profile requires (${claim})`,
          )
        }
      }
      continue
    }
    const verdict = verdictsOf.get(entry.scenario)
    if (verdict === undefined) {
      problems.push(
        `the scenario ${entry.scenario} did not run, and the must-pass profile requires it (${claim})`,
      )
      continue
    }
    const ids = entry.checks ?? [...verdict.keys()]
    if (ids.length === 0) {
      problems.push(
        `the scenario ${entry.scenario} reported no check, and the must-pass profile requires it (${claim})`,
      )
    }
    for (const id of ids) {
      const check = verdict.get(id)
      if (check === undefined) {
        problems.push(
          `${entry.scenario}:${id} was not reported, and the must-pass profile requires it (${claim})`,
        )
      } else if (check.status === 'SUCCESS') {
        passed += 1
      } else {
        problems.push(
          `${entry.scenario}:${id} is ${check.status}, in the must-pass profile (${claim})${why(check)}`,
        )
      }
    }
  }
  return { problems, passed }
}

export function evaluateBaseline(
  baseline: Baseline,
  scenarios: readonly ScenarioResult[],
  scored: ReadonlySet<string>,
): { unexpected: string[]; excusesNothing: string[] } {
  const verdictsOf = new Map(scenarios.map((result) => [result.scenario, verdicts(result.checks)]))
  const listed = new Set(baseline.entries.map((entry) => entry.check))
  const excusesNothing: string[] = []
  for (const { check } of baseline.entries) {
    const { scenario, id } = splitCheck(check)
    const verdict = verdictsOf.get(scenario)
    const result = id === undefined ? undefined : verdict?.get(id)
    if (!scored.has(scenario)) {
      excusesNothing.push(
        `${check}: the scenario is not scored for ${baseline.revision}, so the suite never judges it: remove the entry`,
      )
    } else if (verdict === undefined) {
      excusesNothing.push(`${check}: the scenario did not run: remove the entry, or fix the run`)
    } else if (result === undefined) {
      excusesNothing.push(
        `${check}: the suite does not report this check: remove the entry, or fix its id`,
      )
    } else if (!isFailing(result.status)) {
      excusesNothing.push(`${check}: the check is ${result.status}, not failing: remove the entry`)
    }
  }
  const unexpected: string[] = []
  for (const [scenario, verdict] of verdictsOf) {
    if (!scored.has(scenario)) continue
    for (const [id, check] of verdict) {
      if (isFailing(check.status) && !listed.has(`${scenario}:${id}`)) {
        unexpected.push(`${scenario}:${id} is ${check.status}${why(check)}`)
      }
    }
  }
  return { unexpected, excusesNothing }
}

export interface Summary {
  readonly scored: { readonly scenarios: number; readonly passed: number; readonly failing: number }
  readonly baselined: Readonly<Record<string, number>>
  readonly notScored: {
    readonly scenarios: number
    readonly passed: number
    readonly failing: number
  }
}

export function summarize(
  baseline: Baseline,
  scenarios: readonly ScenarioResult[],
  scored: ReadonlySet<string>,
): Summary {
  const count = (keep: (scenario: string) => boolean) => {
    let selected = 0
    let passed = 0
    let failing = 0
    for (const result of scenarios) {
      if (!keep(result.scenario)) continue
      selected += 1
      for (const check of verdicts(result.checks).values()) {
        if (check.status === 'SUCCESS') passed += 1
        else if (isFailing(check.status)) failing += 1
      }
    }
    return { scenarios: selected, passed, failing }
  }
  const baselined: Record<string, number> = {}
  for (const entry of baseline.entries) baselined[entry.class] = (baselined[entry.class] ?? 0) + 1
  return {
    scored: count((scenario) => scored.has(scenario)),
    baselined,
    notScored: count((scenario) => !scored.has(scenario)),
  }
}
