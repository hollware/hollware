// Fails when:
// - "passes a project like the starter, migrated and with an owner": a check fails on what the
//   starter has, or the answer stops saying that everything is in place.
// - "says each problem of the config with its fix": a missing flag, a public URL that is no URL,
//   a missing D1 binding, KV binding or admin goes unreported, or comes without its fix.
// - "says what the database lacks": pending migrations or a missing owner go unreported, or the
//   owner is looked up before the migrations are known to be there.
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
  "d1_databases": [
    { "binding": "DB", "database_name": "x", "migrations_dir": "node_modules/@hollware/server/migrations" },
  ],
}
`

/** The files of an installed starter: the migrations and the built admin. */
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
      // The admin's directory is named, but nothing is installed there.
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
      'FAIL  the static assets do not hold the admin',
      '      Install the dependencies; assets.directory of wrangler.jsonc must be "node_modules/@hollware/admin/dist/client".',
      'ok    the local database has every migration',
      'ok    the local database has an owner',
    ])
    expect(err).toEqual(['hollware doctor: 5 problems to fix.'])
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
      '      Run "hollware init --site <key> --local", with the key of your site in hollware.config.ts.',
    ])
    expect(second.err).toEqual(['hollware doctor: 1 problem to fix.'])
  })
})
