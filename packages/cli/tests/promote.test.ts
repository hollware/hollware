import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'
import { startStub, type StubEntry, type StubServer } from './support/stub-hollware.ts'

const FROM_TOKEN = `hw_pat_${'a'.repeat(52)}`
const TO_TOKEN = `hw_pat_${'b'.repeat(52)}`
const FIRST = '2026-10-12T12:00:00.000Z'
const LATER = '2026-10-14T09:30:00.000Z'
const DIGEST_A = '7c4d1735dcaf524b376b4c81399be2c5aefd8aac2d9ec25d17e76d2af46f64af'
const DIGEST_B = 'b149516b891c8a3a1c648edf690507072ee511ab74f3a430df81dafdaf5d8ca4'
const DIGEST_A2 = 'd53b4e3967b2d63e2604dd34c999ee44f0cc785d5c1f3c64c0ac6f3c50483ae7'

const temp = tempDirs()
const stubs: StubServer[] = []

afterEach(async () => {
  for (const stub of stubs.splice(0)) await stub.close()
})

function post(title: string, extra = ''): string {
  return `---\ntitle: ${title}\n---\n\n# ${title}\n${extra}`
}

const rev = (n: number): string => `rev_${String(n).padStart(26, '0')}`
const rvw = (n: number): string => `rvw_${String(n).padStart(26, '0')}`
const ent = (n: number): string => `ent_${String(n).padStart(26, '0')}`

interface StateFile {
  entries: Record<string, unknown>
  [field: string]: unknown
}

interface Pair {
  source: StubServer
  target: StubServer
  cwd: string
  promote: (args?: string[]) => ReturnType<typeof run>
  state: () => StateFile
  statePath: string
}

async function pair(options: { publish?: boolean } = {}): Promise<Pair> {
  const source = await startStub({
    token: FROM_TOKEN,
    site: { key: 'staging', locales: ['en'], collections: ['blog'] },
  })
  const target = await startStub({
    token: TO_TOKEN,
    site: { key: 'production', locales: ['en'], collections: ['blog'] },
    ...(options.publish === false ? { scopes: ['content:read', 'content:write'] as const } : {}),
  })
  stubs.push(source, target)
  const cwd = temp.make({ 'from.token': `${FROM_TOKEN}\n`, 'to.token': `${TO_TOKEN}\n` })
  const statePath = join(
    cwd,
    '.hollware',
    `promote-${new URL(source.url).host.replace(':', '_')}-${new URL(target.url).host.replace(':', '_')}.json`,
  )
  return {
    source,
    target,
    cwd,
    statePath,
    promote: (args = []) =>
      run(
        [
          'promote',
          '--from',
          source.url,
          '--from-token-file',
          'from.token',
          '--to',
          target.url,
          '--to-token-file',
          'to.token',
          ...args,
        ],
        { cwd },
      ),
    state: () => JSON.parse(readFileSync(statePath, 'utf8')),
  }
}

function put(
  stub: StubServer,
  path: string,
  n: number,
  revisions: string[],
  published: number | null,
  updatedAt = FIRST,
): StubEntry {
  const [collection = '', locale = '', slug = ''] = path.split('/')
  const entry: StubEntry = {
    id: ent(n),
    collection,
    locale,
    slug,
    version: revisions.length + (published === null ? 0 : 1),
    revisions,
    published,
    updatedAt,
  }
  stub.entries.set(path, entry)
  return entry
}

function republish(stub: StubServer, path: string, markdown: string, updatedAt = LATER): void {
  const entry = stub.entries.get(path)
  if (entry === undefined) throw new Error(`no ${path}`)
  entry.revisions.push(markdown)
  entry.published = entry.revisions.length - 1
  entry.version += 2
  entry.updatedAt = updatedAt
}

function approveAll(stub: StubServer): void {
  for (const review of stub.reviews.values()) {
    if (review.status !== 'pending') continue
    for (const item of review.items) {
      const entry = [...stub.entries.values()].find((one) => one.id === item.entryId)
      if (entry === undefined) continue
      entry.published = item.action === 'publish' ? entry.revisions.length - 1 : null
      entry.version += 1
    }
    review.status = 'approved'
  }
}

function toolsOf(stub: StubServer, tool: string) {
  return stub.calls.filter((call) => call.tool === tool).map((call) => call.args)
}

