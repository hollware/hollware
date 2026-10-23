import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { analyzeSource } from '../../../../tests/support/source.ts'

const OPS = join(import.meta.dirname, '../../src/ops')

const ALLOWED = new Set(['@hollware/core', 'zod', '../ports.ts', '../auth/types.ts'])

function importsOf(file: string): string[] {
  const analysis = analyzeSource(file, readFileSync(join(OPS, file), 'utf8'))
  expect(analysis.syntaxErrors).toEqual([])
  return analysis.references.map((reference) => reference.specifier)
}

const FILES = readdirSync(OPS).filter((file) => file.endsWith('.ts'))

describe('the modules of src/ops', () => {
  it('are the ones this test reads', () => {
    expect(FILES).toContain('index.ts')
    expect(FILES).toContain('types.ts')
    expect(FILES).toContain('publish.ts')
  })

  it.each(FILES)('%s imports only the ports, core, zod and its siblings', (file) => {
    const strangers = importsOf(file).filter(
      (specifier) => !ALLOWED.has(specifier) && !/^\.\/[\w-]+\.ts$/.test(specifier),
    )

    expect(strangers).toEqual([])
  })
})
