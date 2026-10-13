import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { countRows } from '../db/support.ts'
import { agent as agentFor, blogPost, blogSite, NO_ENTRY, warmUpComark } from './support.ts'
import {
  createPost,
  entryColumns,
  interleaved,
  newWorld,
  publicationsOf,
  publishPost,
  revisionsOf,
  type World,
} from './world.ts'

// Fails when: publish or unpublish stop doing what the specs say. publish.ts publishes without the
// version of the entry being the one the caller read (conflict has to win over every other
// answer), lets errors through (the contracts run again, in the publish phase, on the latest
// revision, against the entries as they are now), publishes with a warning that was not
// acknowledged, matches an acknowledgement by something else than its contract and its path,
// records something else than every warning of the verdict as acknowledged, drops or mixes up the
// actor, or the sort key (the sorting field of the collection, else when the entry was first
// published, else now); answers the store's conflict, not_found and too_large as something else.
// unpublish.ts leaves an entry up, writes for an entry that is not published, or forgets who did it.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const HASH = expect.stringMatching(/^[0-9a-f]{64}$/)
const T0 = '2026-10-13T10:00:00.000Z'
const T1 = '2026-10-13T11:00:00.000Z'
const T2 = '2026-10-13T12:00:00.000Z'
const T3 = '2026-10-13T13:00:00.000Z'

const english = { collection: 'blog', locale: 'en', slug: 'edge-caching-guide' }
const TITLE = 'A guide to caching at the edge of the network with Workers and D1 tonight'
const TITLE_ACK = { contract: 'seo-title-length', path: '/frontmatter/title' }

/** A note that gets three warnings when it is published: one of `entry-id` and two of `many-warnings`. */
const NOTE = { collection: 'notes', locale: 'en', slug: 'a-note' }
const FLOODED = '---\ntitle: A note\nprobe: true\nflood: 2\n---\n\nText\n'
const PROBE_KEY = { contract: 'entry-id', path: '' }
const FLOOD_KEY = { contract: 'many-warnings', path: '/frontmatter/flood' }

/** How many publications the site has, for the tests that say nothing was published. */
function publications(world: World) {
  return countRows(world.db, 'publications', world.tenant.key)
}

/** A pair of drafts, English and Spanish, in one translation group: what the blog needs to publish. */
async function pair(world: World, group = 'edge-caching-guide') {
  const en = await createPost(world, { slug: 'edge-caching-guide', group, at: T0 })
  const es = await createPost(world, { slug: 'guia-de-cache', locale: 'es', group })
  return { en, es }
}

