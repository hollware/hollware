import { describe, expect, it } from 'vite-plus/test'
import { checkCorePurity, forbiddenSpecifierReason } from '../guards/core-purity.ts'
import { isScannedSource } from '../guards/declared-imports.ts'
import { describeViolations } from '../guards/types.ts'
import { file, json } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: a file under packages/core/src imports cloudflare:*, @cloudflare/*, wrangler,
// node:* or a Node built-in, or uses process, Buffer, __dirname, __filename or require.

const MANIFEST = file('packages/core/package.json', json({ name: '@hollware/core' }))
const core = (text: string) => [{ path: 'packages/core/src/index.ts', text }]
const violationsOf = (text: string) => checkCorePurity({ files: core(text), manifest: MANIFEST })

describe('core purity', () => {
  it('packages/core/src imports nothing from Cloudflare or Node and uses no Node global', () => {
    const files = readRepoFiles(
      (path) => path.startsWith('packages/core/src/') && isScannedSource(path),
    )
    expect(files.map((source) => source.path)).toContain('packages/core/src/index.ts')
    const manifest = readRepoFiles((path) => path === 'packages/core/package.json')[0]
    expect(manifest?.path).toBe('packages/core/package.json')
    expect(describeViolations(checkCorePurity({ files, manifest: manifest ?? MANIFEST }))).toEqual(
      [],
    )
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts portable code, and ignores Node and Cloudflare in comments and strings', () => {
      const text = [
        "import { z } from 'zod'",
        "// import fs from 'node:fs'  and  process.env.X",
        '/* const b = Buffer.from("x"); require("fs") */',
        'export const note = "import x from \'node:fs\'; process.env; __dirname"',
        'export const template = `cloudflare:workers ${1 + 1} Buffer`',
        'export const pattern = /process|require|__dirname/',
        'export const read = (record: { process: number }) => record.process',
        'export class Pipeline { process() { return 1 } require = true }',
      ].join('\n')
      expect(violationsOf(text)).toEqual([])
    })

    it('reports a static import of a Node module, with its line', () => {
      expect(violationsOf("export {}\nimport { readFileSync } from 'node:fs'\n")).toEqual([
        {
          rule: 'core-purity/import',
          file: 'packages/core/src/index.ts',
          message: 'line 2 imports "node:fs", a Node module: core must run anywhere',
        },
      ])
    })

    it('reports every import form', () => {
      const text = [
        "import type { Env } from '@cloudflare/workers-types'",
        "import { DurableObject } from 'cloudflare:workers'",
        "export * from 'wrangler'",
        "export { x } from 'wrangler/config'",
        "import fs from 'fs'",
        "import { join } from 'path/posix'",
        "const lazy = await import('node:path')",
        "type Fs = typeof import('node:fs')",
        "const old = require('node:os')",
      ].join('\n')
      expect(violationsOf(text).map((violation) => violation.message)).toEqual([
        'line 1 imports "@cloudflare/workers-types", a Cloudflare package: core must run anywhere',
        'line 2 imports "cloudflare:workers", a Cloudflare runtime module: core must run anywhere',
        'line 3 imports "wrangler", wrangler: core must run anywhere',
        'line 4 imports "wrangler/config", wrangler: core must run anywhere',
        'line 5 imports "fs", a Node built-in: core must run anywhere',
        'line 6 imports "path/posix", a Node built-in: core must run anywhere',
        'line 7 imports "node:path", a Node module: core must run anywhere',
        'line 8 imports "node:fs", a Node module: core must run anywhere',
        'line 9 imports "node:os", a Node module: core must run anywhere',
        // `require` is itself a Node global, so the same line is reported twice.
        'line 9 uses the Node global "require": core must run anywhere',
      ])
    })

    it('reports each Node global', () => {
      const text = [
        'export const a = process.env.TOKEN',
        "export const b = Buffer.from('x')",
        'export const c = __dirname',
        'export const d = __filename',
        'export const e = typeof require',
        'export const f = globalThis.process',
      ].join('\n')
      expect(violationsOf(text)).toEqual([
        {
          rule: 'core-purity/global',
          file: 'packages/core/src/index.ts',
          message: 'line 1 uses the Node global "process": core must run anywhere',
        },
        {
          rule: 'core-purity/global',
          file: 'packages/core/src/index.ts',
          message: 'line 2 uses the Node global "Buffer": core must run anywhere',
        },
        {
          rule: 'core-purity/global',
          file: 'packages/core/src/index.ts',
          message: 'line 3 uses the Node global "__dirname": core must run anywhere',
        },
        {
          rule: 'core-purity/global',
          file: 'packages/core/src/index.ts',
          message: 'line 4 uses the Node global "__filename": core must run anywhere',
        },
        {
          rule: 'core-purity/global',
          file: 'packages/core/src/index.ts',
          message: 'line 5 uses the Node global "require": core must run anywhere',
        },
        {
          rule: 'core-purity/global',
          file: 'packages/core/src/index.ts',
          message: 'line 6 uses the Node global "globalThis.process": core must run anywhere',
        },
      ])
    })

    it('reports a file that does not parse, because it cannot be judged', () => {
      const result = violationsOf('import { from "node:fs"')
      expect(result.length).toBeGreaterThan(0)
      expect(result.every((violation) => violation.rule === 'core-purity/syntax-error')).toBe(true)
    })

    it('reports a Cloudflare package or wrangler among the runtime dependencies of core', () => {
      const manifest = file(
        'packages/core/package.json',
        json({
          dependencies: { zod: 'catalog:', '@cloudflare/workers-types': 'catalog:' },
          peerDependencies: { wrangler: 'catalog:' },
          optionalDependencies: { '@cloudflare/vite-plugin': 'catalog:' },
          devDependencies: { wrangler: 'catalog:', '@cloudflare/vitest-plugin': 'catalog:' },
        }),
      )
      expect(checkCorePurity({ files: [], manifest })).toEqual([
        {
          rule: 'core-purity/dependency',
          file: 'packages/core/package.json',
          message:
            'dependencies lists @cloudflare/workers-types: core has no Cloudflare dependency (a tool belongs in devDependencies)',
        },
        {
          rule: 'core-purity/dependency',
          file: 'packages/core/package.json',
          message:
            'peerDependencies lists wrangler: core has no Cloudflare dependency (a tool belongs in devDependencies)',
        },
        {
          rule: 'core-purity/dependency',
          file: 'packages/core/package.json',
          message:
            'optionalDependencies lists @cloudflare/vite-plugin: core has no Cloudflare dependency (a tool belongs in devDependencies)',
        },
      ])
    })

    it('knows which specifiers are forbidden', () => {
      expect(forbiddenSpecifierReason('zod')).toBeUndefined()
      expect(forbiddenSpecifierReason('./node')).toBeUndefined()
      expect(forbiddenSpecifierReason('@hollware/client')).toBeUndefined()
      expect(forbiddenSpecifierReason('node:crypto')).toBe('a Node module')
      expect(forbiddenSpecifierReason('crypto')).toBe('a Node built-in')
    })
  })
})
