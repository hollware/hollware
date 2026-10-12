import { isRecord, isStringArray, recordAt } from './values.ts'

/**
 * Reads the Vite+ tasks of the repository: which task a `vp run` command names, which tasks a
 * shell script runs, and which tasks the tasks of the root `vite.config.ts` run in turn.
 *
 * Limits: a script is read as text. It is split at `&&`, `||`, `;`, `|`, `&`, parentheses,
 * braces and line ends, comments are dropped, and a `vp run` counts when only a launcher
 * (`pnpm`, `exec`, `then`, `do`, `else`, `time`, `if`, `while`, `!`) or a `NAME=value`
 * assignment comes before it in its command. A `vp run` inside quotes, a heredoc or a variable
 * is not seen, and neither is a task named by a variable.
 */

/** The options of `vp run` that are followed by a value. The others take none. */
export const VP_RUN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-F',
  '--filter',
  '--log',
  '--concurrency-limit',
])

/** The task specifier of `vp run`, skipping its options and their values. `--` ends the options. */
export function vpRunTask(words: readonly string[]): string | undefined {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ''
    if (word === '--') return undefined
    if (word.startsWith('-')) {
      if (VP_RUN_VALUE_FLAGS.has(word)) index += 1
      continue
    }
    return word
  }
  return undefined
}

const SEPARATORS = /&&|\|\||[;|&\n(){}]/

const LAUNCHERS: ReadonlySet<string> = new Set([
  'pnpm',
  'exec',
  'then',
  'else',
  'do',
  'if',
  'while',
  'time',
  '!',
])

const ASSIGNMENT = /^[A-Za-z_]\w*=/

/** `./node_modules/.bin/vp` is `vp`. */
function commandName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

/** `package#task` of the root package is `task`; the tasks of other packages keep their prefix. */
function localTask(task: string, rootPackage: string | undefined): string {
  return rootPackage !== undefined && task.startsWith(`${rootPackage}#`)
    ? task.slice(rootPackage.length + 1)
    : task
}

/**
 * The tasks a shell script runs through `vp run` (or its alias `vpr`), in the order they appear:
 * `vp run -r build`, `pnpm exec vp run check:push`, `FORCE=1 vpr test`. A command that only
 * mentions them (`echo vp run test`, a comment) does not run them.
 */
export function vpRunTasks(script: string, rootPackage?: string): string[] {
  const tasks: string[] = []
  const code = script
    .replace(/\\\n/g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '$1'))
    .join('\n')
  for (const segment of code.split(SEPARATORS)) {
    const words = segment.split(/\s+/).filter((word) => word !== '')
    const at = words.findIndex((word) => ['vp', 'vpr'].includes(commandName(word)))
    if (at === -1) continue
    const before = words.slice(0, at)
    if (!before.every((word) => LAUNCHERS.has(word) || ASSIGNMENT.test(word))) continue
    const after = words.slice(at + 1)
    const isAlias = commandName(words[at] ?? '') === 'vpr'
    // `vp run <task>` and its alias `vpr <task>`; `vp check` and the rest run no task.
    const task = isAlias
      ? vpRunTask(after)
      : after[0] === 'run'
        ? vpRunTask(after.slice(1))
        : undefined
    if (task !== undefined) tasks.push(localTask(task, rootPackage))
  }
  return tasks
}

/** The commands of a task of `run.tasks`: a string, a list of strings, or `command` of an object. */
function commandsOfTask(task: unknown): string[] {
  if (typeof task === 'string') return [task]
  if (isStringArray(task)) return task
  const command = isRecord(task) ? task.command : undefined
  if (typeof command === 'string') return [command]
  return isStringArray(command) ? command : []
}

/** The tasks of `dependsOn`, which names a task or `{ task, from }`. */
function dependenciesOfTask(task: unknown): string[] {
  const dependsOn = isRecord(task) ? task.dependsOn : undefined
  if (!Array.isArray(dependsOn)) return []
  return dependsOn.flatMap((entry: unknown) => {
    if (typeof entry === 'string') return [entry]
    return isRecord(entry) && typeof entry.task === 'string' ? [entry.task] : []
  })
}

/**
 * For each task of the `run.tasks` of a Vite+ config, the tasks it runs: those its commands run
 * with `vp run`, and those it lists in `dependsOn`. Task names are returned as written, except
 * that `<rootPackage>#task` is `task`.
 */
export function taskGraph(config: unknown, rootPackage?: string): Record<string, string[]> {
  const tasks = recordAt(recordAt(config, 'run'), 'tasks') ?? {}
  return Object.fromEntries(
    Object.entries(tasks).map(([name, task]) => [
      name,
      [
        ...new Set([
          ...commandsOfTask(task).flatMap((command) => vpRunTasks(command, rootPackage)),
          ...dependenciesOfTask(task).map((dependency) => localTask(dependency, rootPackage)),
        ]),
      ],
    ]),
  )
}
