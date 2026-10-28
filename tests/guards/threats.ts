import type { TextFile, Violation } from './types.ts'

export interface ThreatGuard {
  readonly file: string
  readonly test: string
}

export interface GuardedThreat {
  readonly id: string
  readonly area: string
  readonly threat: string
  readonly mitigation: string
  readonly guards: readonly ThreatGuard[]
}

export interface AcceptedThreat {
  readonly id: string
  readonly area: string
  readonly threat: string
  readonly accepted: string
}

export type Threat = GuardedThreat | AcceptedThreat

export interface ThreatsInput {
  threats: readonly Threat[]
  retired: readonly string[]
  files: readonly TextFile[]
}

const ID = /^T-\d{2,3}$/

const quoted = (title: string) =>
  [`'${title}'`, `"${title}"`, `\`${title}\``].map((form) => form.replaceAll('\n', ''))

const CALL = /\b(?:it|test|describe)(?:\.(?:only|concurrent|sequential))?$/

function titled(text: string, title: string): boolean {
  return quoted(title).some((form) => {
    let at = text.indexOf(form)
    while (at !== -1) {
      const before = text.slice(0, at).trimEnd()
      const head = before.slice(0, -1).trimEnd()
      if (
        before.endsWith('(') &&
        (CALL.test(head) ||
          (head.endsWith(')') && /\.each\b/.test(text.slice(Math.max(0, at - 20_000), at))))
      ) {
        return true
      }
      at = text.indexOf(form, at + 1)
    }
    return false
  })
}

export function checkThreats(input: ThreatsInput): Violation[] {
  const violations: Violation[] = []
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `threats/${rule}`, file: 'tests/security/threats.ts', message })
  }
  const files = new Map(input.files.map((file) => [file.path, file.text]))
  const seen = new Set<string>(input.retired)
  for (const threat of input.threats) {
    if (!ID.test(threat.id))
      report('id', `${threat.id} is no id of a threat: T- and two or three digits`)
    if (seen.has(threat.id)) {
      report(
        'id',
        input.retired.includes(threat.id)
          ? `${threat.id} is retired: a new threat takes a new id`
          : `${threat.id} names two threats`,
      )
    }
    seen.add(threat.id)
    if ('accepted' in threat) {
      if (threat.accepted.trim() === '') {
        report('accepted', `${threat.id} is accepted without saying why`)
      }
      continue
    }
    if (threat.guards.length === 0) {
      report('unguarded', `${threat.id} names no test that fails when its mitigation goes`)
    }
    for (const guard of threat.guards) {
      const text = files.get(guard.file)
      if (text === undefined) {
        report(
          'missing-file',
          `${threat.id} cites ${guard.file}, which is no file of the repository`,
        )
      } else if (!titled(text, guard.test)) {
        report(
          'missing-test',
          `${threat.id} cites "${guard.test}" in ${guard.file}, which has no test of that title`,
        )
      }
    }
  }
  return violations
}
