export type Json = Readonly<Record<string, unknown>>

export function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : {}
}

export function list(value: unknown): readonly Json[] {
  return Array.isArray(value) ? value.map(record) : []
}

export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
