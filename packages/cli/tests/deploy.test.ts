// Fails when:
// - "deploys, sets the workers.dev URL, deploys again and migrates": a project whose public URL is
//   localhost keeps it (no rewrite of wrangler.jsonc, no second deploy), the rewrite touches more
//   than the one value (comments, other keys), the remote migrations are not applied, or the
//   next step for a database without an owner is not said.
// - "keeps a public URL that is not localhost, and deploys once": a configured public URL is
//   replaced by the workers.dev one, or the Worker is deployed twice for nothing.
// - "migrates a database it deployed before, before the new Worker": an upgrade deploys the new
//   Worker first, on a database without its tables, or migrates twice.
// - "migrates after the deploy when wrangler finds no database yet": a project with a public URL
//   and no remote database stops instead of deploying, or is never migrated.
// - "serves a domain of its own …": `--url` is ignored or written as given and not as its origin,
//   the custom domain gets no route (or another host, or a line more than its route), or the Worker
//   is deployed twice.
// - "writes the types again …": deploy rewrites wrangler.jsonc and leaves worker-configuration.d.ts
//   with the old HOLLWARE_PUBLIC_URL (`types:check` fails), or runs `wrangler types` after the
//   deploy instead of before it, or with no such file.
// - "leaves routes of its own …": a config with routes gets a second "routes", or no word on the
//   missing route.
// - "tells a domain of its own …": `customDomainOf` routes localhost or workers.dev, or misses a
//   custom host.
// - "stops when wrangler cannot deploy …": a failed deploy goes on to migrate.
// - "stops when it can tell no public URL": a deploy that prints no workers.dev URL, with a
//   localhost URL, goes on without one.
// - "reads the workers.dev URL …": `workersDevUrlOf` misses the URL among wrangler's colors, or
//   takes another host for it.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import {
  customDomainOf,
  withCustomDomain,
  withPublicUrl,
  workersDevUrlOf,
} from '../src/commands/deploy.ts'
import { d1, failed, fakeWrangler, ok, type FakeWrangler } from './support/fake-wrangler.ts'
import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'

const temp = tempDirs()

/** A `wrangler.jsonc` like the starter's, with its public URL. */
function wranglerJsonc(url: string): string {
  return `{
  "name": "my-hollware",
  "vars": {
    // The only Host and Origin the Worker answers.
    "HOLLWARE_PUBLIC_URL": "${url}",
  },
  "kv_namespaces": [{ "binding": "OAUTH_KV" }],
  "d1_databases": [{ "binding": "DB", "database_name": "my-hollware" }],
}
`
}

/** The same `wrangler.jsonc`, served at `host` as a custom domain: what deploy writes. */
function routedJsonc(url: string, host: string): string {
  return `{
  "name": "my-hollware",
  // The custom domain of the Worker: Cloudflare makes its DNS record and its certificate.
  "routes": [{ "pattern": "${host}", "custom_domain": true }],
  "vars": {
    // The only Host and Origin the Worker answers.
    "HOLLWARE_PUBLIC_URL": "${url}",
  },
  "kv_namespaces": [{ "binding": "OAUTH_KV" }],
  "d1_databases": [{ "binding": "DB", "database_name": "my-hollware" }],
}
`
}

const DEPLOYED = [
  'Total Upload: 1226.60 KiB / gzip: 364.94 KiB',
  'Uploaded my-hollware (4.12 sec)',
  'Deployed my-hollware triggers (1.02 sec)',
  '  \u001B[36mhttps://my-hollware.ada.workers.dev\u001B[39m',
  '  schedule: * * * * *',
].join('\n')
const LIST_ALL_PENDING =
  'Migrations to be applied:\n┌───────────────┐\n│ Name          │\n├───────────────┤\n│ 0000_init.sql │\n└───────────────┘\n'
const APPLIED = '🚣 10 commands executed successfully.\n'
/** What `wrangler secret list` prints: none, or the master secret of Hollware. */
const NO_SECRETS = '[]'
const HAS_MASTER = '[{"name":"HOLLWARE_SECRET","type":"secret_text"}]'