function seedTwo(source: StubServer): void {
  put(source, 'blog/en/a', 1, [post('A')], 0)
  put(source, 'blog/en/b', 2, [post('B')], 0)
  put(source, 'blog/en/draft', 3, [post('Draft')], null)
}

describe('hollware promote', () => {
  it('promotes every published entry on a first run as drafts in one grouped review, and keeps the state', async () => {
    const { source, target, promote, state } = await pair()
    seedTwo(source)

    const { code, out, err } = await promote()

    expect([code, err]).toEqual([0, []])
    expect(out).toEqual([
      'create     blog/en/b',
      'create     blog/en/a',
      `Asked for the review ${rvw(1)}: approve it in the admin of ${target.url} to publish.`,
      `Promoted from ${source.url} to ${target.url}: 2 to create, 0 to update, 0 unchanged, 0 changed in the destination, 0 to unpublish. State in .hollware/promote-${new URL(source.url).host.replace(':', '_')}-${new URL(target.url).host.replace(':', '_')}.json.`,
    ])
    expect(toolsOf(target, 'request_review')).toEqual([
      {
        id: ent(1),
        version: 1,
        group: [{ id: ent(2), version: 1 }],
        unpublish: [],
        acknowledgeWarnings: [],
      },
    ])
    expect(target.entries.get('blog/en/a')?.revisions).toEqual([post('A')])
    expect(target.entries.has('blog/en/draft')).toBe(false)
    expect(state()).toEqual({
      version: 1,
      from: source.url,
      to: target.url,
      cursors: { blog: FIRST },
      entries: {
        'blog/en/a': {
          sourceEntry: ent(1),
          sourceRevision: rev(1),
          destinationRevision: null,
          promoted: DIGEST_A,
        },
        'blog/en/b': {
          sourceEntry: ent(2),
          sourceRevision: rev(1),
          destinationRevision: null,
          promoted: DIGEST_B,
        },
      },
      reviews: [rvw(1)],
    })
  })

  it('creates no review and writes nothing on a second run with nothing changed', async () => {
    const { source, target, promote } = await pair()
    seedTwo(source)
    await promote()
    target.calls.splice(0)

    const { code, out } = await promote()

    expect(code).toBe(0)
    expect(out.at(-1)).toContain(
      ': 0 to create, 0 to update, 0 unchanged, 0 changed in the destination, 0 to unpublish.',
    )
    expect(
      target.calls
        .map((call) => call.tool)
        .filter((tool) => tool !== 'describe_site' && tool !== 'get_review'),
    ).toEqual([])
  })

  it('reads only what changed since the state, and asks for a review of that alone', async () => {
    const { source, target, promote, state } = await pair()
    seedTwo(source)
    await promote()
    approveAll(target)
    republish(source, 'blog/en/a', post('A2'))
    source.calls.splice(0)

    const { code, err } = await promote()

    expect([code, err]).toEqual([0, []])
    expect(toolsOf(source, 'list_entries').map((args) => args['changedSince'])).toEqual([
      FIRST,
      FIRST,
    ])
    expect(toolsOf(target, 'request_review').at(-1)).toEqual({
      id: ent(2),
      version: 3,
      group: [],
      unpublish: [],
      acknowledgeWarnings: [],
    })
    expect(target.entries.get('blog/en/a')?.revisions).toEqual([post('A'), post('A2')])
    expect(state()).toMatchObject({
      cursors: { blog: LATER },
      entries: {
        'blog/en/a': {
          sourceEntry: ent(1),
          sourceRevision: rev(2),
          destinationRevision: rev(1),
          promoted: DIGEST_A2,
        },
      },
      reviews: [rvw(2)],
    })
  })

  it('still writes an entry changed in the destination since the last promotion, and says so on it in the review with the difference', async () => {
    const { source, target, promote } = await pair()
    seedTwo(source)
    await promote()
    approveAll(target)
    republish(target, 'blog/en/a', post('A', '\nFixed in production.\n'))
    republish(source, 'blog/en/a', post('A2'))

    const { code, out } = await promote()

    expect(code).toBe(0)
    expect(out[0]).toBe(
      'update     blog/en/a  (changed in the destination since the last promotion)',
    )
    expect(target.entries.get('blog/en/a')?.revisions.at(-1)).toBe(post('A2'))
    expect(target.reviews.get(rvw(2))?.comments).toEqual([
      {
        entryId: ent(2),
        lines: { from: 1, to: 5 },
        body: [
          'Changed in the destination since the last promotion: what is published here is not what was promoted last time. Approving this review replaces it with the promoted version.',
          '',
          '```diff',
          '@@ -1,7 +1,5 @@',
          ' ---',
          '-title: A',
          '+title: A2',
          ' ---',
          ' ',
          '-# A',
          '-',
          '-Fixed in production.',
          '+# A2',
          '```',
        ].join('\n'),
      },
    ])
  })

  it('posts no comment when the destination published what was promoted, after the review was approved', async () => {
    const { source, target, promote } = await pair()
    seedTwo(source)
    await promote()
    approveAll(target)
    republish(source, 'blog/en/a', post('A2'))

    const { out } = await promote()

    expect(out[0]).toBe('update     blog/en/a')
    expect(target.reviews.get(rvw(2))?.comments).toEqual([])
  })

  it('unpublishes in the same review an entry the source no longer publishes', async () => {
    const { source, target, promote, state } = await pair()
    seedTwo(source)
    await promote()
    approveAll(target)
    const b = source.entries.get('blog/en/b')
    if (b !== undefined) Object.assign(b, { published: null, updatedAt: LATER })
    republish(source, 'blog/en/a', post('A2'))

    const { code, out } = await promote()

    expect(code).toBe(0)
    expect(out.slice(0, 2)).toEqual(['update     blog/en/a', 'unpublish  blog/en/b'])
    expect(toolsOf(target, 'request_review').at(-1)).toEqual({
      id: ent(2),
      version: 3,
      group: [],
      unpublish: [{ id: ent(1), version: 2 }],
      acknowledgeWarnings: [],
    })
    expect(Object.keys(state().entries)).toEqual(['blog/en/a'])
  })

  it('unpublishes with --all an entry the source no longer has at all, which an incremental run cannot see', async () => {
    const { source, target, promote } = await pair()
    seedTwo(source)
    await promote()
    approveAll(target)
    source.entries.delete('blog/en/b')
    republish(source, 'blog/en/a', post('A2'))

    const { code } = await promote(['--all'])

    expect(code).toBe(0)
    expect(toolsOf(target, 'request_review').at(-1)?.['unpublish']).toEqual([
      { id: ent(1), version: 2 },
    ])
  })

  it('keeps an entry to unpublish for later when no entry is to be published, and unpublishes it with --publish', async () => {
    const { source, target, promote, state } = await pair()
    seedTwo(source)
    await promote()
    approveAll(target)
    const b = source.entries.get('blog/en/b')
    if (b !== undefined) Object.assign(b, { published: null, updatedAt: LATER })

    const waiting = await promote()
    const published = await promote(['--publish'])

    expect(waiting.out).toContain(
      '1 entry waits to be unpublished with the next promotion that has an entry to publish, or with --publish: blog/en/b.',
    )
    expect(published.code).toBe(0)
    expect(toolsOf(target, 'unpublish')).toEqual([{ id: ent(1) }])
    expect(target.entries.get('blog/en/b')?.published).toBe(null)
    expect(Object.keys(state().entries)).toEqual(['blog/en/a'])
  })

  it('copies the images the entries show that the destination lacks, and points the drafts at their ids there', async () => {
    const { source, target, promote } = await pair()
    const original = new TextEncoder().encode('png bytes of the cover')
    source.assets.set('ast_0123456789abcdef0123456789', {
      id: 'ast_0123456789abcdef0123456789',
      format: 'image/webp',
      originalFormat: 'image/png',
      served: new TextEncoder().encode('webp'),
      original,
      alt: 'The cover',
      filename: 'cover.png',
    })
    put(
      source,
      'blog/en/a',
      1,
      [post('A', '\n![The cover](asset:ast_0123456789abcdef0123456789)\n')],
      0,
    )

    const { code, out } = await promote()

    const [copied] = [...target.assets.values()]
    expect(code).toBe(0)
    expect(out).toContain('Images: 1 copied, 0 already there.')
    expect(copied).toMatchObject({ original, alt: 'The cover', filename: 'cover.png' })
    expect(copied?.id).not.toBe('ast_0123456789abcdef0123456789')
    expect(target.entries.get('blog/en/a')?.revisions).toEqual([
      post('A', `\n![The cover](asset:${copied?.id ?? ''})\n`),
    ])
  })

  it('prints the plan with --dry-run and writes nothing, not even the state', async () => {
    const { source, target, promote, statePath } = await pair()
    seedTwo(source)

    const { code, out } = await promote(['--dry-run'])

    expect(code).toBe(0)
    expect(out).toEqual([
      'create     blog/en/b',
      'create     blog/en/a',
      'Dry run: 2 to create, 0 to update, 0 unchanged, 0 changed in the destination, 0 to unpublish. Nothing was written, the state neither.',
    ])
    expect(target.entries.size).toBe(0)
    expect(toolsOf(target, 'request_review')).toEqual([])
    expect(existsSync(statePath)).toBe(false)
  })

  it('publishes as one group with --publish, and asks for no review', async () => {
    const { source, target, promote } = await pair()
    seedTwo(source)

    const { code, out } = await promote(['--publish'])

    expect(code).toBe(0)
    expect(toolsOf(target, 'publish')).toEqual([
      { id: ent(1), version: 1, group: [{ id: ent(2), version: 1 }], acknowledgeWarnings: [] },
    ])
    expect(toolsOf(target, 'request_review')).toEqual([])
    expect(target.entries.get('blog/en/a')?.published).toBe(0)
    expect(out).toContain('Published 2, unpublished 0.')
  })

  it('asks again for what a review of the last run held when this run cancels it with a new revision', async () => {
    const { source, target, promote } = await pair()
    seedTwo(source)
    await promote()
    republish(source, 'blog/en/a', post('A2'))

    const { code } = await promote()

    expect(code).toBe(0)
    expect(target.reviews.get(rvw(1))?.status).toBe('cancelled')
    expect(target.reviews.get(rvw(2))?.comments).toEqual([])
    expect(toolsOf(target, 'request_review').at(-1)).toEqual({
      id: ent(2),
      version: 2,
      group: [{ id: ent(1), version: 1 }],
      unpublish: [],
      acknowledgeWarnings: [],
    })
  })

  it('answers one JSON object with --json', async () => {
    const { source, target, promote } = await pair()
    seedTwo(source)

    const { out } = await promote(['--json'])

    expect(out.map((line) => JSON.parse(line))).toEqual([
      {
        from: source.url,
        to: target.url,
        dryRun: false,
        entries: [
          { path: 'blog/en/b', action: 'create', conflict: false },
          { path: 'blog/en/a', action: 'create', conflict: false },
        ],
        unpublish: [],
        assets: { copied: 0, present: 0 },
        reviews: [rvw(1)],
        published: 0,
        unpublished: 0,
        waiting: [],
        state: `.hollware/promote-${new URL(source.url).host.replace(':', '_')}-${new URL(target.url).host.replace(':', '_')}.json`,
      },
    ])
  })

  it('refuses a collection the destination does not have, before reading the source', async () => {
    const source = await startStub({
      token: FROM_TOKEN,
      site: { key: 'staging', locales: ['en'], collections: ['blog', 'docs'] },
    })
    const target = await startStub({
      token: TO_TOKEN,
      site: { key: 'p', locales: ['en'], collections: ['blog'] },
    })
    stubs.push(source, target)
    const cwd = temp.make({ 'from.token': FROM_TOKEN, 'to.token': TO_TOKEN })

    const { code, err } = await run(
      [
        'promote',
        '--from',
        source.url,
        '--from-token-file',
        'from.token',
        '--to',
        target.url,
        '--to-token-file',
        'to.token',
      ],
      { cwd },
    )

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware promote: the destination has no collection docs: create it there first (set_collection, or the config of the destination), then promote again. Nothing was written.',
    ])
    expect(toolsOf(source, 'list_entries')).toEqual([])
  })
})

