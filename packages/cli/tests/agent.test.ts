import { describe, expect, it } from 'vite-plus/test'

import { d1, fakeWrangler } from './support/fake-wrangler.ts'
import { run } from './support/io.ts'
import { tempDirs, WRANGLER_JSONC } from './support/project.ts'

const temp = tempDirs()
const SITES = 'SELECT id FROM sites ORDER BY id;'
const USER_ID = 'usr_01M4QZQSG0040G2081040G2081'
const MEMBER_ID = 'mbr_01M4QZQSG0081040G2081040G2'
const AGENT_ID = 'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VW'
const NOW = '2026-10-12T12:00:00.000Z'

function project(...answers: ReturnType<typeof d1>[]) {
  const cwd = temp.make({ 'wrangler.jsonc': WRANGLER_JSONC })
  const wrangler = fakeWrangler(...answers)
  return { wrangler, run: (argv: string[]) => run(argv, { cwd, wrangler: wrangler.run }) }
}

describe('hollware agent add', () => {
  it('inserts the user and its membership in one statement batch and prints the id', async () => {
    const { wrangler, run: agent } = project(d1([{ id: 'blog' }]), d1([], [{ id: USER_ID }]))

    const { code, out, err } = await agent(['agent', 'add', 'seo-auditor'])

    expect([code, err]).toEqual([0, []])
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['d1', 'execute', 'DB', '--local', '--json', '--command', SITES],
      [
        'd1',
        'execute',
        'DB',
        '--local',
        '--json',
        '--command',
        `INSERT INTO users (id, name, role, kind, created_at, updated_at) SELECT '${USER_ID}', 'seo-auditor', 'reviewer', 'agent', '${NOW}', '${NOW}' WHERE NOT EXISTS (SELECT 1 FROM members JOIN users ON users.id = members.user_id WHERE members.site_id = 'blog' AND users.kind = 'agent' AND users.name = 'seo-auditor'); INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) SELECT '${MEMBER_ID}', 'blog', id, 'author', '${NOW}', '${NOW}' FROM users WHERE id = '${USER_ID}' RETURNING user_id AS id;`,
      ],
    ])
    expect(out).toEqual([
      [
        `Added the agent "seo-auditor" to the site "blog": ${USER_ID}`,
        '',
        `Declare it in the "agents" of the site definition, with "member": "${USER_ID}", on the`,
        'Agents page of the admin or with update_site.',
      ].join('\n'),
    ])
  })

  it('prints one object with --json, on the remote database of the site named', async () => {
    const { wrangler, run: agent } = project(
      d1([{ id: 'blog' }, { id: 'docs' }]),
      d1([], [{ id: USER_ID }]),
    )

    const { code, out, err } = await agent([
      'agent',
      'add',
      'reviewer',
      '--site',
      'docs',
      '--remote',
      '--json',
    ])

    expect([code, err]).toEqual([0, []])
    expect(wrangler.calls[1]?.args.slice(0, 4)).toEqual(['d1', 'execute', 'DB', '--remote'])
    expect(wrangler.calls[1]?.args[6]).toContain(
      "INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) SELECT 'mbr_01M4QZQSG0081040G2081040G2', 'docs', id,",
    )
    expect(out.map((line) => JSON.parse(line))).toEqual([
      { site: 'docs', id: USER_ID, name: 'reviewer' },
    ])
  })

  it('refuses a name the site already has for an agent', async () => {
    const { run: agent } = project(d1([{ id: 'blog' }]), d1([], []))

    const { code, out, err } = await agent(['agent', 'add', 'reviewer'])

    expect([code, out, err]).toEqual([
      1,
      [],
      [
        'hollware agent add: the site "blog" already has an agent named "reviewer". "hollware agent list" shows its id.',
      ],
    ])
  })

  it.each([
    "x'); DROP TABLE users; --",
    'Reviewer',
    'seo_auditor',
    'reviewer-',
    'seo--auditor',
    'a'.repeat(65),
  ])('refuses the name %j before it calls wrangler', async (name) => {
    const { wrangler, run: agent } = project()

    const { code, err } = await agent(['agent', 'add', name])

    expect(code).toBe(1)
    expect(err).toEqual([
      expect.stringMatching(
        /^hollware agent add: invalid agent name .*: use lowercase letters and digits joined by single hyphens, up to 64 characters/,
      ),
    ])
    expect(wrangler.calls).toEqual([])
  })

  it('takes a name of 64 characters', async () => {
    const { run: agent } = project(d1([{ id: 'blog' }]), d1([], [{ id: USER_ID }]))

    const { code } = await agent(['agent', 'add', 'a'.repeat(64)])

    expect(code).toBe(0)
  })
})

