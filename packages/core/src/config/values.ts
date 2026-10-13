import type { Problems } from './config-error.ts'

/**
 * What the config checks share. The config comes from `hollware.config.ts`, which may be plain
 * JavaScript, so every value is `unknown` until it has been looked at, and the messages say what
 * was found instead.
 */

export type JsonObject = Record<string, unknown>

/** A value with keys: not null, not an array. */
export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string as the messages show it: quoted, with what could break a line escaped. */
export function quote(text: string): string {
  return JSON.stringify(text)
}

/** Text of an error that someone else wrote, on one line, so that a problem stays one line. */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** What a value is, for a message: `"es"`, `42`, `null`, `an array`. */
function found(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'string':
      return quote(value)
    case 'number':
    case 'boolean':
    case 'bigint':
      return String(value)
    case 'function':
      return 'a function'
    case 'symbol':
      return 'a symbol'
    default:
      return Array.isArray(value) ? 'an array' : 'an object'
  }
}

/** `is 42; it must be a string`, or `is missing; …` when the value is not there. */
export function wrongType(value: unknown, expected: string): string {
  return `${value === undefined ? 'is missing' : `is ${found(value)}`}; it must be ${expected}`
}

/** An optional string: `null` when it is absent, and a problem when it is anything else. */
export function readOptionalString(
  path: string,
  value: unknown,
  fix: string,
  problems: Problems,
): string | null {
  if (value === undefined) return null
  if (typeof value === 'string') return value
  problems.add(path, wrongType(value, 'a string'), fix)
  return null
}

const PLAIN_KEY = /^[A-Za-z0-9_-]+$/

/** The path of a key inside `parent`: `sites.demo`, or `sites["my site"]` for an odd key. */
export function keyPath(parent: string, key: string): string {
  return PLAIN_KEY.test(key) ? `${parent}.${key}` : `${parent}[${quote(key)}]`
}

/** The path of an item of an array: `sites.demo.locales[1]`. */
export function itemPath(parent: string, index: number): string {
  return `${parent}[${index}]`
}
