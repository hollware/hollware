import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { analyzeSource } from '../../../../tests/support/source.ts'

// Fails when: a module of src/ops imports anything but the ports, the types of the auth module,
// `@hollware/core`, `zod` and its own siblings, whether it imports it as a value, as a type or
// with `import()`. Handlers see the ports of src/ports.ts and never the D1 store, the MCP adapter,
// Drizzle or a Cloudflare module (packages/server/AGENTS.md), which is what lets an adapter hand
// them any store, and what keeps a Worker that never writes from loading what a write needs.

const OPS = join(import.meta.dirname, '../../src/ops')

/** The modules a handler may import, by specifier; a sibling is `./name.ts`. */
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
