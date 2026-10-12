/**
 * Mutation probe. Replaces one exact snippet in a file, runs a command, and
 * restores the file byte for byte, whatever happens.
 *
 *   node scripts/break-line.ts --file <path> --find <text> --replace <text> -- <command> [args...]
 *
 * Prints one verdict line and exits with:
 *   0  CAUGHT      the command failed with the mutation in place
 *   1  NOT CAUGHT  the command still passed: no test guards that snippet
 *   2  ERROR       the snippet was missing or ambiguous, the command could not
 *                  start, or the file could not be restored
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export type Verdict = 'CAUGHT' | 'NOT CAUGHT' | 'ERROR'

export interface BreakLineOptions {
  file: string
  find: string
  replace: string
  command: string
  args: string[]
  cwd?: string
  /** Show the command's output. The CLI does; tests keep it quiet. */
  inheritOutput?: boolean
}

export interface BreakLineResult {
  verdict: Verdict
  reason: string
}

export function breakLine(options: BreakLineOptions): BreakLineResult {
  const original = readFileSync(options.file)
  const text = original.toString('utf8')
  const at = options.find === '' ? -1 : text.indexOf(options.find)
  if (at === -1) return { verdict: 'ERROR', reason: 'snippet not found' }
  if (text.indexOf(options.find, at + 1) !== -1) {
    return {
      verdict: 'ERROR',
      reason: 'snippet appears more than once; make it unique',
    }
  }
  if (options.find === options.replace) {
    return { verdict: 'ERROR', reason: 'the replacement equals the snippet' }
  }
  const mutated = text.slice(0, at) + options.replace + text.slice(at + options.find.length)

  let result: BreakLineResult
  try {
    writeFileSync(options.file, mutated)
    const run = spawnSync(options.command, options.args, {
      cwd: options.cwd,
      stdio: options.inheritOutput === true ? 'inherit' : 'pipe',
      shell: false,
    })
    if (run.error !== undefined) {
      result = {
        verdict: 'ERROR',
        reason: `the command could not start: ${run.error.message}`,
      }
    } else if (run.status === 0) {
      result = {
        verdict: 'NOT CAUGHT',
        reason: 'the command passed with the mutation in place',
      }
    } else {
      result = {
        verdict: 'CAUGHT',
        reason: `the command failed (${run.status === null ? `signal ${String(run.signal)}` : `exit ${run.status}`})`,
      }
    }
  } finally {
    writeFileSync(options.file, original)
  }
  if (!readFileSync(options.file).equals(original)) {
    return { verdict: 'ERROR', reason: 'the file was not restored byte for byte' }
  }
  return result
}

const EXIT_CODES: Record<Verdict, number> = {
  CAUGHT: 0,
  'NOT CAUGHT': 1,
  ERROR: 2,
}

export function main(argv: string[]): number {
  const separator = argv.indexOf('--')
  const usage =
    'usage: node scripts/break-line.ts --file <path> --find <text> --replace <text> -- <command> [args...]'
  if (separator === -1) {
    console.error(usage)
    return EXIT_CODES.ERROR
  }
  let values: { file?: string; find?: string; replace?: string }
  try {
    ;({ values } = parseArgs({
      args: argv.slice(0, separator),
      options: {
        file: { type: 'string' },
        find: { type: 'string' },
        replace: { type: 'string' },
      },
      strict: true,
    }))
  } catch (error) {
    // A crash would exit with 1, which reads as NOT CAUGHT. Report it as ERROR.
    // A value that starts with "-" must be written as --find=<value>.
    console.error(error instanceof Error ? error.message : String(error))
    console.error(usage)
    return EXIT_CODES.ERROR
  }
  const [command, ...args] = argv.slice(separator + 1)
  if (
    values.file === undefined ||
    values.find === undefined ||
    values.replace === undefined ||
    command === undefined
  ) {
    console.error(usage)
    return EXIT_CODES.ERROR
  }
  // The child gets Ctrl-C too. Ignoring it here lets the restore run before we exit.
  process.on('SIGINT', () => {})
  process.on('SIGTERM', () => {})
  const result = breakLine({
    file: values.file,
    find: values.find,
    replace: values.replace,
    command,
    args,
    inheritOutput: true,
  })
  console.log(`${result.verdict}: ${result.reason}`)
  return EXIT_CODES[result.verdict]
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  process.exit(main(process.argv.slice(2)))
}
