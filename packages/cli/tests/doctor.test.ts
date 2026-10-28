import { describe, expect, it } from 'vite-plus/test'

import { d1, fakeWrangler, ok } from './support/fake-wrangler.ts'
import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'

const temp = tempDirs()

const STARTER = `{
  "compatibility_flags": ["no_nodejs_compat", "no_nodejs_compat_v2", "global_fetch_strictly_public"],
  "assets": { "directory": "node_modules/@hollware/admin/dist/client" },
  "vars": { "HOLLWARE_PUBLIC_URL": "http://localhost:5199" },
  "kv_namespaces": [{ "binding": "OAUTH_KV" }],
  "r2_buckets": [
    { "binding": "MEDIA", "bucket_name": "my-hollware-media" },
    { "binding": "BACKUPS", "bucket_name": "my-hollware-backups" },
  ],
  "images": { "binding": "IMAGES" },
  "triggers": { "crons": ["* * * * *"] },
  "queues": {
    "producers": [{ "binding": "EVENTS", "queue": "hollware-events" }],
    "consumers": [
      { "queue": "hollware-events", "max_retries": 5, "dead_letter_queue": "hollware-events-dlq" },
      { "queue": "hollware-events-dlq" },
    ],
  },
  "ratelimits": [{ "name": "HOLLWARE_RATE_LIMIT", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } }],
  "d1_databases": [
    { "binding": "DB", "database_name": "x", "migrations_dir": "node_modules/@hollware/server/migrations" },
  ],
}
`

const INSTALLED = {
  'node_modules/@hollware/server/migrations/0000_init.sql': 'CREATE TABLE t (id TEXT);',
  'node_modules/@hollware/admin/dist/client/admin/index.html': '<!doctype html>',
}

const NONE_PENDING = '✅ No migrations to apply!'