describe('publish', () => {
  it('publishes the latest revision, and records who published it, what it was checked against and when', async () => {
    const world = await newWorld(env.DB, 'publish')
    const { en } = await pair(world)
    world.time.set(T1)
    const client = { name: 'claude-code', version: '1.2.3' }

    const published = await agentFor(world.context({ client })).publish({
      id: en.id,
      version: en.version,
    })

    expect(published).toEqual({
      outcome: 'published',
      entry: {
        ...en,
        status: 'published',
        version: 2,
        hasUnpublishedChanges: false,
        publishedAt: T1,
        updatedAt: T1,
      },
      verdict: { ok: true, phase: 'publish', errors: [], warnings: [], contractsHash: HASH },
    })
    const [revision] = await revisionsOf(world.db, en.id)
    expect(await entryColumns(world.db, en.id)).toMatchObject({
      status: 'published',
      version: 2,
      head_rev: revision?.id,
      published_rev: revision?.id,
      published_at: T1,
      // The blog sorts by its `date`.
      published_sort_key: '2026-10-01',
    })
    const [publication, ...others] = await publicationsOf(world.db, en.id)
    expect(others).toEqual([])
    expect(publication).toMatchObject({
      action: 'publish',
      revision_id: revision?.id,
      acknowledged: '[]',
      actor_kind: 'token',
      actor_user_id: world.tenant.userId,
      actor_token_id: world.tenant.tokenId,
      created_at: T1,
    })
    expect(JSON.parse(publication?.verdict ?? '')).toEqual(published.verdict)
    expect(JSON.parse(publication?.actor_meta ?? '')).toEqual(client)
  })

  it('publishes a newer revision of an entry that is live, and keeps when it was first published', async () => {
    const world = await newWorld(env.DB, 'republish')
    const { en } = await pair(world)
    const first = await publishPost(world, en, T1)
    world.time.set(T2)
    const edited = await world.agent.updateDraft({
      id: en.id,
      version: first.version,
      markdown: blogPost({ title: 'A newer title', translationGroup: 'edge-caching-guide' }),
    })

    const again = await world.agent.publish({ id: en.id, version: edited.entry?.version ?? 0 })

    expect(again.outcome).toBe('published')
    expect(again.entry).toMatchObject({
      version: 4,
      hasUnpublishedChanges: false,
      publishedAt: T1,
      updatedAt: T2,
    })
    const [, second] = await revisionsOf(world.db, en.id)
    expect((await entryColumns(world.db, en.id))?.published_rev).toBe(second?.id)
    expect((await publicationsOf(world.db, en.id)).map((row) => row.revision_id)).toHaveLength(2)
  })

  it('is blocked by an error, even when every warning is acknowledged, and publishes nothing', async () => {
    const world = await newWorld(env.DB, 'blocked')
    await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })
    // A long title is a warning, and an image without alt text is an error.
    const created = await world.agent.createDraft({
      ...english,
      markdown: blogPost({ title: TITLE }, '\n![](/images/edge.png)\n'),
    })
    const id = created.entry?.id ?? ''

    const blocked = await world.agent.publish({ id, version: 1, acknowledgeWarnings: [TITLE_ACK] })

    expect(blocked).toEqual({
      outcome: 'blocked',
      entry: created.entry,
      verdict: {
        ok: false,
        phase: 'publish',
        errors: [expect.objectContaining({ contract: 'images-have-alt', path: '/body' })],
        warnings: [expect.objectContaining({ contract: 'seo-title-length' })],
        contractsHash: HASH,
      },
    })
    expect(await entryColumns(world.db, id)).toMatchObject({ status: 'draft', version: 1 })
    expect(await publications(world)).toBe(0)
  })

  it('checks the entry again when it publishes: a rule that reads other entries, the translation pair', async () => {
    const world = await newWorld(env.DB, 'pair')
    const en = await createPost(world, { slug: 'edge-caching-guide', group: 'guide' })
    // The draft was saved with nothing to fix: the translation pair is checked when publishing.
    expect((await world.agent.getEntry(english)).entry?.verdict.ok).toBe(true)

    const alone = await world.agent.publish({ id: en.id, version: 1 })
    await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'guide' })
    const paired = await world.agent.publish({ id: en.id, version: 1 })

    expect(alone.outcome).toBe('blocked')
    expect(alone.verdict?.errors.map((error) => error.contract)).toEqual(['translation-pair'])
    expect(paired.outcome).toBe('published')
  })

  it('checks the entry again when it publishes: the links need entries that are published at that moment', async () => {
    const world = await newWorld(env.DB, 'links')
    await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'guide' })
    const linking = await world.agent.createDraft({
      ...english,
      markdown: blogPost({ translationGroup: 'guide' }, '\nSee [the note](/en/notes/my-note/).\n'),
    })
    const note = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'my-note',
      markdown: '---\ntitle: A note\n---\n\nText\n',
    })
    const id = linking.entry?.id ?? ''

    const early = await world.agent.publish({ id, version: 1 })
    await world.agent.publish({ id: note.entry?.id ?? '', version: 1 })
    const late = await world.agent.publish({ id, version: 1 })

    expect(linking.verdict?.ok).toBe(true)
    expect(early.outcome).toBe('blocked')
    expect(early.verdict?.errors).toEqual([
      expect.objectContaining({
        contract: 'internal-links-resolve',
        message:
          'The link "/en/notes/my-note/" points at the entry notes/en/my-note, which is not published yet (draft).',
      }),
    ])
    expect(late.outcome).toBe('published')
  })

  it('asks for the acknowledgement of every warning, by its contract and its path, before it publishes', async () => {
    const world = await newWorld(env.DB, 'acknowledge')
    const created = await world.agent.createDraft({ ...NOTE, markdown: FLOODED })
    const id = created.entry?.id ?? ''
    const attempts = [
      [],
      [PROBE_KEY],
      [FLOOD_KEY],
      [PROBE_KEY, { contract: 'many-warnings', path: '/frontmatter/other' }],
      [PROBE_KEY, { contract: 'another-contract', path: '/frontmatter/flood' }],
    ]

    for (const acknowledgeWarnings of attempts) {
      const answer = await world.agent.publish({ id, version: 1, acknowledgeWarnings })

      expect(answer.outcome).toBe('needs_acknowledgement')
      expect(answer.verdict).toMatchObject({ ok: true, phase: 'publish', errors: [] })
      expect(answer.verdict?.warnings.map((warning) => [warning.contract, warning.path])).toEqual([
        ['entry-id', ''],
        ['many-warnings', '/frontmatter/flood'],
        ['many-warnings', '/frontmatter/flood'],
      ])
      expect(answer.entry).toMatchObject({ id, version: 1, status: 'draft' })
      expect(await entryColumns(world.db, id)).toMatchObject({ status: 'draft', version: 1 })
      expect(await publications(world)).toBe(0)
    }
  })

  it('records every warning of the verdict as acknowledged, and not what the caller listed besides', async () => {
    const world = await newWorld(env.DB, 'acknowledged')
    const created = await world.agent.createDraft({ ...NOTE, markdown: FLOODED })
    const id = created.entry?.id ?? ''

    // One acknowledgement covers the two warnings of one contract at one path, and the one that
    // is no warning of this entry is not recorded.
    const published = await world.agent.publish({
      id,
      version: 1,
      acknowledgeWarnings: [PROBE_KEY, FLOOD_KEY, TITLE_ACK],
    })

    expect(published.outcome).toBe('published')
    const [publication] = await publicationsOf(world.db, id)
    expect(JSON.parse(publication?.acknowledged ?? '')).toEqual([PROBE_KEY, FLOOD_KEY, FLOOD_KEY])
    const read = await world.agent.getEntry(NOTE)
    expect(read.entry?.lastPublication?.acknowledged).toEqual([PROBE_KEY, FLOOD_KEY, FLOOD_KEY])
  })

  it('publishes without acknowledgements when there is no warning to acknowledge', async () => {
    const world = await newWorld(env.DB, 'no-warnings')
    const created = await world.agent.createDraft({
      ...NOTE,
      markdown: '---\ntitle: A note\n---\n\nText\n',
    })
    const id = created.entry?.id ?? ''

    const published = await world.agent.publish({
      id,
      version: 1,
      acknowledgeWarnings: [TITLE_ACK],
    })

    expect(published.outcome).toBe('published')
    expect((await publicationsOf(world.db, id)).map((row) => row.acknowledged)).toEqual(['[]'])
  })

  it('tells the contracts which entry it publishes', async () => {
    const world = await newWorld(env.DB, 'probe')
    const created = await world.agent.createDraft({ ...NOTE, markdown: FLOODED })
    const id = created.entry?.id ?? ''

    const asked = await world.agent.publish({ id, version: 1 })

    expect(asked.verdict?.warnings[0]?.message).toBe(`Run for the entry ${id}.`)
  })

  it('answers conflict, with the current version and head, before it checks the contracts, whatever they say', async () => {
    const world = await newWorld(env.DB, 'conflict')
    const created = await world.agent.createDraft({
      ...english,
      markdown: blogPost({ title: TITLE, description: null }),
    })
    const id = created.entry?.id ?? ''
    const fixed = await world.agent.updateDraft({
      id,
      version: 1,
      markdown: blogPost({ title: TITLE }),
    })
    const head = (await world.agent.getEntry(english)).entry?.revision
    expect(fixed.entry?.version).toBe(2)

    // At version 1 the entry had errors, and at 2 it has a warning and no translation. None of
    // that is asked: the version is not the entry's.
    const answers = [
      await world.agent.publish({ id, version: 1 }),
      await world.agent.publish({ id, version: 3, acknowledgeWarnings: [TITLE_ACK] }),
    ]

    for (const answer of answers) {
      expect(answer).toEqual({
        outcome: 'conflict',
        conflict: { currentVersion: 2, headRevision: head },
      })
    }
    expect(await publications(world)).toBe(0)
  })

  it('answers the conflict of the store when another write got in between the read and the publish', async () => {
    const world = await newWorld(env.DB, 'race')
    const { en } = await pair(world)
    let rival = ''
    const racing = agentFor(
      world.context(
        {},
        interleaved(world.store, 'publish', async () => {
          await world.agent.updateDraft({
            id: en.id,
            version: 1,
            markdown: blogPost({ title: 'The rival wins', translationGroup: 'edge-caching-guide' }),
          })
          rival = (await world.agent.getEntry(english)).entry?.revision ?? ''
        }),
      ),
    )

    const lost = await racing.publish({ id: en.id, version: 1 })

    expect(lost).toEqual({
      outcome: 'conflict',
      conflict: { currentVersion: 2, headRevision: rival },
    })
    expect(await entryColumns(world.db, en.id)).toMatchObject({ status: 'draft', version: 2 })
    expect(await publications(world)).toBe(0)
  })

  it('answers not_found for an entry nobody has', async () => {
    const world = await newWorld(env.DB, 'not-found')

    expect(await world.agent.publish({ id: NO_ENTRY, version: 1 })).toEqual({
      outcome: 'not_found',
    })
  })

  it('is blocked, with the size that was counted, when the publication would be over the limit of the database', async () => {
    const world = await newWorld(env.DB, 'too-large')
    // The draft is small, because `many-warnings` only runs when publishing: it is the verdict of
    // the publish that makes the row large.
    const created = await world.agent.createDraft({
      ...NOTE,
      markdown: '---\ntitle: A note\nflood: 12000\n---\n\nText\n',
    })
    const id = created.entry?.id ?? ''

    const answer = await world.agent.publish({ id, version: 1, acknowledgeWarnings: [FLOOD_KEY] })

    const [violation] = answer.verdict?.errors ?? []
    const bytes = Number(
      /^The entry takes (\d+) bytes and the limit is 1900000 bytes\.$/.exec(
        violation?.message ?? '',
      )?.[1],
    )
    expect(bytes).toBeGreaterThan(1_900_000)
    expect(answer).toEqual({
      outcome: 'blocked',
      entry: created.entry,
      verdict: {
        ok: false,
        phase: 'publish',
        errors: [
          {
            contract: 'size-limit',
            severity: 'error',
            path: '',
            message: `The entry takes ${bytes} bytes and the limit is 1900000 bytes.`,
            fix: `Cut at least ${bytes - 1_900_000} bytes: shorten the text, drop what is not essential or split it into several entries.`,
          },
        ],
        warnings: [],
        contractsHash: '',
      },
    })
    expect(await entryColumns(world.db, id)).toMatchObject({ status: 'draft', version: 1 })
    expect(await publications(world)).toBe(0)
  })

  it('is blocked, with the refusal as its verdict, when the latest revision cannot be stored under the rules of now', async () => {
    const world = await newWorld(env.DB, 'refused')
    // A file that the notes took when they allowed 768 KiB, and that they would refuse today.
    const created = await world.agent.createDraft({
      ...NOTE,
      markdown: `---\ntitle: A note\n---\n\n${'x'.repeat(600_000)}\n`,
    })
    const stricter = agentFor({
      ...world.context(),
      site: blogSite(world.tenant.key, { notesMaxBytes: 1_024 }),
    })

    const answer = await stricter.publish({ id: created.entry?.id ?? '', version: 1 })

    expect(answer).toEqual({
      outcome: 'blocked',
      entry: created.entry,
      verdict: {
        ok: false,
        phase: 'publish',
        errors: [
          expect.objectContaining({
            contract: 'size-limit',
            path: '/body',
            message: 'The Markdown file is 600024 bytes and this collection accepts at most 1024.',
          }),
        ],
        warnings: [],
        contractsHash: '',
      },
    })
    expect(await publications(world)).toBe(0)
  })
})