describe('hollware agent list', () => {
  it('lists the agent members of the site, and says so when it has none', async () => {
    const { wrangler, run: agent } = project(
      d1([{ id: 'blog' }]),
      d1([{ id: AGENT_ID, name: 'reviewer', since: NOW }]),
      d1([{ id: 'blog' }]),
      d1([]),
    )

    const listed = await agent(['agent', 'list'])
    const empty = await agent(['agent', 'list'])

    expect(wrangler.calls[1]?.args[6]).toBe(
      "SELECT users.id AS id, users.name AS name, members.created_at AS since FROM members JOIN users ON users.id = members.user_id WHERE members.site_id = 'blog' AND users.kind = 'agent' ORDER BY members.created_at, users.id;",
    )
    expect(listed.out).toEqual([
      ['ID                              NAME      SINCE', `${AGENT_ID}  reviewer  ${NOW}`].join(
        '\n',
      ),
    ])
    expect(empty.out).toEqual(['The site "blog" has no agent members.'])
  })

  it('prints one object with --json', async () => {
    const { run: agent } = project(
      d1([{ id: 'blog' }]),
      d1([{ id: AGENT_ID, name: 'reviewer', since: NOW }]),
    )

    const { out } = await agent(['agent', 'list', '--json'])

    expect(out.map((line) => JSON.parse(line))).toEqual([
      { site: 'blog', agents: [{ id: AGENT_ID, name: 'reviewer', since: NOW }] },
    ])
  })
})

describe('hollware agent remove', () => {
  it('revokes the live grants and tokens and deletes the membership of an agent only', async () => {
    const { wrangler, run: agent } = project(d1([{ id: 'blog' }]), d1([], [], [{ id: AGENT_ID }]))

    const { code, out, err } = await agent(['agent', 'remove', AGENT_ID])

    expect([code, err]).toEqual([0, []])
    expect(wrangler.calls[1]?.args[6]).toBe(
      `UPDATE agent_grants SET revoked_at = '${NOW}', updated_at = '${NOW}' WHERE site_id = 'blog' AND user_id = '${AGENT_ID}' AND revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE kind = 'agent'); UPDATE tokens SET revoked_at = '${NOW}', updated_at = '${NOW}' WHERE site_id = 'blog' AND user_id = '${AGENT_ID}' AND revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE kind = 'agent'); DELETE FROM members WHERE site_id = 'blog' AND user_id = '${AGENT_ID}' AND user_id IN (SELECT id FROM users WHERE kind = 'agent') RETURNING user_id AS id;`,
    )
    expect(out).toEqual([
      `Removed the agent ${AGENT_ID} from the site "blog" and revoked its grants and tokens. Take it out of the "agents" of the site definition too.`,
    ])
  })

  it('refuses when nothing was removed, as for a person', async () => {
    const { run: agent } = project(d1([{ id: 'blog' }]), d1([], []))

    const { code, err } = await agent(['agent', 'remove', AGENT_ID])

    expect([code, err]).toEqual([
      1,
      [
        `hollware agent remove: ${AGENT_ID} is no agent member of the site "blog". "hollware agent list" shows the ones that are.`,
      ],
    ])
  })

  it('refuses an id that is not the id of a user before it calls wrangler', async () => {
    const { wrangler, run: agent } = project()

    const { code, err } = await agent(['agent', 'remove', "usr_x' OR 1=1; --"])

    expect(code).toBe(1)
    expect(err).toEqual([
      expect.stringMatching(
        /^hollware agent remove: invalid user id .*: the id of an agent is usr_ followed by 26 characters\./,
      ),
    ])
    expect(wrangler.calls).toEqual([])
  })
})

describe('hollware agent', () => {
  it('names the subcommands when it gets an unknown one', async () => {
    expect((await run(['agent', 'frob'])).err).toEqual([
      'hollware agent: unknown command "frob": use add, list or remove. Run "hollware agent --help" for the options.',
    ])
  })
})
