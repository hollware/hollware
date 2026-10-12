import { inlineCodeSpans, sectionLines } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `guards-registry`: the `## Guards` section of `tests/AGENTS.md` is the registry of what
 * each guard binds. Every file under `tests/conventions/` and `tests/meta/` is cited there, once,
 * on a line that says what it binds, and no line cites a file that does not exist. An agent that
 * opens the registry learns what is enforced and where, and a guard nobody can find is a guard
 * nobody keeps.
 *
 * The registry lives next to the tests because the root `AGENTS.md` has a size limit of its own.
 * The root keeps a `## Guards` section that points to it, so an agent that starts at the root
 * finds it, and that holds no registry line, so the two cannot drift apart.
 */

export interface GuardsRegistryInput {
  /** The `tests/AGENTS.md` that holds the registry. */
  registry: TextFile
  /** The root `AGENTS.md`, whose `## Guards` section points to the registry. */
  root: TextFile
  /** Every file under `tests/conventions/` and `tests/meta/`, repository-relative. */
  guardFiles: readonly string[]
}

/** The least number of words a registry line spends on what its guard binds. */
export const MIN_DESCRIPTION_WORDS = 4

const GUARD_PATH = /^tests\/(?:conventions|meta)\/[\w.-]+$/

/** The path the root `## Guards` section must cite. */
const REGISTRY_PATH = 'tests/AGENTS.md'

/** A line of the registry cites a test, whichever folder of `tests/` it sits in. */
const TEST_PATH = /^tests\/[\w./-]+$/

export function checkGuardsRegistry(input: GuardsRegistryInput): Violation[] {
  const violations: Violation[] = []
  const report = (file: string, rule: string, message: string): void => {
    violations.push({ rule: `guards-registry/${rule}`, file, message })
  }

  const rootSection = sectionLines(input.root.text, 'Guards')
  const points = rootSection.some(({ line }) =>
    inlineCodeSpans(line).some((span) => span.text === REGISTRY_PATH),
  )
  if (!points) {
    report(
      input.root.path,
      'no-pointer',
      `${input.root.path} has no "## Guards" section that cites \`${REGISTRY_PATH}\`: an agent that starts at the root finds the registry of what each guard binds there`,
    )
  }
  for (const { line, number } of rootSection) {
    const stray = line.startsWith('- ')
      ? inlineCodeSpans(line).find(
          (span) => TEST_PATH.test(span.text) && span.text !== REGISTRY_PATH,
        )
      : undefined
    if (stray !== undefined) {
      report(
        input.root.path,
        'stray-line',
        `line ${number} cites ${stray.text}: the registry lives in ${REGISTRY_PATH}, so this line belongs there`,
      )
    }
  }

  const file = input.registry.path
  const section = sectionLines(input.registry.text, 'Guards')
  if (section.length === 0) {
    report(
      file,
      'section-missing',
      `${file} has no "## Guards" section: it lists what each guard binds`,
    )
    return violations
  }

  const cited = new Map<string, number>()
  for (const { line, number } of section) {
    if (!line.startsWith('- ')) continue
    for (const span of inlineCodeSpans(line)) {
      if (!GUARD_PATH.test(span.text)) continue
      if (cited.has(span.text)) {
        report(
          file,
          'duplicate',
          `line ${number} cites ${span.text} again: each guard file has one line`,
        )
      }
      cited.set(span.text, number)
      if (!input.guardFiles.includes(span.text)) {
        report(
          file,
          'missing-file',
          `line ${number} cites ${span.text}, which does not exist: fix the path or remove the line`,
        )
      }
      const description = line.replace(/`[^`]*`/g, '').replace(/^[-\s:,.;]+/, '')
      if (
        description.split(/\s+/).filter((word) => /\w/.test(word)).length < MIN_DESCRIPTION_WORDS
      ) {
        report(
          file,
          'no-description',
          `line ${number} cites ${span.text} without saying what it binds: write at least ${MIN_DESCRIPTION_WORDS} words after the path`,
        )
      }
    }
  }
  for (const path of input.guardFiles) {
    if (!cited.has(path)) {
      report(
        file,
        'uncited',
        `${path} is not cited in the "## Guards" section: add one line saying what it binds`,
      )
    }
  }
  return violations
}