describe('what orders a published entry', () => {
  /** A note published at `at`. */
  async function publishNote(world: World, slug: string, at: string) {
    world.time.set(at)
    const created = await world.agent.createDraft({
      ...NOTE,
      slug,
      markdown: `---\ntitle: ${slug}\n---\n\nText\n`,
    })
    const id = created.entry?.id ?? ''
    const published = await world.agent.publish({ id, version: 1 })
    expect(published.outcome).toBe('published')
    return id
  }

  it('is the value of the sorting field of the collection, when the frontmatter has it as a string', async () => {
    const world = await newWorld(env.DB, 'sort-field')
    const { en } = await pair(world)

    await publishPost(world, en, T1)

    expect((await entryColumns(world.db, en.id))?.published_sort_key).toBe('2026-10-01')
  })

  it('is when the entry was first published, for a collection with no sorting field', async () => {
    const world = await newWorld(env.DB, 'sort-time')

    const id = await publishNote(world, 'first-note', T1)

    expect(await entryColumns(world.db, id)).toMatchObject({
      published_at: T1,
      published_sort_key: T1,
    })
  })

  it('stays where it was after the entry is unpublished and published again', async () => {
    const world = await newWorld(env.DB, 'sort-republish')
    const first = await publishNote(world, 'first-note', T1)
    await publishNote(world, 'second-note', T2)
    world.time.set(T3)
    const unpublished = await world.agent.unpublish({ id: first })
    expect(unpublished.outcome).toBe('unpublished')

    world.time.set('2026-10-13T14:00:00.000Z')
    const again = await world.agent.publish({ id: first, version: unpublished.entry?.version ?? 0 })

    expect(again.outcome).toBe('published')
    expect(await entryColumns(world.db, first)).toMatchObject({
      published_at: T1,
      published_sort_key: T1,
    })
    const page = await world.reader.listEntries({ collection: 'notes' })
    expect(page.entries.map((entry) => entry.slug)).toEqual(['second-note', 'first-note'])
  })
})

