import { readFileSync, statSync, writeFileSync } from 'node:fs'
import type { RunWrangler, WranglerResult } from '../../src/index.ts'

export interface WranglerCall {
  args: string[]
  sql: string | undefined
  mode: number | undefined
}

export type Answer = WranglerResult | ((call: WranglerCall) => WranglerResult)

export interface FakeWrangler {
  run: RunWrangler
  calls: WranglerCall[]
}

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

export function d1(...statements: Rows[]): WranglerResult {
  const answer = statements.map((results) => ({ results, success: true, meta: { duration: 0 } }))
  return ok(`${JSON.stringify(answer, null, 2)}\n`)
}

export function d1Failed(text: string): WranglerResult {
  return { code: 1, stdout: `\n${JSON.stringify({ error: { text } }, null, 2)}\n`, stderr: '' }
}

export function exportsTo(content: string): Answer {
  return (call) => {
    const flag = call.args.indexOf('--output')
    const file = flag === -1 ? undefined : call.args[flag + 1]
    if (file === undefined) throw new Error(`not an export: ${call.args.join(' ')}`)
    writeFileSync(file, content)
    return ok()
  }
}