function setup(wrangler: FakeWrangler, url: string) {
  const cwd = temp.make({ 'wrangler.jsonc': wranglerJsonc(url) })
  const scratch = temp.make({})
  return {
    cwd,
    scratch,
    config: () => readFileSync(join(cwd, 'wrangler.jsonc'), 'utf8'),
    run: (argv: string[]) => run(argv, { cwd, wrangler: wrangler.run, tempDir: () => scratch }),
  }
}

describe('hollware deploy', () => {
  it('deploys, sets the workers.dev URL, deploys again and migrates', async () => {
    const wrangler = fakeWrangler(
      ok(DEPLOYED),
      ok(DEPLOYED),
      ok(NO_SECRETS),
      ok('✨ Success! Uploaded 1 secret.'),
      ok(LIST_ALL_PENDING),
      ok(APPLIED),
      d1([]),
    )
    const project = setup(wrangler, 'http://localhost:5199')

    const { code, out, err } = await project.run(['deploy'])

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['deploy'],
      ['deploy'],
      ['secret', 'list'],
      ['secret', 'bulk', join(project.scratch, 'secrets.json')],
      ['d1', 'migrations', 'list', 'DB', '--remote'],
      ['d1', 'migrations', 'apply', 'DB', '--remote'],
      [
        'd1',
        'execute',
        'DB',
        '--remote',
        '--json',
        '--command',
        "SELECT user_id AS id, site_id AS site FROM members WHERE role = 'owner' ORDER BY created_at, user_id",
      ],
    ])
    expect(project.config()).toBe(wranglerJsonc('https://my-hollware.ada.workers.dev'))
    expect(out).toEqual([
      'Deploying with wrangler ...',
      'Set HOLLWARE_PUBLIC_URL to https://my-hollware.ada.workers.dev in wrangler.jsonc. Deploying again with it ...',
      'Made HOLLWARE_SECRET, which seals the secrets Hollware makes, such as those of webhooks.',
      'Applied 1 migration to the remote database "DB":\n  0000_init.sql',
      [
        'Hollware is live at https://my-hollware.ada.workers.dev.',
        '',
        '  MCP    https://my-hollware.ada.workers.dev/mcp',
        '  Admin  https://my-hollware.ada.workers.dev/admin/',
        '',
        'Commit wrangler.jsonc: it holds the public URL, and any id wrangler wrote into it.',
        '',
        'Next: create your site and its owner in the remote database. It prints a token for your',
        'agents and a link to set up your passkey; shape the site in the admin afterwards:',
        '  hollware init --site <key> --remote',
      ].join('\n'),
    ])
  })

  it('keeps a public URL that is not localhost, and deploys once', async () => {
    const wrangler = fakeWrangler(
      ok('✅ No migrations to apply!'),
      ok('✅ No migrations to apply!'),
      ok(DEPLOYED),
      ok(HAS_MASTER),
      d1([{ id: 'usr_1', site: 'blog' }]),
    )
    const project = setup(wrangler, 'https://my-hollware.ada.workers.dev')

    const { code, out } = await project.run(['deploy'])

    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args[0])).toEqual([
      'd1',
      'd1',
      'deploy',
      'secret',
      'd1',
    ])
    expect(project.config()).toBe(wranglerJsonc('https://my-hollware.ada.workers.dev'))
    expect(out.at(-1)).toBe(
      [
        'Hollware is live at https://my-hollware.ada.workers.dev.',
        '',
        '  MCP    https://my-hollware.ada.workers.dev/mcp',
        '  Admin  https://my-hollware.ada.workers.dev/admin/',
        '',
        'Commit wrangler.jsonc: it holds the public URL, and any id wrangler wrote into it.',
      ].join('\n'),
    )
  })

  it('migrates a database it deployed before, before the new Worker', async () => {
    const wrangler = fakeWrangler(
      ok(LIST_ALL_PENDING),
      ok(LIST_ALL_PENDING),
      ok(APPLIED),
      ok(DEPLOYED),
      ok(HAS_MASTER),
      d1([{ id: 'usr_1' }]),
    )
    const project = setup(wrangler, 'https://cms.example.com')
    writeFileSync(
      join(project.cwd, 'wrangler.jsonc'),
      routedJsonc('https://cms.example.com', 'cms.example.com'),
    )

    const { code, out } = await project.run(['deploy'])

    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['d1', 'migrations', 'list'],
      ['d1', 'migrations', 'list'],
      ['d1', 'migrations', 'apply'],
      ['deploy'],
      ['secret', 'list'],
      ['d1', 'execute', 'DB'],
    ])
    expect(out.slice(0, 2)).toEqual([
      'Applied 1 migration to the remote database "DB":\n  0000_init.sql',
      'Deploying with wrangler ...',
    ])
  })

  it('migrates after the deploy when wrangler finds no database yet', async () => {
    const wrangler = fakeWrangler(
      failed("✘ [ERROR] Couldn't find a D1 DB with the name or binding 'DB'.\n"),
      ok(DEPLOYED),
      ok(HAS_MASTER),
      ok(LIST_ALL_PENDING),
      ok(APPLIED),
      d1([]),
    )
    const project = setup(wrangler, 'https://my-hollware.ada.workers.dev')

    const { code } = await project.run(['deploy'])

    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args.slice(0, 3))).toEqual([
      ['d1', 'migrations', 'list'],
      ['deploy'],
      ['secret', 'list'],
      ['d1', 'migrations', 'list'],
      ['d1', 'migrations', 'apply'],
      ['d1', 'execute', 'DB'],
    ])
  })

  it('serves a domain of its own from --url, as its origin, with one deploy', async () => {
    const wrangler = fakeWrangler(
      ok(DEPLOYED),
      ok(HAS_MASTER),
      ok('✅ No migrations to apply!'),
      d1([{ id: 'usr_1' }]),
    )
    const project = setup(wrangler, 'http://localhost:5199')

    const { code, out } = await project.run(['deploy', '--url', 'https://cms.example.com/admin/'])

    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args[0])).toEqual(['deploy', 'secret', 'd1', 'd1'])
    expect(project.config()).toBe(routedJsonc('https://cms.example.com', 'cms.example.com'))
    expect(out[0]).toBe(
      'Serving the Worker at cms.example.com: set HOLLWARE_PUBLIC_URL and its route in wrangler.jsonc.',
    )
  })

  it('writes the types again when it rewrites wrangler.jsonc, before it deploys', async () => {
    const wrangler = fakeWrangler(
      ok('✨ Types written to worker-configuration.d.ts'),
      ok(DEPLOYED),
      ok(HAS_MASTER),
      ok('✅ No migrations to apply!'),
      d1([{ id: 'usr_1' }]),
    )
    const project = setup(wrangler, 'http://localhost:5199')
    writeFileSync(join(project.cwd, 'worker-configuration.d.ts'), '// old types\n')

    const { code, out } = await project.run(['deploy', '--url', 'https://cms.example.com'])

    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args[0])).toEqual([
      'types',
      'deploy',
      'secret',
      'd1',
      'd1',
    ])
    expect(out[1]).toBe('Wrote worker-configuration.d.ts again, for the new wrangler.jsonc.')
  })

  it('leaves routes of its own as they are, and says which route is missing', async () => {
    const wrangler = fakeWrangler(
      ok('✅ No migrations to apply!'),
      ok('✅ No migrations to apply!'),
      ok(DEPLOYED),
      ok(HAS_MASTER),
      d1([{ id: 'usr_1' }]),
    )
    const project = setup(wrangler, 'https://cms.example.com')
    const own = project
      .config()
      .replace(
        '  "vars"',
        '  "routes": [{ "pattern": "example.com/*", "zone_name": "example.com" }],\n  "vars"',
      )
    writeFileSync(join(project.cwd, 'wrangler.jsonc'), own)

    const { code, out } = await project.run(['deploy'])

    expect(code).toBe(0)
    expect(project.config()).toBe(own)
    expect(out[0]).toBe(
      'wrangler.jsonc has routes of its own and none for cms.example.com: add { "pattern": "cms.example.com", "custom_domain": true } to them.',
    )
  })

  it('stops when wrangler cannot deploy, and migrates nothing', async () => {
    const wrangler = fakeWrangler(failed('✘ [ERROR] Not logged in.\n'))
    const project = setup(wrangler, 'http://localhost:5199')

    const { code, err } = await project.run(['deploy'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware deploy: wrangler could not deploy: Not logged in. Is wrangler logged in ("wrangler login")?',
    ])
    expect(wrangler.calls).toHaveLength(1)
  })

  it('says the whole reason, and nothing of logging in when that is not it', async () => {
    const wrangler = fakeWrangler(
      failed(
        '✘ [ERROR] Found both a user configuration file at "wrangler.jsonc"\n  and a deploy configuration file at "../.wrangler/deploy/config.json".\n',
      ),
    )
    const project = setup(wrangler, 'http://localhost:5199')

    const { code, err } = await project.run(['deploy'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware deploy: wrangler could not deploy: Found both a user configuration file at "wrangler.jsonc" and a deploy configuration file at "../.wrangler/deploy/config.json".',
    ])
  })

  it('stops when it can tell no public URL', async () => {
    const wrangler = fakeWrangler(ok('Uploaded my-hollware (4.12 sec)'))
    const project = setup(wrangler, 'http://localhost:5199')

    const { code, err } = await project.run(['deploy'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware deploy: wrangler deployed the Worker but printed no workers.dev URL. Run "hollware deploy --url <the public URL of the Worker>".',
    ])
    expect(project.config()).toBe(wranglerJsonc('http://localhost:5199'))
  })
})

