import type { Problems } from './config-error.ts'
import { MAX_NESTING_DEPTH, MIN_NESTING_DEPTH } from './constants.ts'
import type { ResolvedNesting } from './types.ts'
import { isRecord, keyPath, wrongType } from './values.ts'

const SHAPE_FIX = `Set it to { maxDepth: 3 }, a depth from ${MIN_NESTING_DEPTH} to ${MAX_NESTING_DEPTH}, or remove it for flat entries.`

export function readNesting(
  path: string,
  raw: unknown,
  problems: Problems,
): ResolvedNesting | null {
  if (raw === undefined || raw === null) return null
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object like { maxDepth }'), SHAPE_FIX)
    return null
  }
  const maxDepth = raw['maxDepth']
  if (
    typeof maxDepth === 'number' &&
    Number.isInteger(maxDepth) &&
    maxDepth >= MIN_NESTING_DEPTH &&
    maxDepth <= MAX_NESTING_DEPTH
  ) {
    return { maxDepth }
  }
  problems.add(
    keyPath(path, 'maxDepth'),
    wrongType(maxDepth, `an integer from ${MIN_NESTING_DEPTH} to ${MAX_NESTING_DEPTH}`),
    SHAPE_FIX,
  )
  return null
}
