import { describe, expect, it } from 'vite-plus/test'
import { checkPnpmPolicy, isExactCatalogVersion } from '../guards/pnpm-policy.ts'
import { describeViolations } from '../guards/types.ts'
import { file, json } from '../support/fixtures.ts'
import { readText } from '../support/repo.ts'

// Fails when: pnpm-workspace.yaml lowers minimumReleaseAge below 1440, drops trustPolicy:
// no-downgrade, lists an allowBuilds entry without a "# reason", lists a
// minimumReleaseAgeExclude entry that is not exact, has no reason, has no "expires YYYY-MM-DD"
// or has expired, pins a catalog version that is not exact, or leaves the catalog unsorted;
// or the root packageManager loses its sha512 hash.

const TODAY = '2026-10-11'
const HASH = '0123456789abcdef'.repeat(8)
const PNPM = `pnpm@12.11.2+sha512.${HASH}`

interface Parts {
  age?: string
  trust?: string
  allowBuilds?: string
  exclude?: string
  catalog?: string
}

function workspace(parts: Parts = {}): string {
  return `${[
    'packages:\n  - packages/*',
    `catalog:\n${parts.catalog ?? "  '@scope/a': 1.0.0\n  b: 2.0.0\n  c: npm:@scope/c@3.0.0"}`,
    parts.age ?? 'minimumReleaseAge: 1440',
    parts.trust ?? 'trustPolicy: no-downgrade',
    `allowBuilds:\n${parts.allowBuilds ?? '  esbuild: true # platform binary used by wrangler'}`,
    parts.exclude ?? '',
  ].join('\n')}\n`
}

const GOOD_ROOT = { name: 'root', packageManager: PNPM }

const check = (parts: Parts | string, rootManifest: Record<string, unknown> = GOOD_ROOT) =>
  checkPnpmPolicy({
    workspace: file('pnpm-workspace.yaml', typeof parts === 'string' ? parts : workspace(parts)),
    rootManifest: file('package.json', json(rootManifest)),
    today: TODAY,
  })

const messages = (parts: Parts | string) =>
  check(parts).map((violation) => `${violation.rule}: ${violation.message}`)

