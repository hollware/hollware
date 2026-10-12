import { inlineCodeSpans, sectionLines } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `guards-registry`: the `## Guards` section of the root `AGENTS.md` is the registry of
 * what each guard binds. Every file under `tests/conventions/` and `tests/meta/` is cited
 * there, once, on a line that says what it binds, and no line cites a file that does not
 * exist. An agent that opens the registry learns what is enforced and where, and a guard
 * nobody can find is a guard nobody keeps.
 */

export interface GuardsRegistryInput {
  /** The root `AGENTS.md`. */
  agents: TextFile
  /** Every file under `tests/conventions/` and `tests/meta/`, repository-relative. */
  guardFiles: readonly string[]
}

/** The least number of words a registry line spends on what its guard binds. */
export const MIN_DESCRIPTION_WORDS = 4

const GUARD_PATH = /^tests\/(?:conventions|meta)\/[\w.-]+$/

export function checkGuardsRegistry(input: GuardsRegistryInput): Violation[] {
  const violations: Violation[] = []
  const file = input.agents.path
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `guards-registry/${rule}`, file, message })
  }

  const section = sectionLines(input.agents.text, 'Guards')
  if (section.length === 0) {
    report(
      'section-missing',
      'AGENTS.md has no "## Guards" section: it lists what each guard binds',
    )
    return violations
  }

  const cited = new Map<string, number>()
  for (const { line, number } of section) {
    if (!line.startsWith('- ')) continue
    for (const span of inlineCodeSpans(line)) {
      if (!GUARD_PATH.test(span.text)) continue
      if (cited.has(span.text)) {
        report('duplicate', `line ${number} cites ${span.text} again: each guard file has one line`)
      }
      cited.set(span.text, number)
      if (!input.guardFiles.includes(span.text)) {
        report(
          'missing-file',
          `line ${number} cites ${span.text}, which does not exist: fix the path or remove the line`,
        )
      }
      const description = line.replace(/`[^`]*`/g, '').replace(/^[-\s:,.;]+/, '')
      if (
        description.split(/\s+/).filter((word) => /\w/.test(word)).length < MIN_DESCRIPTION_WORDS
      ) {
        report(
          'no-description',
          `line ${number} cites ${span.text} without saying what it binds: write at least ${MIN_DESCRIPTION_WORDS} words after the path`,
        )
      }
    }
  }
  for (const path of input.guardFiles) {
    if (!cited.has(path)) {
      report(
        'uncited',
        `${path} is not cited in the "## Guards" section: add one line saying what it binds`,
      )
    }
  }
  return violations
}
