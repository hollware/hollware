import { describe, expect, it } from 'vite-plus/test'
import { checkLicenses } from '../guards/licenses.ts'
import { describeViolations } from '../guards/types.ts'
import { readBytesIfExists } from '../support/repo.ts'
import { workspaceManifests } from '../support/workspace.ts'

// Fails when: any byte of a packages/*/LICENSE differs from the root LICENSE (the text, a
// trailing newline, line endings), a package has no LICENSE, or the root is not the MIT License.

const MIT = Buffer.from('MIT License\n\nCopyright (c) 2026-present Somebody\n')

describe('licenses', () => {
  it('every package holds a byte-for-byte copy of the root LICENSE', () => {
    const dirs = workspaceManifests()
      .map((manifest) => manifest.path.replace(/\/?package\.json$/, ''))
      .filter((dir) => dir.startsWith('packages/'))
    const violations = checkLicenses({
      root: readBytesIfExists('LICENSE'),
      packages: dirs.map((dir) => ({ dir, license: readBytesIfExists(`${dir}/LICENSE`) })),
    })
    expect(dirs).toHaveLength(6)
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const packages = (license: Uint8Array | undefined) => [{ dir: 'packages/core', license }]

    it('accepts identical copies', () => {
      expect(checkLicenses({ root: MIT, packages: packages(Buffer.from(MIT)) })).toEqual([])
    })

    it('reports a copy that differs by one letter', () => {
      const edited = Buffer.from(MIT.toString().replace('Somebody', 'Somebodz'))
      expect(checkLicenses({ root: MIT, packages: packages(edited) })).toEqual([
        {
          rule: 'license/differs',
          file: 'packages/core/LICENSE',
          message:
            'the LICENSE is not a byte-for-byte copy of the root LICENSE: run `cp LICENSE packages/core/LICENSE`',
        },
      ])
    })

    it('reports a copy that only lost its final newline or changed its line endings', () => {
      const noNewline = Buffer.from(MIT.toString().trimEnd())
      const crlf = Buffer.from(MIT.toString().replaceAll('\n', '\r\n'))
      for (const copy of [noNewline, crlf]) {
        const result = checkLicenses({ root: MIT, packages: packages(copy) })
        expect(result.map((violation) => violation.rule)).toEqual(['license/differs'])
      }
    })

    it('reports a package without a LICENSE', () => {
      expect(checkLicenses({ root: MIT, packages: packages(undefined) })).toEqual([
        {
          rule: 'license/missing',
          file: 'packages/core/LICENSE',
          message: 'the package has no LICENSE: copy the root LICENSE here',
        },
      ])
    })

    it('reports a missing root LICENSE', () => {
      expect(checkLicenses({ root: undefined, packages: packages(MIT) })).toEqual([
        { rule: 'license/root-missing', file: 'LICENSE', message: 'the root LICENSE is missing' },
      ])
    })

    it('reports a root LICENSE that is not the MIT License', () => {
      const apache = Buffer.from('Apache License\nVersion 2.0\n')
      expect(checkLicenses({ root: apache, packages: packages(Buffer.from(apache)) })).toEqual([
        {
          rule: 'license/root-not-mit',
          file: 'LICENSE',
          message: 'the root LICENSE must be the MIT License: its first line is "MIT License"',
        },
      ])
    })
  })
})
