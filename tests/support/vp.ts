import { isRecord, isStringArray, recordAt } from './values.ts'

export const VP_RUN_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-F',
  '--filter',
  '--log',
  '--concurrency-limit',
])

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

function commandName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1)
}

function localTask(task: string, rootPackage: string | undefined): string {
  return rootPackage !== undefined && task.startsWith(`${rootPackage}#`)
    ? task.slice(rootPackage.length + 1)
    : task
}

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
    const task = isAlias
      ? vpRunTask(after)
      : after[0] === 'run'
        ? vpRunTask(after.slice(1))
        : undefined
    if (task !== undefined) tasks.push(localTask(task, rootPackage))
  }
  return tasks
}

function commandsOfTask(task: unknown): string[] {
  if (typeof task === 'string') return [task]
  if (isStringArray(task)) return task
  const command = isRecord(task) ? task.command : undefined
  if (typeof command === 'string') return [command]
  return isStringArray(command) ? command : []
}

function dependenciesOfTask(task: unknown): string[] {
  const dependsOn = isRecord(task) ? task.dependsOn : undefined
  if (!Array.isArray(dependsOn)) return []
  return dependsOn.flatMap((entry: unknown) => {
    if (typeof entry === 'string') return [entry]
    return isRecord(entry) && typeof entry.task === 'string' ? [entry.task] : []
  })
}

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