describe('unpublish', () => {
  it('takes a published entry back to a draft, which keeps its revisions, and records who did it', async () => {
    const world = await newWorld(env.DB, 'unpublish')
    const { en } = await pair(world)
    const published = await publishPost(world, en, T1)
    world.time.set(T2)
    const client = { name: 'claude-code', version: '1.2.3' }

    const answer = await agentFor(world.context({ client })).unpublish({ id: en.id })

    expect(answer).toEqual({
      outcome: 'unpublished',
      entry: {
        ...published,
        status: 'draft',
        version: 3,
        hasUnpublishedChanges: true,
        // When it was first published stays, so that publishing it again does not move it.
        publishedAt: T1,
        updatedAt: T2,
      },
    })
    expect(await entryColumns(world.db, en.id)).toMatchObject({
      status: 'draft',
      version: 3,
      published_rev: null,
      published_sort_key: null,
    })
    expect(await revisionsOf(world.db, en.id)).toHaveLength(1)
    const [, unpublished, ...others] = await publicationsOf(world.db, en.id)
    expect(others).toEqual([])
    expect(unpublished).toMatchObject({
      action: 'unpublish',
      revision_id: null,
      verdict: null,
      actor_kind: 'token',
      actor_user_id: world.tenant.userId,
      actor_token_id: world.tenant.tokenId,
      created_at: T2,
    })
    expect(JSON.parse(unpublished?.actor_meta ?? '')).toEqual(client)
  })

  it('leaves an entry that is not published as it is: no new version, and nothing recorded', async () => {
    const world = await newWorld(env.DB, 'unpublish-draft')
    const draft = await createPost(world, { slug: 'edge-caching-guide', at: T0 })
    world.time.set(T1)

    const answer = await world.agent.unpublish({ id: draft.id })

    expect(answer).toEqual({ outcome: 'unpublished', entry: draft })
    expect(await publications(world)).toBe(0)
    expect(await entryColumns(world.db, draft.id)).toMatchObject({ version: 1, updated_at: T0 })
  })

  it('answers not_found for an entry nobody has', async () => {
    const world = await newWorld(env.DB, 'unpublish-none')

    expect(await world.agent.unpublish({ id: NO_ENTRY })).toEqual({ outcome: 'not_found' })
  })
})
