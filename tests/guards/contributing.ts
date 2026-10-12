import { inlineCodeSpans, sectionLines, tableCells } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `contributing`: `CONTRIBUTING.md`, the first file a contributor reads, agrees with the
 * repository on what it can check.
 *
 * - The Node.js version of "Prerequisites" is the one in `.node-version`.
 * - The pnpm major version of "Prerequisites" is the one of the `packageManager` field.
 * - The commands table lists the same commands as the one of `AGENTS.md`. `CONTRIBUTING.md`
 *   writes `pnpm exec vp ...` where `AGENTS.md` writes `vp ...`; the two are the same command.
 */

export interface ContributingInput {
  contributing: TextFile
  /** The root `AGENTS.md`. */
  agents: TextFile
  /** The text of `.node-version`. */
  nodeVersion: string
  /** The `packageManager` field of the root `package.json`, e.g. `pnpm@12.11.2+sha512...`. */
  packageManager: string
}

/** The commands in the first column of the `## Commands` table, `pnpm exec vp` written as `vp`. */
export function commandTable(markdown: string): string[] {
  const commands: string[] = []
  for (const { line } of sectionLines(markdown, 'Commands')) {
    const first = tableCells(line)?.[0]
    const span = first === undefined ? undefined : inlineCodeSpans(first)[0]
    if (span !== undefined) commands.push(span.text.replace(/^pnpm exec (?=vp\b)/, ''))
  }
  return commands
}

export function checkContributing(input: ContributingInput): Violation[] {
  const violations: Violation[] = []
  const file = input.contributing.path
  const report = (rule: string, message: string): void => {
    violations.push({ rule: `contributing/${rule}`, file, message })
  }

  const prerequisites = sectionLines(input.contributing.text, 'Prerequisites')
    .map(({ line }) => line)
    .join('\n')
  const node = /Node\.js\s+\*{0,2}(\d+\.\d+\.\d+)/.exec(prerequisites)?.[1]
  if (node !== input.nodeVersion.trim()) {
    report(
      'node-version',
      `"Prerequisites" says Node.js ${node ?? '(no version)'} but .node-version pins ${input.nodeVersion.trim()}`,
    )
  }
  const pnpm = /pnpm\s+\*{0,2}(\d+)\b/.exec(prerequisites)?.[1]
  const pinned = /^pnpm@(\d+)\./.exec(input.packageManager)?.[1]
  if (pnpm === undefined || pnpm !== pinned) {
    report(
      'pnpm-major',
      `"Prerequisites" says pnpm ${pnpm ?? '(no version)'} but packageManager pins pnpm ${pinned ?? '(none)'}`,
    )
  }

  const here = commandTable(input.contributing.text)
  const there = commandTable(input.agents.text)
  const missing = there.filter((command) => !here.includes(command))
  const extra = here.filter((command) => !there.includes(command))
  if (here.length === 0) {
    report('commands', 'the "## Commands" table of CONTRIBUTING.md is missing or lists no command')
  } else if (missing.length > 0 || extra.length > 0) {
    report(
      'commands',
      `the commands table must list the same commands as AGENTS.md; missing: ${JSON.stringify(missing)}, extra: ${JSON.stringify(extra)}`,
    )
  }
  return violations
}
