import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { exportsOf, staleParts } from '../../scripts/api.ts'

const ROOT = resolve(import.meta.dirname, '../..')

describe('public API', () => {
  it('api/ is the public API of the code', { timeout: 60_000 }, async () => {
    expect(await staleParts(ROOT)).toEqual([])
  })

  describe('self-test: the exports of a module', () => {
    it('reads values, types, re-exports and export *, a const and its type as a value', () => {
      const dir = mkdtempSync(join(tmpdir(), 'api-exports-'))
      const files: Record<string, string> = {
        'index.ts': [
          "export * from './all.ts'",
          "export { picked, type Picked } from './some.ts'",
          'export type Alias = string',
          'export interface Shape { readonly a: string }',
          'export const one = 1, two = 2',
          'export function made() {}',
          'export class Thing {}',
          "export * as space from './all.ts'",
        ].join('\n'),
        'all.ts': [
          'export const shared = 1',
          'export type shared = number',
          'export type Only = 1',
        ].join('\n'),
        'some.ts': 'export const picked = 1\nexport type Picked = 1\nexport const hidden = 2',
      }
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)

      const names = exportsOf(
        join(dir, 'index.ts'),
        (path) => files[path.slice(dir.length + 1)] ?? '',
      )

      expect(Object.fromEntries([...names].sort(([a], [b]) => a.localeCompare(b)))).toEqual({
        Alias: 'type',
        made: 'value',
        Only: 'type',
        one: 'value',
        picked: 'value',
        Picked: 'type',
        Shape: 'type',
        shared: 'value',
        space: 'value',
        Thing: 'value',
        two: 'value',
      })
    })
  })
})