describe('pnpm policy', () => {
  it('pnpm-workspace.yaml and the root package.json keep the supply-chain policy', () => {
    const violations = checkPnpmPolicy({
      workspace: file('pnpm-workspace.yaml', readText('pnpm-workspace.yaml')),
      rootManifest: file('package.json', readText('package.json')),
      today: new Date().toISOString().slice(0, 10),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    it('accepts the good fixture', () => {
      expect(check({})).toEqual([])
    })

    it('reports a minimumReleaseAge below 24 hours and a missing trustPolicy', () => {
      expect(check({ age: 'minimumReleaseAge: 60', trust: '' })).toEqual([
        {
          rule: 'pnpm-policy/minimum-release-age',
          file: 'pnpm-workspace.yaml',
          message:
            '"minimumReleaseAge" must be at least 1440 (24 hours), found 60; never lower it, use a minimumReleaseAgeExclude entry for an urgent fix',
        },
        {
          rule: 'pnpm-policy/trust-policy',
          file: 'pnpm-workspace.yaml',
          message: '"trustPolicy" must be "no-downgrade", found undefined',
        },
      ])
    })

    it('reports an allowBuilds entry without a trailing reason', () => {
      const allowBuilds =
        '  esbuild: true # platform binary\n  sharp: true\n  # above, not trailing\n  workerd: false'
      expect(check({ allowBuilds })).toEqual([
        {
          rule: 'pnpm-policy/allow-builds-reason',
          file: 'pnpm-workspace.yaml',
          message:
            'allowBuilds.sharp has no trailing "# reason": say why its build script may run, or why it must not',
        },
        {
          rule: 'pnpm-policy/allow-builds-reason',
          file: 'pnpm-workspace.yaml',
          message:
            'allowBuilds.workerd has no trailing "# reason": say why its build script may run, or why it must not',
        },
      ])
    })

    describe('minimumReleaseAgeExclude', () => {
      const exclude = (entry: string) => ({ exclude: `minimumReleaseAgeExclude:\n  - ${entry}` })

      it('accepts an exact entry with a reason and an expiry that has not passed', () => {
        expect(
          check(exclude('left-pad@1.3.0 # CVE fix, no patched release yet; expires 2026-10-20')),
        ).toEqual([])
        expect(check(exclude('"@scope/pkg@2.0.0-rc.1" # urgent; expires 2026-10-11'))).toEqual([])
      })

      it('reports an entry without any comment: no reason and no expiry', () => {
        expect(messages(exclude('left-pad@1.3.0'))).toEqual([
          'pnpm-policy/exclude-reason: minimumReleaseAgeExclude entry left-pad@1.3.0 needs a trailing "# <reason>; expires YYYY-MM-DD" comment with a reason',
          'pnpm-policy/exclude-expiry: minimumReleaseAgeExclude entry left-pad@1.3.0 needs "expires YYYY-MM-DD" with a real date in its trailing comment',
        ])
      })

      it('reports an entry with an expiry but no reason', () => {
        expect(messages(exclude('left-pad@1.3.0 # expires 2026-10-20'))).toEqual([
          'pnpm-policy/exclude-reason: minimumReleaseAgeExclude entry left-pad@1.3.0 needs a trailing "# <reason>; expires YYYY-MM-DD" comment with a reason',
        ])
      })

      it('reports an entry that has expired', () => {
        expect(messages(exclude('left-pad@1.3.0 # urgent fix; expires 2026-10-10'))).toEqual([
          'pnpm-policy/exclude-expired: minimumReleaseAgeExclude entry left-pad@1.3.0 expired on 2026-10-10: remove it and let minimumReleaseAge apply',
        ])
      })

      it('reports an expiry that is not a real date', () => {
        expect(messages(exclude('left-pad@1.3.0 # urgent fix; expires 2026-13-45'))).toEqual([
          'pnpm-policy/exclude-expiry: minimumReleaseAgeExclude entry left-pad@1.3.0 needs "expires YYYY-MM-DD" with a real date in its trailing comment',
        ])
      })

      it('reports a range, a pattern or a bare name instead of one exact name@version', () => {
        for (const entry of [
          'left-pad@^1.0.0',
          'left-pad@1.0.0 || 1.0.1',
          '@scope/*',
          'left-pad',
        ]) {
          const result = check(exclude(`'${entry}' # urgent fix; expires 2099-01-01`))
          expect(result.map((violation) => violation.rule)).toEqual(['pnpm-policy/exclude-entry'])
        }
      })
    })

    describe('catalog', () => {
      const catalog = (...lines: string[]) => ({
        catalog: lines.map((line) => `  ${line}`).join('\n'),
      })

      it('reports every version that is not exact, with its name', () => {
        const bad = [
          '^1.0.0',
          '~1.0.0',
          "'*'",
          '">=1.0.0"',
          'latest',
          '1.1',
          'npm:other@^1.0.0',
          'npm:other@latest',
        ]
        const result = check(catalog(...bad.map((version, index) => `dep${index}: ${version}`)))
        expect(result.map((violation) => violation.rule)).toEqual(
          Array.from({ length: bad.length }, () => 'pnpm-policy/catalog-version'),
        )
        expect(result[0]?.message).toBe(
          'catalog.dep0 is "^1.0.0": catalog versions are exact (no ^, ~, * or range)',
        )
        expect(result[5]?.message).toBe(
          'catalog.dep5 is 1.1: catalog versions are exact (no ^, ~, * or range)',
        )
      })

      it('accepts exact versions, prereleases and exact npm aliases', () => {
        expect(
          check(catalog('a: 1.0.0', 'b: 2.0.0-rc.1', 'c: npm:@scope/c@3.0.0', 'd: npm:d@4.5.6')),
        ).toEqual([])
      })

      it('reports a catalog that is not sorted', () => {
        expect(check(catalog('b: 1.0.0', 'a: 1.0.0'))).toEqual([
          {
            rule: 'pnpm-policy/catalog-unsorted',
            file: 'pnpm-workspace.yaml',
            message: 'catalog must stay sorted: expected a, b',
          },
        ])
      })

      it('checks named catalogs as well', () => {
        const text = `${workspace()}catalogs:\n  legacy:\n    old: ^1.0.0\n`
        expect(messages(text)).toEqual([
          'pnpm-policy/catalog-version: catalogs.legacy.old is "^1.0.0": catalog versions are exact (no ^, ~, * or range)',
        ])
      })

      it('knows what an exact version is', () => {
        expect(isExactCatalogVersion('10.20.30')).toBe(true)
        expect(isExactCatalogVersion('npm:@a/b@1.2.3')).toBe(true)
        expect(isExactCatalogVersion('1.2')).toBe(false)
        expect(isExactCatalogVersion(1.2)).toBe(false)
        expect(isExactCatalogVersion('npm:@a/b@^1.2.3')).toBe(false)
      })
    })

    it('reports a packageManager without its hash, or with a short one', () => {
      const roots = [
        { name: 'root', packageManager: 'pnpm@12.11.2' },
        { name: 'root', packageManager: 'pnpm@12.11.2+sha512.abc' },
        { name: 'root', packageManager: `yarn@4.0.0+sha512.${HASH}` },
        { name: 'root' },
      ]
      for (const root of roots) {
        const result = check({}, root)
        expect(result.map((violation) => violation.rule)).toEqual(['pnpm-policy/package-manager'])
        expect(result[0]?.file).toBe('package.json')
      }
      expect(check({}, roots[0])[0]?.message).toBe(
        '"packageManager" must pin pnpm with its hash, "pnpm@<version>+sha512.<128 hex digits>", found "pnpm@12.11.2"',
      )
    })

    it('reports a workspace file that is not valid YAML', () => {
      const result = check('catalog: [unclosed\n')
      expect(result.some((violation) => violation.rule === 'pnpm-policy/invalid-yaml')).toBe(true)
    })
  })
})
