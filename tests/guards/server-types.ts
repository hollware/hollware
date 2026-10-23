import { isDeepStrictEqual } from 'node:util'
import { parseJsonc } from '../support/jsonc.ts'
import { isRecord, recordAt } from '../support/values.ts'
import type { TextFile, Violation } from './types.ts'

export interface ServerTypesInput {
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
