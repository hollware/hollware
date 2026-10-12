/** Narrowing helpers for parsed JSON and YAML. Tests build values without `as` casts. */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

export function stringAt(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const found = value[key]
  return typeof found === 'string' ? found : undefined
}

export function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const found = value[key]
  return isRecord(found) ? found : undefined
}

export function arrayAt(value: unknown, key: string): unknown[] | undefined {
  if (!isRecord(value)) return undefined
  const found = value[key]
  return Array.isArray(found) ? found : undefined
}

export type JsonResult = { ok: true; value: unknown } | { ok: false; error: string }

/** `JSON.parse` that reports a syntax error instead of throwing. */
export function parseJson(text: string): JsonResult {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
