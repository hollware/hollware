import { describe, expect, it } from 'vite-plus/test'
import { describeViolations } from '../guards/types.ts'
import { checkWranglerFlags } from '../guards/wrangler-flags.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

// Fails when: a wrangler.jsonc stops listing both no_nodejs_compat and no_nodejs_compat_v2, lists
// nodejs_compat or nodejs_compat_v2, or, outside templates/, stops setting send_metrics to false.

const isWranglerConfig = (path: string) => /(^|\/)wrangler\.jsonc$/.test(path)

describe('wrangler flags', () => {
  it('every Worker opts out of Node.js compatibility, and Hollware sends no wrangler telemetry', () => {
    const configs = readRepoFiles(isWranglerConfig)
    expect(configs.map((config) => config.path)).toEqual([
      'apps/playground/wrangler.jsonc',
      'examples/worker-site/wrangler.jsonc',
      'packages/server/wrangler.jsonc',
      'templates/starter/wrangler.jsonc',
    ])
    expect(describeViolations(checkWranglerFlags({ configs }))).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (path: string, text: string) =>
      checkWranglerFlags({ configs: [file(path, text)] })

    it('accepts both opt-outs, in JSONC with comments, and telemetry off', () => {
      const text = [
        '{',
        '  // Node.js stays off.',
        '  "compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2"],',
        '  "send_metrics": false,',
        '}',
      ].join('\n')
      expect(check('apps/x/wrangler.jsonc', text)).toEqual([])
    })

    it('reports a config with one opt-out, or none, naming what is missing', () => {
      expect(
        check(
          'apps/x/wrangler.jsonc',
          '{ "compatibility_flags": ["no_nodejs_compat"], "send_metrics": false }',
        ),
      ).toEqual([
        {
          rule: 'wrangler-flags/node-compat',
          file: 'apps/x/wrangler.jsonc',
          message:
            '"compatibility_flags" must list ["no_nodejs_compat","no_nodejs_compat_v2"]: Node.js compatibility is on by default from the 2026-08-04 compatibility date, and Hollware runs without it; missing ["no_nodejs_compat_v2"]',
        },
      ])
      expect(
        check('apps/x/wrangler.jsonc', '{ "send_metrics": false }').map((v) => v.message),
      ).toEqual([
        '"compatibility_flags" must list ["no_nodejs_compat","no_nodejs_compat_v2"]: Node.js compatibility is on by default from the 2026-08-04 compatibility date, and Hollware runs without it; missing ["no_nodejs_compat","no_nodejs_compat_v2"]',
      ])
    })

    it('reports a config that turns Node.js compatibility back on', () => {
      const text =
        '{ "compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2", "nodejs_compat"], "send_metrics": false }'
      expect(check('apps/x/wrangler.jsonc', text)).toEqual([
        {
          rule: 'wrangler-flags/node-compat',
          file: 'apps/x/wrangler.jsonc',
          message:
            '"compatibility_flags" turns Node.js compatibility on with ["nodejs_compat"]: Hollware runs without it',
        },
      ])
    })

    it('reports telemetry left on in a config of Hollware, but not in a template', () => {
      const flags = '"compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2"]'
      expect(check('apps/x/wrangler.jsonc', `{ ${flags} }`)).toEqual([
        {
          rule: 'wrangler-flags/send-metrics',
          file: 'apps/x/wrangler.jsonc',
          message:
            '"send_metrics" must be false, so no wrangler command of this repository sends telemetry, found undefined',
        },
      ])
      expect(check('templates/starter/wrangler.jsonc', `{ ${flags} }`)).toEqual([])
    })

    it('reports a file that is not JSONC holding an object', () => {
      expect(check('apps/x/wrangler.jsonc', '[]')).toEqual([
        {
          rule: 'wrangler-flags/invalid',
          file: 'apps/x/wrangler.jsonc',
          message: 'the file is not valid JSONC holding an object',
        },
      ])
    })
  })
})
