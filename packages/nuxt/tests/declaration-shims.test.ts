import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'
import { shimRuntimeDeclarations } from '../declaration-shims.ts'
import config from '../vite.config.ts'

describe('the declarations of the runtime', () => {
  it('get a .d.ts beside each .d.mts when the package is built, for the paths without extension that Nitro writes', () => {
    const out = mkdtempSync(join(tmpdir(), 'nuxt-shims-'))
    const runtime = join(out, 'runtime')
    mkdirSync(join(runtime, 'server'), { recursive: true })
    writeFileSync(join(runtime, 'composables.d.mts'), '')
    writeFileSync(join(runtime, 'composables.mjs'), '')
    writeFileSync(join(runtime, 'server', 'reader.d.mts'), '')
    writeFileSync(join(out, 'index.d.mts'), '')

    const pack = config.pack
    expect(Array.isArray(pack) ? undefined : pack?.onSuccess).toBe(shimRuntimeDeclarations)
    shimRuntimeDeclarations({ outDir: out })

    expect([
      readFileSync(join(runtime, 'server', 'reader.d.ts'), 'utf8'),
      readFileSync(join(runtime, 'composables.d.ts'), 'utf8'),
      readFileSync(join(out, 'index.d.ts'), 'utf8'),
    ]).toEqual([
      "export * from './reader.mjs'\n",
      "export * from './composables.mjs'\n",
      "export * from './index.mjs'\n",
    ])
  })
})