describe('hollware doctor', () => {
  it('passes a project like the starter, migrated and with an owner', async () => {
    const wrangler = fakeWrangler(ok(NONE_PENDING), d1([{ id: 'usr_1', site: 'blog' }]))
    const cwd = temp.make({ 'wrangler.jsonc': STARTER, ...INSTALLED })

    const { code, out, err } = await run(['doctor'], { cwd, wrangler: wrangler.run })

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out).toEqual([
      [
        'ok    compatibility_flags has no_nodejs_compat, no_nodejs_compat_v2, global_fetch_strictly_public',
        'ok    HOLLWARE_PUBLIC_URL is http://localhost:5199',
        'ok    the D1 binding "DB" has 1 migrations',
        'ok    the KV binding "OAUTH_KV" is there',
        'ok    the R2 bucket "MEDIA" keeps the images of the sites',
        'ok    the R2 bucket "BACKUPS" keeps the daily backups, apart from the images',
        'ok    the Images binding "IMAGES" converts each image once, by the media setting of its site',
        'ok    the cron runs * * * * *',
        'ok    the queue "hollware-events" carries the events of publications',
        'ok    the queue "hollware-events-dlq" keeps the events given up on, for the admin to send again',
        'ok    the rate limit "HOLLWARE_RATE_LIMIT" guards sign-in and tokens',
        'ok    the admin is built, in the static assets',
        'ok    the local database has every migration',
        'ok    the local database has an owner',
      ].join('\n'),
      'Everything Hollware needs is in place.',
    ])
  })

  it('says each problem of the config with its fix', async () => {
    const wrangler = fakeWrangler(ok(NONE_PENDING), d1([{ id: 'usr_1' }]))
    const cwd = temp.make({
      'wrangler.jsonc': `{ "compatibility_flags": ["no_nodejs_compat"], "vars": { "HOLLWARE_PUBLIC_URL": "cms" }, "assets": { "directory": "node_modules/@hollware/admin/dist/client" } }`,
    })

    const { code, out, err } = await run(['doctor'], { cwd, wrangler: wrangler.run })

    expect(code).toBe(1)
    expect(out[0]?.split('\n')).toEqual([
      'FAIL  compatibility_flags lacks no_nodejs_compat_v2, global_fetch_strictly_public',
      '      Add "no_nodejs_compat_v2", "global_fetch_strictly_public" to compatibility_flags in wrangler.jsonc.',
      'FAIL  HOLLWARE_PUBLIC_URL is missing or is no http or https URL',
      '      Set vars.HOLLWARE_PUBLIC_URL in wrangler.jsonc to the public URL of the Worker, such as https://cms.example.com.',
      'FAIL  there is no D1 binding "DB"',
      '      Add it to d1_databases in wrangler.jsonc, as the starter has it.',
      'FAIL  there is no KV binding "OAUTH_KV", which the OAuth server needs',
      '      Add { "binding": "OAUTH_KV" } to kv_namespaces in wrangler.jsonc.',
      'FAIL  there is no R2 bucket "MEDIA", so upload_asset answers unavailable',
      '      Add { "binding": "MEDIA", "bucket_name": "<name>-media" } to r2_buckets in wrangler.jsonc; hollware deploy creates the bucket.',
      'ok    there is no R2 bucket "BACKUPS": the daily backups share the bucket of the images (add { "binding": "BACKUPS", "bucket_name": "<name>-backups" } to r2_buckets to keep them apart)',
      'ok    there is no Images binding "IMAGES": images are kept as they come, unconverted (add "images": { "binding": "IMAGES" } to convert them)',
      'FAIL  there is no cron trigger, so scheduled entries are never published',
      '      Add "triggers": { "crons": ["* * * * *"] } to wrangler.jsonc, as the starter has it.',
      'FAIL  there is no queue producer "EVENTS", so webhooks and IndexNow wait for the cron',
      '      Add the producer { "binding": "EVENTS", "queue": "<name>-events" } and its consumer to queues in wrangler.jsonc, as the starter has them.',
      'FAIL  there is no rate limit "HOLLWARE_RATE_LIMIT", so sign-in and the token endpoint take any number of tries',
      '      Add { "name": "HOLLWARE_RATE_LIMIT", "namespace_id": "1001", "simple": { "limit": 60, "period": 60 } } to ratelimits in wrangler.jsonc.',
      'FAIL  the static assets do not hold the admin',
      '      Install the dependencies; assets.directory of wrangler.jsonc must be "node_modules/@hollware/admin/dist/client".',
      'ok    the local database has every migration',
      'ok    the local database has an owner',
    ])
    expect(err).toEqual(['hollware doctor: 9 problems to fix.'])
  })

  it('says when the events queue has a producer but nothing here consumes it', async () => {
    const wrangler = fakeWrangler(ok(NONE_PENDING), d1([{ id: 'usr_1' }]))
    const cwd = temp.make({
      'wrangler.jsonc': STARTER.replace(
        /"consumers": \[[^\]]*\]/,
        '"consumers": [{ "queue": "another-queue" }]',
      ),
      ...INSTALLED,
    })

    const { code, out } = await run(['doctor'], { cwd, wrangler: wrangler.run })

    expect(code).toBe(1)
    expect(out[0]?.split('\n')).toContain(
      'FAIL  the queue "hollware-events" has no consumer here, so its events are never delivered',
    )
  })

  it('says when the dead-letter queue of the events is missing, or nothing here consumes it', async () => {
    const answers = []
    for (const consumers of [
      '"consumers": [{ "queue": "hollware-events", "max_retries": 5 }]',
      '"consumers": [{ "queue": "hollware-events", "dead_letter_queue": "hollware-events-dlq" }]',
    ]) {
      const wrangler = fakeWrangler(ok(NONE_PENDING), d1([{ id: 'usr_1' }]))
      const cwd = temp.make({
        'wrangler.jsonc': STARTER.replace(/"consumers": \[[^\]]*\]/, consumers),
        ...INSTALLED,
      })
      const { code, out } = await run(['doctor'], { cwd, wrangler: wrangler.run })
      answers.push([code, ...(out[0]?.split('\n').filter((line) => line.includes('dlq')) ?? [])])
    }

    expect(answers).toEqual([
      [
        1,
        'FAIL  the consumer of "hollware-events" has no "dead_letter_queue": "hollware-events-dlq", so an event it gives up on is lost',
        '      Give the consumer of "hollware-events" "dead_letter_queue": "hollware-events-dlq", and add the consumer { "queue": "hollware-events-dlq" } to queues in wrangler.jsonc, as the starter has them.',
      ],
      [
        1,
        'FAIL  nothing here consumes "hollware-events-dlq", so the events given up on are lost after four days',
        '      Give the consumer of "hollware-events" "dead_letter_queue": "hollware-events-dlq", and add the consumer { "queue": "hollware-events-dlq" } to queues in wrangler.jsonc, as the starter has them.',
      ],
    ])
  })

  it('says what the database lacks: its migrations first, then its owner', async () => {
    const pending = fakeWrangler(
      ok(
        'Migrations to be applied:\n┌──────────┐\n│ Name     │\n├──────────┤\n│ 0007.sql │\n└──────────┘\n',
      ),
    )
    const noOwner = fakeWrangler(ok(NONE_PENDING), d1([]))
    const cwd = temp.make({ 'wrangler.jsonc': STARTER, ...INSTALLED })

    const first = await run(['doctor', '--remote'], { cwd, wrangler: pending.run })
    const second = await run(['doctor'], { cwd, wrangler: noOwner.run })

    expect(first.code).toBe(1)
    expect(first.out[0]?.split('\n').slice(-2)).toEqual([
      'FAIL  the remote database lacks 1 migration',
      '      Run "hollware migrate --remote".',
    ])
    expect(pending.calls.map((call) => call.args)).toEqual([
      ['d1', 'migrations', 'list', 'DB', '--remote'],
    ])
    expect(second.out[0]?.split('\n').slice(-2)).toEqual([
      'FAIL  the local database has no owner yet',
      '      Run "hollware init --site <key> --local", with the key your site is to have, such as my-site.',
    ])
    expect(second.err).toEqual(['hollware doctor: 1 problem to fix.'])
  })
})
