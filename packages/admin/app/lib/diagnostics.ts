import type { schemas } from '@hollware/core'
import type * as z from 'zod'

type Violation = z.output<typeof schemas.violation>
type Verdict = z.output<typeof schemas.verdict>

export interface Diagnostic {
  readonly from: number
  readonly to: number
  readonly severity: 'error' | 'warning'
  readonly message: string
  readonly source: string
}

function lineStarts(text: string): number[] {
  const starts = [0]
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\n') starts.push(index + 1)
  }
  return starts
}

function frontmatterLine(text: string, path: string): number | null {
  const match = /^\/frontmatter\/([^/]+)/.exec(path)
  if (match === null) return null
  const field = match[1]?.replace(/~1/g, '/').replace(/~0/g, '~')
  const lines = text.split('\n')
  if (lines[0]?.trimEnd() !== '---') return null
  for (let index = 1; index < lines.length; index++) {
    const line = lines[index] ?? ''
    if (line.trimEnd() === '---') return null
    if (line.startsWith(`${field}:`)) return index + 1
  }
  return null
}

function rangeOf(
  text: string,
  starts: readonly number[],
  line: number,
): { from: number; to: number } {
  const index = Math.min(Math.max(line, 1), starts.length) - 1
  const from = starts[index] ?? 0
  const next = starts[index + 1]
  const to = next === undefined ? text.length : Math.max(from, next - 1)
  return { from, to }
}

export function diagnosticsOf(text: string, verdict: Verdict): Diagnostic[] {
  const starts = lineStarts(text)
  const one = (violation: Violation): Diagnostic => {
    const line = violation.line ?? frontmatterLine(text, violation.path) ?? 1
    return {
      ...rangeOf(text, starts, line),
      severity: violation.severity,
      message: `${violation.message} ${violation.fix}`,
      source: violation.contract,
    }
  }
  return [...verdict.errors.map(one), ...verdict.warnings.map(one)]
}
