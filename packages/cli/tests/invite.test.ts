import { describe, expect, it } from 'vite-plus/test'

import { d1, fakeWrangler } from './support/fake-wrangler.ts'
import { run } from './support/io.ts'
import { tempDirs, WRANGLER_JSONC } from './support/project.ts'

// Fails when: `hollware invite` (src/commands/invite.ts) stops inserting one invitation with the
// role asked, no person, the hash of its secret and its expiry, stops printing the link once with
// the URL of the project, or takes a role other than editor and author; or, with --owner, stops
// making the link for the owner of the site, or makes one for a site with no owner.

const temp = tempDirs()
const SITES = 'SELECT id FROM sites ORDER BY id;'

function project() {
  const cwd = temp.make({
    'wrangler.jsonc': WRANGLER_JSONC.replace(
      '{',
      '{ "vars": { "HOLLWARE_PUBLIC_URL": "https://cms.example.com" },',
    ),
  })
  const wrangler = fakeWrangler(d1([{ id: 'blog' }]), d1([]))
  return { wrangler, run: (argv: string[]) => run(argv, { cwd, wrangler: wrangler.run }) }
}

describe('hollware invite', () => {
  it('inserts the invitation and prints its link once', async () => {
    const { wrangler, run: invite } = project()

    const { code, out, err } = await invite(['invite', '--role', 'author'])

    expect([code, err]).toEqual([0, []])
    expect(wrangler.calls.map((call) => call.args[6]?.split(' (')[0])).toEqual([
      SITES,
      'INSERT INTO invitations',
    ])
    expect(wrangler.calls[1]?.args[6]).toMatch(
      /^INSERT INTO invitations \(id, site_id, hash, role, user_id, expires_at, used_at, created_at, updated_at\) VALUES \('inv_[0-9A-Z]{26}', 'blog', '[0-9a-f]{64}', 'author', NULL, '2026-10-19T12:00:00.000Z', NULL, /,
    )
    expect(out).toEqual([
      [
        'Invited an author to the site "blog". The link works once, until 2026-10-19T12:00:00.000Z:',
        '',
        '  https://cms.example.com/setup#invitation=hw_inv_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE',
      ].join('\n'),
    ])
  })

  it('makes a setup link for the owner of the site with --owner', async () => {
    const cwd = temp.make({
      'wrangler.jsonc': WRANGLER_JSONC.replace(
        '{',
        '{ "vars": { "HOLLWARE_PUBLIC_URL": "https://cms.example.com" },',
      ),
    })
    const wrangler = fakeWrangler(d1([{ id: 'blog' }]), d1([{ id: 'usr_OWNER' }]), d1([]))

    const { code, out } = await run(['invite', '--owner'], { cwd, wrangler: wrangler.run })

    expect(code).toBe(0)
    expect(wrangler.calls[1]?.args[6]).toBe(
      "SELECT user_id AS id FROM members WHERE site_id = 'blog' AND role = 'owner' ORDER BY created_at, user_id LIMIT 1;",
    )
    expect(wrangler.calls[2]?.args[6]).toMatch(/'blog', '[0-9a-f]{64}', 'owner', 'usr_OWNER', /)
    expect(out[0]).toMatch(/^A setup link for the owner \(usr_OWNER\) of the site "blog"/)
  })

  it('says so when the site has no owner, and refuses --owner with --role', async () => {
    const cwd = temp.make({ 'wrangler.jsonc': WRANGLER_JSONC })
    const wrangler = fakeWrangler(d1([{ id: 'blog' }]), d1([]))

    const none = await run(['invite', '--owner', '--url', 'https://cms.example.com'], {
      cwd,
      wrangler: wrangler.run,
    })
    const both = await run(['invite', '--owner', '--role', 'author'], {
      cwd,
      wrangler: wrangler.run,
    })

    expect(none.err).toEqual([
      'hollware invite: the site "blog" has no owner. Run "hollware init" to make one.',
    ])
    expect(both.code).toBe(1)
  })

  it('refuses a role other than editor and author', async () => {
    const { run: invite } = project()

    const { code, err } = await invite(['invite', '--role', 'owner'])

    expect([code, err]).toEqual([
      1,
      [
        'hollware invite: --role is required, and it is editor or author. Run "hollware invite --help" for the options.',
      ],
    ])
  })
})