describe('the helpers of deploy', () => {
  it('reads the workers.dev URL among the colors, and no other host', () => {
    expect(workersDevUrlOf(DEPLOYED)).toBe('https://my-hollware.ada.workers.dev')
    expect(workersDevUrlOf('https://my-hollware.ada.workers.dev.evil.example/')).toBe(undefined)
    expect(workersDevUrlOf('Uploaded my-hollware')).toBe(undefined)
  })

  it('changes the one value of the public URL, and refuses a config without it', () => {
    expect(withPublicUrl(wranglerJsonc('http://localhost:5199'), 'https://a.example')).toBe(
      wranglerJsonc('https://a.example'),
    )
    expect(() => withPublicUrl('{ "name": "x" }', 'https://a.example')).toThrow(
      'wrangler.jsonc has no "HOLLWARE_PUBLIC_URL" in "vars".',
    )
  })

  it('tells a domain of its own from this machine and workers.dev', () => {
    expect(
      [
        'https://cms.example.com',
        'https://example.com',
        'https://my-hollware.ada.workers.dev',
        'https://workers.dev',
        'https://notworkers.dev',
        'http://localhost:5199',
        'http://127.0.0.1:5199',
      ].map((url) => customDomainOf(url)),
    ).toEqual([
      'cms.example.com',
      'example.com',
      undefined,
      undefined,
      'notworkers.dev',
      undefined,
      undefined,
    ])
  })

  it('adds the route once, and refuses a config whose name it cannot find', () => {
    const routed = withCustomDomain(wranglerJsonc('https://cms.example.com'), 'cms.example.com')
    expect(routed).toBe(routedJsonc('https://cms.example.com', 'cms.example.com'))
    expect(withCustomDomain(routed, 'other.example.com')).toBe(routed)
    expect(() => withCustomDomain('{ "name": "x" }', 'cms.example.com')).toThrow(
      'wrangler.jsonc has no "name" at its top.',
    )
  })
})
