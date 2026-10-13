import { readFileSync, statSync, writeFileSync } from 'node:fs'
import type { RunWrangler, WranglerResult } from '../../src/index.ts'

/** A call the CLI made to wrangler. */
export interface WranglerCall {
  args: string[]
  /** The SQL file given with `--file`, as it was when wrangler was called: the CLI deletes it afterwards. */
  sql: string | undefined
  /** The permission bits of that file, as they were when wrangler was called. */
  mode: number | undefined
}

export type Answer = WranglerResult | ((call: WranglerCall) => WranglerResult)

export interface FakeWrangler {
  run: RunWrangler
  /** Every call, in order. */
  calls: WranglerCall[]
}

/**
 * A wrangler that answers the calls it gets with `answers`, one for each, in order, and records
 * them. A call with no answer left fails the test. Wrangler is not ours, so it is the one thing
 * these tests fake.
 */
export function fakeWrangler(...answers: Answer[]): FakeWrangler {
  const calls: WranglerCall[] = []
  const run: RunWrangler = (args) => {
    const file = args[args.indexOf('--file') + 1]
    const call: WranglerCall = {
      args: [...args],
      sql: args.includes('--file') && file !== undefined ? readFileSync(file, 'utf8') : undefined,
      mode: args.includes('--file') && file !== undefined ? statSync(file).mode & 0o777 : undefined,
    }
    calls.push(call)
    const answer = answers[calls.length - 1]
    if (answer === undefined) {
      return Promise.reject(
        new Error(`unexpected wrangler call ${calls.length}: ${args.join(' ')}`),
      )
    }
    return Promise.resolve(typeof answer === 'function' ? answer(call) : answer)
  }
  return { run, calls }
}

export function ok(stdout = ''): WranglerResult {
  return { code: 0, stdout, stderr: '' }
}

export function failed(stderr: string, stdout = '', code = 1): WranglerResult {
  return { code, stdout, stderr }
}

type Rows = Record<string, unknown>[]

/** What `wrangler d1 execute --json` prints: one result for each statement. */
export function d1(...statements: Rows[]): WranglerResult {
  const answer = statements.map((results) => ({ results, success: true, meta: { duration: 0 } }))
  return ok(`${JSON.stringify(answer, null, 2)}\n`)
}

/** What `wrangler d1 execute --json` prints, on stdout, when the SQL fails. */
export function d1Failed(text: string): WranglerResult {
  return { code: 1, stdout: `\n${JSON.stringify({ error: { text } }, null, 2)}\n`, stderr: '' }
}

/**
 * An answer to `wrangler d1 export --output <file>` that writes the file and succeeds. It fails
 * the test, and writes nothing, when the call it answers is not an export.
 */
export function exportsTo(content: string): Answer {
  return (call) => {
    const flag = call.args.indexOf('--output')
    const file = flag === -1 ? undefined : call.args[flag + 1]
    if (file === undefined) throw new Error(`not an export: ${call.args.join(' ')}`)
    writeFileSync(file, content)
    return ok()
  }
}
