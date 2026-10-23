import { describe, expect, it } from 'vite-plus/test'
import { unstable_getDevCompatibilityDate } from 'wrangler'
import { checkWranglerDates } from '../guards/wrangler-dates.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles, repoFiles } from '../support/repo.ts'

const isWranglerConfig = (path: string) => /(^|\/)wrangler\.jsonc$/.test(path)

describe('wrangler compatibility dates', () => {
  it('no wrangler.jsonc is newer than the workerd that wrangler bundles', () => {
    const configs = readRepoFiles(isWranglerConfig)
    expect(configs.map((config) => config.path)).toEqual([
      'apps/playground/wrangler.jsonc',
      'apps/web/wrangler.jsonc',
      'examples/agents-worker/wrangler.jsonc',
      'examples/astro-blog/wrangler.jsonc',
      'examples/nuxt-blog/wrangler.jsonc',
      'examples/react-router-blog/wrangler.jsonc',
      'examples/worker-site/wrangler.jsonc',
      'packages/server/wrangler.jsonc',
      'templates/starter/wrangler.jsonc',
      'tests/conformance/worker/wrangler.jsonc',
    ])
    const violations = checkWranglerDates({
      configs,
      otherFormats: repoFiles().filter((path) => /(^|\/)wrangler\.(toml|json)$/.test(path)),
      latestSupported: unstable_getDevCompatibilityDate(),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (text: string, latestSupported = '2026-10-06', otherFormats: string[] = []) =>
      checkWranglerDates({
        configs: [file('apps/x/wrangler.jsonc', text)],
        otherFormats,
        latestSupported,
      })

    it('accepts a date equal to or older than the latest supported, in real JSONC', () => {
      const jsonc = `{
        // comments, "quotes" and URLs with // inside are fine
        "$schema": "https://example.com/schema.json",
        /* block */ "compatibility_date": "2026-10-06", // trailing comment
        "d1_databases": [{ "binding": "DB", },],
      }`
      expect(check(jsonc)).toEqual([])
      expect(check('{ "compatibility_date": "2025-01-01" }')).toEqual([])
    })

    it('reports a date newer than the latest supported', () => {
      expect(check('{ "compatibility_date": "2099-01-01" }')).toEqual([
        {
          rule: 'wrangler-dates/too-new',
          file: 'apps/x/wrangler.jsonc',
          message:
            '"compatibility_date" 2099-01-01 is newer than 2026-10-06, the latest date the installed workerd supports: use 2026-10-06 or older',
        },
      ])
      expect(check('{ "compatibility_date": "2026-10-07" }')).toHaveLength(1)
    })

    it('reports a missing or malformed date', () => {
      for (const text of [
        '{ "name": "x" }',
        '{ "compatibility_date": "yesterday" }',
        '{ "compatibility_date": 20261006 }',
      ]) {
        const result = check(text)
        expect(result.map((violation) => violation.rule)).toEqual(['wrangler-dates/missing'])
      }
      expect(check('{ "name": "x" }')[0]?.message).toBe(
        '"compatibility_date" must be a YYYY-MM-DD date, found undefined',
      )
    })

    it('reports a file that is not JSONC', () => {
      expect(check('{ "compatibility_date": ')).toEqual([
        {
          rule: 'wrangler-dates/invalid',
          file: 'apps/x/wrangler.jsonc',
          message: 'the file is not valid JSONC holding an object',
        },
      ])
    })

    it('reports a Worker config in another format, which the guard cannot read', () => {
      expect(
        check('{ "compatibility_date": "2026-10-06" }', '2026-10-06', ['apps/y/wrangler.toml']),
      ).toEqual([
        {
          rule: 'wrangler-dates/format',
          file: 'apps/y/wrangler.toml',
          message:
            'Worker configs are wrangler.jsonc only: the compatibility date of any other format is not checked',
        },
      ])
    })
  })
})
