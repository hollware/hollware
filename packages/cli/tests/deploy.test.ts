// Fails when:
// - "deploys, sets the workers.dev URL, deploys again and migrates": a project whose public URL is
//   localhost keeps it (no rewrite of wrangler.jsonc, no second deploy), the rewrite touches more
//   than the one value (comments, other keys), the remote migrations are not applied, or the
//   next step for a database without an owner is not said.
// - "keeps a public URL that is not localhost, and deploys once": a configured public URL is
//   replaced by the workers.dev one, or the Worker is deployed twice for nothing.
// - "takes --url over both": `--url` is ignored, or written as given and not as its origin.
// - "stops when wrangler cannot deploy …": a failed deploy goes on to migrate.
// - "stops when it can tell no public URL": a deploy that prints no workers.dev URL, with a
//   localhost URL, goes on without one.
// - "reads the workers.dev URL …": `workersDevUrlOf` misses the URL among wrangler's colors, or
//   takes another host for it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { withPublicUrl, workersDevUrlOf } from '../src/commands/deploy.ts'
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
        'Commit wrangler.jsonc: it holds the ids of what the deploy created, and the public URL.',
        '',
        'Next: create your site and its owner in the remote database. It prints a token for your',
        'agents and a link to set up your passkey; shape the site in the admin afterwards:',
        '  hollware init --site <key> --remote',
      ].join('\n'),
    ])
  })

  it('keeps a public URL that is not localhost, and deploys once', async () => {
    const wrangler = fakeWrangler(
      ok(DEPLOYED),
      ok(HAS_MASTER),
      ok('✅ No migrations to apply!'),
      d1([{ id: 'usr_1', site: 'blog' }]),
    )
    const project = setup(wrangler, 'https://cms.example.com')

    const { code, out } = await project.run(['deploy'])

    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args[0])).toEqual(['deploy', 'secret', 'd1', 'd1'])
    expect(project.config()).toBe(wranglerJsonc('https://cms.example.com'))
    expect(out.at(-1)).toBe(
      [
        'Hollware is live at https://cms.example.com.',
        '',
        '  MCP    https://cms.example.com/mcp',
        '  Admin  https://cms.example.com/admin/',
        '',
        'Commit wrangler.jsonc: it holds the ids of what the deploy created, and the public URL.',
      ].join('\n'),
    )
  })

  it('takes --url over both, as its origin', async () => {
    const wrangler = fakeWrangler(
      ok(DEPLOYED),
      ok(DEPLOYED),
      ok(HAS_MASTER),
      ok('✅ No migrations to apply!'),
      d1([{ id: 'usr_1' }]),
    )
    const project = setup(wrangler, 'https://old.example.com')

    const { code } = await project.run(['deploy', '--url', 'https://cms.example.com/admin/'])

    expect(code).toBe(0)
    expect(project.config()).toBe(wranglerJsonc('https://cms.example.com'))
  })

  it('stops when wrangler cannot deploy, and migrates nothing', async () => {
    const wrangler = fakeWrangler(failed('✘ [ERROR] Not logged in.\n'))
    const project = setup(wrangler, 'http://localhost:5199')

    const { code, err } = await project.run(['deploy'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware deploy: wrangler could not deploy: Not logged in.. Is wrangler logged in ("wrangler login")?',
    ])
    expect(wrangler.calls).toHaveLength(1)
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
})
