import { describe, expect, it } from 'vite-plus/test'
import { checkAdminIsolation } from '../guards/admin-isolation.ts'
import { isScannedSource } from '../guards/declared-imports.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

describe('admin isolation', () => {
  it('no source file outside packages/admin imports the admin', () => {
    const sources = readRepoFiles(isScannedSource)
    expect(sources.length).toBeGreaterThan(40)
    expect(describeViolations(checkAdminIsolation({ sources }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (path: string, text: string) =>
      checkAdminIsolation({ sources: [file(path, text)] })

    it('accepts code that does not import it, and the admin importing itself', () => {
      expect(
        check('packages/server/src/index.ts', "import { name } from '@hollware/core'"),
      ).toEqual([])
      expect(check('packages/admin/src/main.ts', "import { name } from '@hollware/admin'")).toEqual(
        [],
      )
      expect(
        check('packages/server/src/index.ts', 'const note = "import x from \'@hollware/admin\'"'),
      ).toEqual([])
    })

    it('reports an import of the admin by Worker code, a subpath included', () => {
      expect(check('packages/server/src/index.ts', "import admin from '@hollware/admin'")).toEqual([
        {
          rule: 'admin-isolation/import',
          file: 'packages/server/src/index.ts',
          message:
            'line 1 imports "@hollware/admin": the admin is served as static assets and never enters the Worker bundle',
        },
      ])
      const dynamic = check(
        'apps/playground/src/index.ts',
        "const a = await import('@hollware/admin/dist/index.html')",
      )
      expect(dynamic.map((violation) => violation.rule)).toEqual(['admin-isolation/import'])
    })

    it("lets a project's Vite config import the root of the package, and nothing else", () => {
      expect(
        check('apps/x/vite.config.ts', "import { adminAssets } from '@hollware/admin'"),
      ).toEqual([])
      expect(
        check('apps/x/vite.config.ts', "import page from '@hollware/admin/dist/index.html'").map(
          (violation) => violation.rule,
        ),
      ).toEqual(['admin-isolation/import'])
      expect(
        check('apps/x/src/vite.ts', "import { adminAssets } from '@hollware/admin'").map(
          (violation) => violation.rule,
        ),
      ).toEqual(['admin-isolation/import'])
    })

    it('does not confuse a package that merely starts with the same letters', () => {
      expect(check('a.ts', "import x from '@hollware/admin-tools'")).toEqual([])
    })
  })
})
