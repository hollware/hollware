import type { Problems } from './config-error.ts'

export type JsonObject = Record<string, unknown>

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function quote(text: string): string {
  return JSON.stringify(text)
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

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

export function wrongType(value: unknown, expected: string): string {
  return `${value === undefined ? 'is missing' : `is ${found(value)}`}; it must be ${expected}`
}

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

export function keyPath(parent: string, key: string): string {
  return PLAIN_KEY.test(key) ? `${parent}.${key}` : `${parent}[${quote(key)}]`
}

export function itemPath(parent: string, index: number): string {
  return `${parent}[${index}]`
}
