import { describe, expect, it } from 'vite-plus/test'
import { exceptionValues, WORKERS_WITHOUT_EVENTS } from '../guards/exceptions.ts'
import { describeViolations } from '../guards/types.ts'
import { checkWranglerFlags } from '../guards/wrangler-flags.ts'
import { file } from '../support/fixtures.ts'
import { readRepoFiles } from '../support/repo.ts'

const isWranglerConfig = (path: string) => /(^|\/)wrangler\.jsonc$/.test(path)

describe('wrangler flags', () => {
  it('every Worker opts out of Node.js compatibility, and Hollware sends no wrangler telemetry', () => {
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
    expect(
      describeViolations(
        checkWranglerFlags({
          configs,
          workersWithoutEvents: exceptionValues(WORKERS_WITHOUT_EVENTS),
        }),
      ),
    ).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const check = (path: string, text: string, workersWithoutEvents: string[] = []) =>
      checkWranglerFlags({ configs: [file(path, text)], workersWithoutEvents })

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

    const flags = '"compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2"]'
    const hollwareFlags =
      '"compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2", "global_fetch_strictly_public"]'
    const db = '"d1_databases": [{ "binding": "DB" }]'
    const kv = '"kv_namespaces": [{ "binding": "OAUTH_KV" }]'
    const cron = '"triggers": { "crons": ["* * * * *"] }'
    const consumer = '"queues": { "consumers": [{ "queue": "e", "dead_letter_queue": "e-dlq" }] }'
    const worker = (top: string, demo: string) =>
      `{ ${hollwareFlags}, "send_metrics": false, ${top}, "env": { "demo": { ${demo} } } }`

    it('holds a Worker of Hollware to the OAuth server: the flag, and OAUTH_KV in every environment', () => {
      expect(
        check(
          'apps/x/wrangler.jsonc',
          `{ ${flags}, "send_metrics": false, ${db}, ${kv}, ${cron}, ${consumer}, "env": { "demo": { ${db}, ${cron}, ${consumer} } } }`,
        ),
      ).toEqual([
        {
          rule: 'wrangler-flags/oauth',
          file: 'apps/x/wrangler.jsonc',
          message:
            '"compatibility_flags" must list "global_fetch_strictly_public": the OAuth server fetches the metadata documents of clients over the public internet only',
        },
        {
          rule: 'wrangler-flags/oauth',
          file: 'apps/x/wrangler.jsonc',
          message:
            'env.demo must bind a KV namespace as "OAUTH_KV": the OAuth server keeps its clients, grants and tokens there',
        },
      ])
      expect(check('examples/x/wrangler.jsonc', `{ ${flags}, "send_metrics": false }`)).toEqual([])
    })

    it('accepts a Worker of Hollware with its cron trigger and dead-letter queue in every environment', () => {
      const all = `${db}, ${kv}, ${cron}, ${consumer}`
      expect(check('apps/x/wrangler.jsonc', worker(all, all))).toEqual([])
    })

    it('reports a Worker of Hollware without a cron trigger, or whose consumer has no dead-letter queue', () => {
      const top = `${db}, ${kv}, ${cron}, ${consumer}`
      const noDeadLetters = '"queues": { "consumers": [{ "queue": "e", "max_retries": 5 }] }'
      expect(check('apps/x/wrangler.jsonc', worker(top, `${db}, ${kv}, ${noDeadLetters}`))).toEqual(
        [
          {
            rule: 'wrangler-flags/events',
            file: 'apps/x/wrangler.jsonc',
            message:
              'env.demo must declare a cron trigger: it publishes the scheduled entries whose time has come',
          },
          {
            rule: 'wrangler-flags/events',
            file: 'apps/x/wrangler.jsonc',
            message:
              'env.demo must consume a queue with a "dead_letter_queue": it delivers the publication events and keeps the ones it could not',
          },
        ],
      )
      expect(
        check(
          'apps/x/wrangler.jsonc',
          `{ ${hollwareFlags}, "send_metrics": false, ${db}, ${kv}, ${consumer} }`,
        ).map((violation) => violation.message),
      ).toEqual([
        'the top of the config must declare a cron trigger: it publishes the scheduled entries whose time has come',
      ])
    })

    it('excuses a Worker of WORKERS_WITHOUT_EVENTS, and reports the exception once it no longer applies', () => {
      const bare = `{ ${hollwareFlags}, "send_metrics": false, ${db}, ${kv} }`
      expect(check('tests/x/wrangler.jsonc', bare, ['tests/x/wrangler.jsonc'])).toEqual([])
      const all = `${db}, ${kv}, ${cron}, ${consumer}`
      expect(
        check('tests/x/wrangler.jsonc', worker(all, all), [
          'tests/x/wrangler.jsonc',
          'gone/wrangler.jsonc',
        ]),
      ).toEqual([
        {
          rule: 'wrangler-flags/stale-exception',
          file: 'tests/guards/exceptions.ts',
          message:
            'WORKERS_WITHOUT_EVENTS names tests/x/wrangler.jsonc, which is no Worker of Hollware without its cron trigger or dead-letter queue: remove it',
        },
        {
          rule: 'wrangler-flags/stale-exception',
          file: 'tests/guards/exceptions.ts',
          message:
            'WORKERS_WITHOUT_EVENTS names gone/wrangler.jsonc, which is no Worker of Hollware without its cron trigger or dead-letter queue: remove it',
        },
      ])
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