describe('hollware promote, in a nested collection', () => {
  async function nestedPair(targetDepth: number | null = 2): Promise<Pair> {
    const site = { locales: ['es'], collections: ['help'] }
    const source = await startStub({
      token: FROM_TOKEN,
      site: { key: 'staging', ...site },
      declared: { help: { maxDepth: 2 } },
    })
    const target = await startStub({
      token: TO_TOKEN,
      site: { key: 'production', ...site },
      declared: targetDepth === null ? {} : { help: { maxDepth: targetDepth } },
    })
    stubs.push(source, target)
    const cwd = temp.make({ 'from.token': `${FROM_TOKEN}\n`, 'to.token': `${TO_TOKEN}\n` })
    const statePath = join(
      cwd,
      '.hollware',
      `promote-${new URL(source.url).host.replace(':', '_')}-${new URL(target.url).host.replace(':', '_')}.json`,
    )
    return {
      source,
      target,
      cwd,
      statePath,
      promote: (args = []) =>
        run(
          [
            'promote',
            '--from',
            source.url,
            '--from-token-file',
            'from.token',
            '--to',
            target.url,
            '--to-token-file',
            'to.token',
            ...args,
          ],
          { cwd },
        ),
      state: () => JSON.parse(readFileSync(statePath, 'utf8')),
    }
  }

  function placed(stub: StubServer, path: string, n: number, slugPath: string, position: number) {
    const entry = put(stub, path, n, [post(path.split('/').at(-1) ?? '')], 0)
    entry.slugPath = slugPath
    entry.position = position
    return entry
  }

  function seedTree(source: StubServer): void {
    placed(source, 'help/es/entra', 1, 'sso/entra', 1)
    placed(source, 'help/es/google', 2, 'sso/google', 0)
    placed(source, 'help/es/sso', 3, 'sso', 1)
    placed(source, 'help/es/intro', 4, 'intro', 0)
  }

  function tree(stub: StubServer): string[] {
    return [...stub.entries.values()]
      .map((entry) => `${entry.slugPath ?? entry.slug} ${entry.position}`)
      .sort()
  }

  it('creates each entry under its parent and in the order of the source, though the source lists a child before its parent', async () => {
    const { source, target, promote } = await nestedPair()
    seedTree(source)

    const { code, err } = await promote()

    expect([code, err]).toEqual([0, []])
    expect(tree(target)).toEqual(['intro 0', 'sso 1', 'sso/entra 1', 'sso/google 0'])
    expect(toolsOf(target, 'create_draft').map((args) => [args.slug, args.parent ?? null])).toEqual(
      [
        ['intro', null],
        ['sso', null],
        ['google', 'sso'],
        ['entra', 'sso'],
      ],
    )
  })

  it('moves the entries the destination already holds to the place they have in the source, and a dry run says so', async () => {
    const { source, target, promote } = await nestedPair()
    seedTree(source)
    placed(target, 'help/es/sso', 11, 'sso', 0)
    placed(target, 'help/es/intro', 12, 'intro', 1)
    placed(target, 'help/es/entra', 13, 'entra', 2)
    placed(target, 'help/es/google', 14, 'google', 3)

    const dry = await promote(['--dry-run'])

    expect(dry.out.slice(0, 4)).toEqual([
      'unchanged  help/es/intro  (moves to its place: intro, position 0)',
      'unchanged  help/es/sso  (moves to its place: sso, position 1)',
      'unchanged  help/es/google  (moves to its place: sso/google, position 0)',
      'unchanged  help/es/entra  (moves to its place: sso/entra, position 1)',
    ])
    expect(tree(target)).toEqual(['entra 2', 'google 3', 'intro 1', 'sso 0'])

    const { code, err } = await promote()

    expect([code, err]).toEqual([0, []])
    expect(tree(target)).toEqual(['intro 0', 'sso 1', 'sso/entra 1', 'sso/google 0'])
  })

  it('puts each entry at the position it has in the source, before a sibling only the destination has', async () => {
    const { source, target, promote } = await nestedPair()
    seedTree(source)
    placed(target, 'help/es/aviso', 11, 'aviso', 0)

    const { code, err } = await promote()

    expect([code, err]).toEqual([0, []])
    expect(tree(target)).toEqual(['aviso 2', 'intro 0', 'sso 1', 'sso/entra 1', 'sso/google 0'])
  })

  it('promotes an entry that moved in the source though its text stayed the same', async () => {
    const { source, target, promote, state } = await nestedPair()
    seedTree(source)
    await promote()
    approveAll(target)
    const intro = source.entries.get('help/es/intro')
    const sso = source.entries.get('help/es/sso')
    if (intro === undefined || sso === undefined) throw new Error('no roots')
    intro.position = 1
    sso.position = 0

    const { code, out } = await promote()

    expect(code).toBe(0)
    expect(out.slice(0, 2)).toEqual([
      'unchanged  help/es/sso  (moves to its place: sso, position 0)',
      'unchanged  help/es/intro  (moves to its place: intro, position 1)',
    ])
    expect(tree(target)).toEqual(['intro 1', 'sso 0', 'sso/entra 1', 'sso/google 0'])
    expect(state().entries['help/es/sso']).toMatchObject({ place: '#0' })
    expect(state().entries['help/es/google']).toMatchObject({ place: 'sso#0' })
  })

  it('leaves a published entry where it is until the new parent it goes under is published, and moves it on the next run', async () => {
    const { source, target, promote, state } = await nestedPair()
    seedTree(source)
    placed(target, 'help/es/intro', 11, 'intro', 0)
    placed(target, 'help/es/google', 12, 'google', 1)
    placed(target, 'help/es/entra', 13, 'entra', 2)

    const first = await promote()

    expect([first.code, first.err]).toEqual([0, []])
    expect(first.out).toContain(
      '2 published entries wait for a new parent to be published to move under it: approve the review, then promote again: help/es/google, help/es/entra.',
    )
    expect(state().entries['help/es/google']).not.toHaveProperty('place')
    approveAll(target)

    const second = await promote()

    expect([second.code, second.err]).toEqual([0, []])
    expect(tree(target)).toEqual(['intro 0', 'sso 1', 'sso/entra 1', 'sso/google 0'])
    expect(state().entries['help/es/google']).toMatchObject({ place: 'sso#0' })
  })

  it('brings the parent a filter left out when the destination does not have it', async () => {
    const { source, target, promote } = await nestedPair()
    seedTree(source)
    const google = source.entries.get('help/es/google')
    if (google === undefined) throw new Error('no google')
    google.tags = ['sso']

    const { code, err } = await promote(['--tag', 'sso'])

    expect([code, err]).toEqual([0, []])
    expect(tree(target)).toEqual(['sso 0', 'sso/google 0'])
  })

  it('reads a nested collection whole on an incremental run, since a move shifts siblings it does not touch', async () => {
    const { source, promote, state } = await nestedPair()
    seedTree(source)
    await promote()
    const intro = source.entries.get('help/es/intro')
    const sso = source.entries.get('help/es/sso')
    if (intro === undefined || sso === undefined) throw new Error('no roots')
    intro.position = 1
    intro.updatedAt = LATER
    sso.position = 0

    const { code } = await promote(['--since', LATER])

    expect(code).toBe(0)
    expect(state().entries['help/es/sso']).toMatchObject({ place: '#0' })
  })

  it('unpublishes an entry the source no longer has on an incremental run, since it reads a nested collection whole', async () => {
    const { source, target, promote } = await nestedPair()
    seedTree(source)
    await promote()
    approveAll(target)
    source.entries.delete('help/es/intro')

    const { code, out } = await promote(['--since', LATER])

    expect(code).toBe(0)
    expect(out).toContain('unpublish  help/es/intro')
  })

  it('writes nothing when the destination nests the collection less deep than the source', async () => {
    const { source, target, promote } = await nestedPair(null)
    seedTree(source)

    const { code, err } = await promote()

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware promote: the destination nests help less deep than the source, so its tree would not fit: give it the nesting of the source there first, then promote again. Nothing was written.',
    ])
    expect(toolsOf(target, 'create_draft')).toEqual([])
  })

  it('says in a JSON dry run where each entry that moves goes', async () => {
    const { source, target, promote } = await nestedPair()
    seedTree(source)
    placed(target, 'help/es/sso', 11, 'sso', 0)
    placed(target, 'help/es/intro', 12, 'intro', 1)
    placed(target, 'help/es/google', 13, 'google', 2)
    placed(target, 'help/es/entra', 14, 'sso/entra', 0)

    const { code, out } = await promote(['--dry-run', '--json'])

    expect(code).toBe(0)
    expect(JSON.parse(out.join('\n')).entries).toEqual([
      {
        path: 'help/es/intro',
        action: 'unchanged',
        conflict: false,
        moves: { parent: null, position: 0 },
      },
      {
        path: 'help/es/sso',
        action: 'unchanged',
        conflict: false,
        moves: { parent: null, position: 1 },
      },
      {
        path: 'help/es/google',
        action: 'unchanged',
        conflict: false,
        moves: { parent: 'sso', position: 0 },
      },
      {
        path: 'help/es/entra',
        action: 'unchanged',
        conflict: false,
        moves: { parent: 'sso', position: 1 },
      },
    ])
  })

  it('keeps a new parent and the entries under it in the same review when they do not fit in the first', async () => {
    const { source, target, promote } = await nestedPair()
    for (let n = 0; n < 98; n += 1) placed(source, `help/es/root-${n}`, 100 + n, `root-${n}`, n)
    placed(source, 'help/es/sso', 1, 'sso', 98)
    placed(source, 'help/es/google', 2, 'sso/google', 0)
    placed(source, 'help/es/entra', 3, 'sso/entra', 1)
    placed(source, 'help/es/okta', 4, 'sso/okta', 2)

    const { code, err } = await promote()

    expect([code, err]).toEqual([0, []])
    const slugOf = (id: string) =>
      [...target.entries.values()].find((entry) => entry.id === id)?.slug
    const reviews = [...target.reviews.values()].map((review) =>
      review.items.map((item) => slugOf(item.entryId)),
    )
    expect(reviews.map((review) => review.length)).toEqual([98, 4])
    expect(reviews[1]).toEqual(['sso', 'google', 'entra', 'okta'])
  })

  it('writes nothing when a new parent and the entries under it are more than one review holds', async () => {
    const { source, target, promote } = await nestedPair()
    placed(source, 'help/es/sso', 1, 'sso', 0)
    for (let n = 0; n < 100; n += 1)
      placed(source, `help/es/child-${n}`, 100 + n, `sso/child-${n}`, n)
    source.assets.set('ast_0123456789abcdef0123456789', {
      id: 'ast_0123456789abcdef0123456789',
      format: 'image/webp',
      originalFormat: 'image/png',
      served: new TextEncoder().encode('webp'),
      original: new TextEncoder().encode('png'),
      alt: 'A cover',
      filename: 'cover.png',
    })
    const cover = source.entries.get('help/es/child-0')
    if (cover === undefined) throw new Error('no child-0')
    cover.revisions = [post('child-0', '\n![A cover](asset:ast_0123456789abcdef0123456789)\n')]

    const { code, err } = await promote()

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware promote: help/es/sso and the 100 entries under it publish together, more than the 100 one review holds: promote part of them first with --tag, then the rest. Nothing was written.',
    ])
    expect(toolsOf(target, 'create_draft')).toEqual([])
    expect(target.assets.size).toBe(0)
  })

  it('brings a parent the destination holds only as a draft into the review of its child', async () => {
    const { source, target, promote } = await nestedPair()
    seedTree(source)
    const google = source.entries.get('help/es/google')
    if (google === undefined) throw new Error('no google')
    google.tags = ['sso']
    const draft = placed(target, 'help/es/sso', 11, 'sso', 0)
    draft.published = null

    const { code, err } = await promote(['--tag', 'sso'])

    expect([code, err]).toEqual([0, []])
    const slugOf = (id: string) =>
      [...target.entries.values()].find((entry) => entry.id === id)?.slug
    expect(
      [...target.reviews.values()].map((review) =>
        review.items.map((item) => slugOf(item.entryId)),
      ),
    ).toEqual([['sso', 'google']])
  })

  it('keeps a parent and the entries under it that leave the source in the same review', async () => {
    const { source, target, promote } = await nestedPair()
    placed(source, 'help/es/sso', 1, 'sso', 0)
    placed(source, 'help/es/google', 2, 'sso/google', 0)
    await promote()
    approveAll(target)
    source.entries.delete('help/es/sso')
    source.entries.delete('help/es/google')
    for (let n = 0; n < 99; n += 1) placed(source, `help/es/root-${n}`, 100 + n, `root-${n}`, n)

    const { code, err, out } = await promote()

    expect([code, err]).toEqual([0, []])
    expect(out).toContain(
      '2 entries wait to be unpublished with the next promotion that has an entry to publish, or with --publish: help/es/sso, help/es/google.',
    )
  })
})
