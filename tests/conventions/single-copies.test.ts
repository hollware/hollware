import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vite-plus/test'
import { checkSingleCopies } from '../guards/single-copies.ts'
import { describeViolations } from '../guards/types.ts'
import { readText } from '../support/repo.ts'
import { isRecord } from '../support/values.ts'

function workspaceLockfile(): unknown {
  return parseAllDocuments(readText('pnpm-lock.yaml'))
    .map((document) => document.toJS())
    .find(
      (document) =>
        isRecord(document) &&
        isRecord(document.importers) &&
        Object.keys(document.importers).some((path) => path !== '.'),
    )
}

describe('single copies', () => {
  it('zod, hono, drizzle-orm, the MCP server SDK, vitest, and the h3 and nitropack of nuxt resolve to one version each', () => {
    const lockfile = workspaceLockfile()
    expect(isRecord(lockfile) && isRecord(lockfile.importers)).toBe(true)
    expect(describeViolations(checkSingleCopies({ lockfile }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const lockfile = (zodOfTheSdk: string) => ({
      importers: {
        '.': {
          devDependencies: { tool: { specifier: 'catalog:', version: '1.0.0' } },
        },
        'packages/core': {
          devDependencies: { zod: { specifier: 'catalog:', version: '4.6.5' } },
        },
        'packages/server': {
          dependencies: {
            '@hollware/core': { specifier: 'workspace:*', version: 'link:../core' },
            '@modelcontextprotocol/server': { specifier: 'catalog:', version: '2.3.1' },
          },
        },
      },
      snapshots: {
        'tool@1.0.0': { dependencies: { hono: '4.13.13' } },
        'hono@4.13.13': {},
        'zod@4.6.5': {},
        [`zod@${zodOfTheSdk}`]: {},
        '@modelcontextprotocol/server@2.3.1': {
          dependencies: { '@modelcontextprotocol/core': '2.3.1', zod: zodOfTheSdk },
        },
        '@modelcontextprotocol/core@2.3.1': {},
      },
    })

    it('accepts one copy, and ignores what only the root tools install', () => {
      expect(checkSingleCopies({ lockfile: lockfile('4.6.5') })).toEqual([])
    })

    it('reports a second copy reached through a transitive dependency', () => {
      expect(checkSingleCopies({ lockfile: lockfile('4.6.6') })).toEqual([
        {
          rule: 'single-copies',
          file: 'pnpm-lock.yaml',
          message:
            'zod resolves to 2 versions in what the workspace packages and apps install, 4.6.5, 4.6.6: pin the catalog to the version the lockfile already has, or move every dependent together',
        },
      ])
    })

    it('reads versions that carry peer suffixes', () => {
      const withPeers = {
        importers: {
          'apps/x': {
            dependencies: {
              'drizzle-orm': { specifier: 'catalog:', version: '0.45.4(@types/node@24.19.2)' },
              b: { specifier: 'catalog:', version: '1.0.0' },
            },
          },
        },
        snapshots: {
          'drizzle-orm@0.45.4(@types/node@24.19.2)': {},
          'b@1.0.0': { dependencies: { 'drizzle-orm': '0.44.0' } },
          'drizzle-orm@0.44.0': {},
        },
      }
      expect(checkSingleCopies({ lockfile: withPeers }).map((v) => v.message)).toEqual([
        'drizzle-orm resolves to 2 versions in what the workspace packages and apps install, 0.44.0, 0.45.4: pin the catalog to the version the lockfile already has, or move every dependent together',
      ])
    })

    it('reports a lockfile it cannot walk', () => {
      expect(checkSingleCopies({ lockfile: { lockfileVersion: '9.0' } })).toEqual([
        {
          rule: 'single-copies',
          file: 'pnpm-lock.yaml',
          message: 'the lockfile has no importers to walk',
        },
      ])
    })
  })
})
