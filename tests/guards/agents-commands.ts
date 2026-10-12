import { fencedLines, inlineCodeSpans } from '../support/markdown.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `agents-commands`: the commands an `AGENTS.md` cites in backticks refer to things
 * that exist, so a renamed task or script breaks the doc's build and not just its readers.
 *
 * - `vp run <task>` (flags skipped, `package#task` allowed): the task is one of the root
 *   `vite.config.ts` `run.tasks`, or a script of some package; with `package#task`, of that
 *   package.
 * - `pnpm --filter <package> run <script>` (also `-F`): the package exists and has that script.
 * - `pnpm run <script>`: a script of the root `package.json`.
 * - `node <file>`: the file exists.
 *
 * Both the inline commands and the lines of fenced blocks are read. Placeholders (`<task>`)
 * are skipped. A `pnpm exec` prefix is ignored. Other commands are not checked.
 */

export interface PackageScripts {
  name: string
  /** `''` for the root package. */
  dir: string
  scripts: ReadonlySet<string>
}

export interface AgentsCommandsInput {
  /** The `AGENTS.md` files, with their text. */
  docs: readonly TextFile[]
  /** The names of the `run.tasks` of the root `vite.config.ts`. */
  tasks: ReadonlySet<string>
  /** Every package of the workspace, root included, with its scripts. */
  packages: readonly PackageScripts[]
  /** The repository files. */
  files: ReadonlySet<string>
}

/** The options of `vp run` that are followed by a value. The others take none. */
const VP_RUN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-F',
  '--filter',
  '--log',
  '--concurrency-limit',
])

const PLACEHOLDER = /^[<$]|[<>$]/

const PACKAGE_NAME = /^(?:@[\w.-]+\/)?[\w.-]+$/

/** The commands of a document: its inline code spans and the lines of its fenced blocks. */
export function commandsOf(text: string): { command: string; line: number }[] {
  const found = inlineCodeSpans(text).map((span) => ({ command: span.text, line: span.line }))
  for (const [index, { line, inFence }] of fencedLines(text).entries()) {
    const trimmed = line.trim()
    if (inFence && trimmed !== '' && !/^(`{3,}|~{3,})/.test(trimmed)) {
      found.push({ command: trimmed.replace(/^\$\s+/, ''), line: index + 1 })
    }
  }
  return found
}

export function checkAgentsCommands(input: AgentsCommandsInput): Violation[] {
  const violations: Violation[] = []
  const everyScript = new Set(input.packages.flatMap((candidate) => [...candidate.scripts]))

  for (const doc of input.docs) {
    const report = (rule: string, line: number, message: string): void => {
      violations.push({
        rule: `agents-commands/${rule}`,
        file: doc.path,
        message: `line ${line}: ${message}`,
      })
    }
    for (const { command, line } of commandsOf(doc.text)) {
      const words = command.replace(/^pnpm exec (?=vp )/, '').split(/\s+/)

      if (words[0] === 'vp' && words[1] === 'run') {
        const task = vpRunTask(words.slice(2))
        if (task === undefined || PLACEHOLDER.test(task)) continue
        const [packageName, name] = task.includes('#') ? task.split('#') : [undefined, task]
        if (name === undefined || name === '') continue
        if (packageName !== undefined) {
          const target = input.packages.find((candidate) => candidate.name === packageName)
          const known =
            target?.dir === ''
              ? input.tasks.has(name) || target.scripts.has(name)
              : target?.scripts.has(name)
          if (target === undefined) {
            report(
              'unknown-package',
              line,
              `\`${command}\` names the package "${packageName}", which is not in the workspace`,
            )
          } else if (known !== true) {
            report(
              'unknown-task',
              line,
              `\`${command}\` runs "${name}", which package ${packageName} does not define`,
            )
          }
        } else if (!input.tasks.has(name) && !everyScript.has(name)) {
          report(
            'unknown-task',
            line,
            `\`${command}\` runs "${name}", which is neither a task of vite.config.ts nor a script of any package`,
          )
        }
      } else if (words[0] === 'pnpm') {
        checkPnpm(words, command, line, input, report)
      } else if (
        words[0] === 'node' &&
        words[1] !== undefined &&
        !PLACEHOLDER.test(words[1]) &&
        !words[1].startsWith('-')
      ) {
        if (!input.files.has(words[1])) {
          report('missing-file', line, `\`${command}\` runs ${words[1]}, which does not exist`)
        }
      }
    }
  }
  return violations
}

/** The task specifier of `vp run`, skipping its options and their values. */
function vpRunTask(words: readonly string[]): string | undefined {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (word.startsWith('-')) {
      if (VP_RUN_VALUE_FLAGS.has(word)) index += 1
      continue
    }
    return word
  }
  return undefined
}

function checkPnpm(
  words: readonly string[],
  command: string,
  line: number,
  input: AgentsCommandsInput,
  report: (rule: string, line: number, message: string) => void,
): void {
  const filters: string[] = []
  let index = 1
  while (index < words.length) {
    const word = words[index] ?? ''
    if (word === '--filter' || word === '-F') {
      filters.push(words[index + 1] ?? '')
      index += 2
    } else if (word.startsWith('--filter=')) {
      filters.push(word.slice('--filter='.length))
      index += 1
    } else if (word.startsWith('-')) {
      index += 1
    } else {
      break
    }
  }
  if (words[index] !== 'run') return
  const script = words[index + 1]
  if (script === undefined || script.startsWith('-') || PLACEHOLDER.test(script)) return

  if (filters.length === 0) {
    const root = input.packages.find((candidate) => candidate.dir === '')
    if (root !== undefined && !root.scripts.has(script)) {
      report(
        'missing-script',
        line,
        `\`${command}\` runs the script "${script}", which the root package.json does not define`,
      )
    }
    return
  }
  for (const filter of filters) {
    // Only an exact package name is checked: patterns, paths and placeholders are skipped.
    if (!PACKAGE_NAME.test(filter) || filter.includes('...')) continue
    const target = input.packages.find((candidate) => candidate.name === filter)
    if (target === undefined) {
      report(
        'unknown-package',
        line,
        `\`${command}\` filters on "${filter}", which is not a package of the workspace`,
      )
    } else if (!target.scripts.has(script)) {
      report(
        'missing-script',
        line,
        `\`${command}\` runs the script "${script}", which ${filter} does not define`,
      )
    }
  }
}
