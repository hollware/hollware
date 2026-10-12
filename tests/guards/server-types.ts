import { isDeepStrictEqual } from 'node:util'
import { parseJsonc } from '../support/jsonc.ts'
import { isRecord, recordAt } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

/**
 * Guard `server-types`: `packages/server/src` is Workers code without Node.js, like the Workers
 * that run it. Its `tsconfig.json` covers only `src` and the runtime types that `wrangler types`
 * generates for the package's test configuration, which opts out of Node.js compatibility
 * (guard `wrangler-flags`, and `types:check` keeps the file in step). With no other `types`,
 * a Node global in `src` is a type error in `vp check`. The tests and configs type-check
 * through `tests/tsconfig.json`.
 */

export interface ServerTypesInput {
  /** `packages/server/tsconfig.json`. */
  tsconfig: TextFile
}

const EXPECTED = {
  include: ['worker-configuration.d.ts', 'src'],
  types: ['./worker-configuration.d.ts'],
}

export function checkServerTypes(input: ServerTypesInput): Violation[] {
  const report = (message: string): Violation[] => [
    { rule: 'server-types', file: input.tsconfig.path, message },
  ]
  const parsed = parseJsonc(input.tsconfig.text)
  if (!parsed.ok) return report(`the file does not parse, so it cannot be checked: ${parsed.error}`)
  const found = {
    include: isRecord(parsed.value) ? parsed.value.include : undefined,
    types: recordAt(parsed.value, 'compilerOptions')?.types,
  }
  return isDeepStrictEqual(found, EXPECTED)
    ? []
    : report(
        `must type-check only src with the generated Workers runtime types, ${JSON.stringify(EXPECTED)}, so that a Node global is a type error; found ${JSON.stringify(found)}`,
      )
}
