import { env } from 'cloudflare:workers'
import { COMARK_VERSION, PIPELINE_VERSION } from '@hollware/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import { countRows, newRevision, storedTags } from '../db/support.ts'
import { agent as agentFor, blogPost, NO_ENTRY, warmUpComark } from './support.ts'
import {
  createPost,
  entryColumns,
  interleaved,
  newWorld,
  revisionsOf,
  type World,
} from './world.ts'

// Fails when: create_draft or update_draft stop saving what the pipeline and the contracts made of
// a file the way the specs say. create-draft.ts, update-draft.ts and draft.ts store the Markdown
// as the caller sent it, derive the frontmatter, tags, translation group, word count and versions
// from what the pipeline returned and from the fields the collection names (and from nothing
// else), record the actor and what its client said (an OAuth client by its id, with no token), save a draft whose contracts fail, refuse
// only what cannot be stored, put the version check of update_draft before everything else
// (conflict wins over unchanged, over a refusal and over a save), answer unchanged for the file
// the head already holds and write nothing then, hand the pipeline the components, the size limit
// and the routes of the collection, and map each refusal of the store: a slug or a translation
// that is taken, a row over the limit, and a conflict that a competing write caused.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const ENTRY_ID = expect.stringMatching(/^ent_[0-9A-HJKMNP-TV-Z]{26}$/)
const HASH = expect.stringMatching(/^[0-9a-f]{64}$/)
const english = { collection: 'blog', locale: 'en', slug: 'edge-caching-guide' }
const T0 = '2026-10-13T10:00:00.000Z'

/** The verdict of a file with nothing to fix. */
const CLEAN = { ok: true, phase: 'write', errors: [], warnings: [], contractsHash: HASH }

/** The refusal of a write: no contract ran, so the hash is empty. */
function refusal(...errors: unknown[]) {
  return {
    outcome: 'refused',
    verdict: { ok: false, phase: 'write', errors, warnings: [], contractsHash: '' },
  }
}

/** The rows of a site that a write adds to, for the tests that say nothing was written. */
async function rowsOf(world: World) {
  const { db, tenant } = world
  return {
    entries: await countRows(db, 'entries', tenant.key),
    revisions: await countRows(db, 'revisions', tenant.key),
    tags: await countRows(db, 'revision_tags', tenant.key),
    publications: await countRows(db, 'publications', tenant.key),
  }
}

describe('create_draft', () => {
  it('saves a draft at version 1: the Markdown as it came, and everything else derived from it', async () => {
    const world = await newWorld(env.DB, 'create')
    world.time.set(T0)
    const client = { name: 'claude-code', version: '1.2.3' }
    const markdown = blogPost(
      { tags: '[cms, cloudflare, cms]' },
      '\n# Edge caching guide\n\nWhat an edge cache keeps.\n',
    )

    const created = await agentFor(world.context({ client })).createDraft({
      ...english,
      markdown,
    })

    expect(created).toEqual({
      outcome: 'saved',
      entry: {
        id: ENTRY_ID,
        collection: 'blog',
        locale: 'en',
        slug: 'edge-caching-guide',
        translationGroup: 'edge-caching-guide',
        status: 'draft',
        version: 1,
        frontmatter: {
          title: 'Edge caching guide',
          description: 'How to cache at the edge.',
          date: '2026-10-01',
          tags: ['cms', 'cloudflare', 'cms'],
          translationGroup: 'edge-caching-guide',
        },
        // Each tag once and sorted, as the store keeps them.
        tags: ['cloudflare', 'cms'],
        hasUnpublishedChanges: true,
        publishedAt: null,
        scheduledAt: null,
        updatedAt: T0,
      },
      verdict: CLEAN,
    })
    const id = created.entry?.id ?? ''
    const [revision, ...others] = await revisionsOf(world.db, id)
    expect(others).toEqual([])
    expect(revision).toMatchObject({
      markdown,
      comark_version: COMARK_VERSION,
      pipeline_version: PIPELINE_VERSION,
      word_count: 8,
      actor_kind: 'token',
      actor_user_id: world.tenant.userId,
      actor_token_id: world.tenant.tokenId,
      created_at: T0,
    })
    expect(JSON.parse(revision?.frontmatter ?? '')).toEqual(created.entry?.frontmatter)
    expect(JSON.parse(revision?.actor_meta ?? '')).toEqual(client)
    expect(JSON.parse(revision?.verdict ?? '')).toEqual(created.verdict)
    expect(await storedTags(world.db, revision?.id ?? '')).toEqual(['cloudflare', 'cms'])
    expect(await entryColumns(world.db, id)).toMatchObject({
      status: 'draft',
      version: 1,
      head_rev: revision?.id,
      published_rev: null,
      translation_group: 'edge-caching-guide',
    })
  })

  it('records an OAuth client as the actor, with its id beside what it said, and no token', async () => {
    const world = await newWorld(env.DB, 'create-oauth')
    world.time.set(T0)
    const client = { name: 'claude-ai', version: '2.0.0' }
    const principal = {
      kind: 'oauth',
      userId: world.tenant.userId,
      clientId: 'https://claude.ai/oauth/mcp-client.json',
      site: world.tenant.key,
      scopes: ['content:read', 'content:write'],
    } as const

    const created = await agentFor(world.context({ client, principal })).createDraft({
      ...english,
      markdown: blogPost(),
    })

    const [revision] = await revisionsOf(world.db, created.entry?.id ?? '')
    expect(revision).toMatchObject({
      actor_kind: 'oauth_client',
      actor_user_id: world.tenant.userId,
      actor_token_id: null,
    })
    expect(JSON.parse(revision?.actor_meta ?? '')).toEqual({
      name: 'claude-ai',
      version: '2.0.0',
      oauthClient: 'https://claude.ai/oauth/mcp-client.json',
    })
  })

  it('saves a draft whose contracts fail, and keeps what the verdict says with the revision', async () => {
    const world = await newWorld(env.DB, 'create')

    const created = await world.agent.createDraft({
      ...english,
      markdown: blogPost({ description: null }),
    })

    expect(created.outcome).toBe('saved')
    expect(created.verdict?.ok).toBe(false)
    const [revision] = await revisionsOf(world.db, created.entry?.id ?? '')
    expect(JSON.parse(revision?.verdict ?? '')).toEqual(created.verdict)
    expect(created.entry?.version).toBe(1)
  })

  it('reads the translation group and the tags from the fields the collection names, and from nothing else', async () => {
    const world = await newWorld(env.DB, 'fields')
    const note = (slug: string) =>
      world.agent.createDraft({
        collection: 'notes',
        locale: 'en',
        slug,
        markdown: `---\ntitle: A note\ntranslationGroup: same\ntags: [a, b]\n---\n\nText\n`,
      })

    const first = await note('first-note')
    const second = await note('second-note')

    // `notes` names no field for either, so both entries are saved, in one locale, under one "group".
    expect([first.outcome, second.outcome]).toEqual(['saved', 'saved'])
    expect(first.entry).toMatchObject({ translationGroup: null, tags: [] })
    expect(second.entry).toMatchObject({ translationGroup: null, tags: [] })
  })

  it('stores no group and no tags for values that are not a string and a list of strings, and saves the draft with the schema errors', async () => {
    const world = await newWorld(env.DB, 'fields')

    const created = await world.agent.createDraft({
      ...english,
      markdown: blogPost({ translationGroup: '5', tags: '[cloudflare, 1]' }),
    })

    expect(created.outcome).toBe('saved')
    expect(created.entry).toMatchObject({ translationGroup: null, tags: [] })
    expect(created.verdict?.errors.map((error) => [error.contract, error.path])).toEqual([
      ['schema', '/frontmatter/tags/1'],
      ['schema', '/frontmatter/translationGroup'],
    ])
  })

  it('takes an empty translation group for none, so two drafts of one locale do not refuse each other', async () => {
    const world = await newWorld(env.DB, 'fields')
    const draft = (slug: string) =>
      world.agent.createDraft({
        collection: 'blog',
        locale: 'en',
        slug,
        markdown: blogPost({ translationGroup: "''" }),
      })

    const first = await draft('first-post')
    const second = await draft('second-post')

    expect([first.outcome, second.outcome]).toEqual(['saved', 'saved'])
    expect(first.entry?.translationGroup).toBeNull()
    expect(second.entry?.translationGroup).toBeNull()
  })

  it('refuses a file whose frontmatter does not parse, with the violation as the whole verdict, and writes nothing', async () => {
    const world = await newWorld(env.DB, 'refused')

    const created = await world.agent.createDraft({
      ...english,
      markdown:
        '---\ntitle: [an unclosed list\ndescription: The YAML above does not parse.\n---\n\nBody\n',
    })

    expect(created).toEqual(
      refusal(
        expect.objectContaining({
          contract: 'frontmatter-syntax',
          severity: 'error',
          path: '/frontmatter',
          line: 3,
          fix: expect.stringMatching(/\S/),
        }),
      ),
    )
    expect(await rowsOf(world)).toEqual({ entries: 0, revisions: 0, tags: 0, publications: 0 })
  })

  it('refuses a file over the size limit of its own collection, and accepts it where the limit is larger', async () => {
    const world = await newWorld(env.DB, 'size')
    // 600,000 bytes: over the 524,288 of the blog, under the 786,432 of the notes.
    const file = 'x'.repeat(600_000)

    const blog = await world.agent.createDraft({ ...english, markdown: file })
    const notes = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'a-long-note',
      markdown: file,
    })

    expect(blog).toEqual(
      refusal({
        contract: 'size-limit',
        severity: 'error',
        path: '/body',
        message: 'The Markdown file is 600000 bytes and this collection accepts at most 524288.',
        fix: 'Shorten the file to 524288 bytes or fewer, counting the frontmatter, or split the content into several entries.',
      }),
    )
    expect(notes.outcome).toBe('saved')
    expect(await rowsOf(world)).toMatchObject({ entries: 1, revisions: 1 })
  })

  it('lets a collection use its own components, and no others', async () => {
    const world = await newWorld(env.DB, 'components')
    const body = '\n::callout{type="tip"}\nKeep the slug short.\n::\n'

    const blog = await world.agent.createDraft({
      ...english,
      markdown: blogPost({}, body),
    })
    const notes = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'a-note',
      markdown: `---\ntitle: A note\n---\n${body}`,
    })

    expect(blog.verdict?.errors).toEqual([])
    expect(notes.verdict?.errors).toEqual([
      expect.objectContaining({
        contract: 'unknown-component',
        message: 'The component "callout" does not exist in this collection.',
        fix: 'This collection allows no components: remove it and use Markdown.',
      }),
    ])
  })

  it('refuses a slug that another entry of the collection and locale has, and names that entry', async () => {
    const world = await newWorld(env.DB, 'taken')
    const first = await createPost(world, { slug: 'edge-caching-guide' })
    const before = await rowsOf(world)

    const again = await world.agent.createDraft({
      ...english,
      markdown: blogPost({ translationGroup: 'another-group' }),
    })

    expect(again).toEqual(
      refusal({
        contract: 'unique-slug',
        severity: 'error',
        path: '',
        message: `Another entry of this collection and locale, ${first.id}, already has this slug.`,
        fix: `Choose another slug, or change the entry ${first.id} with update_draft.`,
      }),
    )
    expect(await rowsOf(world)).toEqual(before)
  })

  it('refuses a translation that another entry of the collection and locale already is', async () => {
    const world = await newWorld(env.DB, 'taken')
    const first = await createPost(world, { slug: 'edge-caching-guide', group: 'guide' })
    const before = await rowsOf(world)

    const again = await world.agent.createDraft({
      collection: 'blog',
      locale: 'en',
      slug: 'a-second-slug',
      markdown: blogPost({ translationGroup: 'guide' }),
    })

    expect(again).toEqual(
      refusal({
        contract: 'unique-translation',
        severity: 'error',
        path: '/frontmatter/translationGroup',
        message: `Another entry of this collection and locale, ${first.id}, already belongs to this translation group.`,
        fix: `Give "translationGroup" another value, or change the entry ${first.id} with update_draft: a translation group holds one entry per locale.`,
      }),
    )
    expect(await rowsOf(world)).toEqual(before)
  })

  it('refuses a row over the limit of the database as size-limit, with the sizes the store counted, and writes nothing', async () => {
    const world = await newWorld(env.DB, 'too-large')
    // The file is under the limit of the collection, but its row also holds the frontmatter and the
    // document, which repeat it: about three times the file.
    const markdown = `---\ntitle: A note\nfiller: ${'a'.repeat(700_000)}\n---\n\nText\n`

    const created = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'a-big-note',
      markdown,
    })

    const [violation] = created.verdict?.errors ?? []
    const bytes = Number(
      /^The entry takes (\d+) bytes and the limit is 1900000 bytes\.$/.exec(
        violation?.message ?? '',
      )?.[1],
    )
    expect(bytes).toBeGreaterThan(1_900_000)
    expect(created).toEqual(
      refusal({
        contract: 'size-limit',
        severity: 'error',
        path: '',
        message: `The entry takes ${bytes} bytes and the limit is 1900000 bytes.`,
        fix: `Cut at least ${bytes - 1_900_000} bytes: shorten the text, drop what is not essential or split it into several entries.`,
      }),
    )
    expect(created.outcome).toBe('refused')
    expect(await rowsOf(world)).toEqual({ entries: 0, revisions: 0, tags: 0, publications: 0 })
  })
})

describe('update_draft', () => {
  const edited = blogPost({
    title: 'A better title',
    tags: '[agents]',
    translationGroup: 'guide-2',
  })

  async function entryAtVersion1(world: World) {
    return createPost(world, {
      slug: 'edge-caching-guide',
      group: 'guide',
      tags: '[cloudflare, cms]',
      at: T0,
    })
  }

  it('saves a new revision at the next version, with its own tags and the translation group of its frontmatter', async () => {
    const world = await newWorld(env.DB, 'update')
    const created = await entryAtVersion1(world)
    world.time.set('2026-10-13T11:00:00.000Z')
    const client = { name: 'claude-code', version: '1.2.3' }

    const updated = await agentFor(world.context({ client })).updateDraft({
      id: created.id,
      version: 1,
      markdown: edited,
    })

    expect(updated).toEqual({
      outcome: 'saved',
      entry: {
        id: created.id,
        collection: 'blog',
        locale: 'en',
        slug: 'edge-caching-guide',
        translationGroup: 'guide-2',
        status: 'draft',
        version: 2,
        frontmatter: {
          title: 'A better title',
          description: 'How to cache at the edge.',
          date: '2026-10-01',
          tags: ['agents'],
          translationGroup: 'guide-2',
        },
        tags: ['agents'],
        hasUnpublishedChanges: true,
        publishedAt: null,
        scheduledAt: null,
        updatedAt: '2026-10-13T11:00:00.000Z',
      },
      verdict: CLEAN,
    })
    const [first, second, ...others] = await revisionsOf(world.db, created.id)
    expect(others).toEqual([])
    // The first revision is as it was, and the second carries what the update was written with.
    expect(first).toMatchObject({ actor_meta: null, created_at: T0 })
    expect(second).toMatchObject({
      markdown: edited,
      word_count: 8,
      actor_kind: 'token',
      actor_user_id: world.tenant.userId,
      actor_token_id: world.tenant.tokenId,
      created_at: '2026-10-13T11:00:00.000Z',
    })
    expect(JSON.parse(second?.actor_meta ?? '')).toEqual(client)
    expect(await storedTags(world.db, first?.id ?? '')).toEqual(['cloudflare', 'cms'])
    expect(await storedTags(world.db, second?.id ?? '')).toEqual(['agents'])
    expect(await entryColumns(world.db, created.id)).toMatchObject({
      version: 2,
      head_rev: second?.id,
      translation_group: 'guide-2',
      updated_at: '2026-10-13T11:00:00.000Z',
    })
  })

  it('answers unchanged, with the verdict that is stored, for the file the head already holds, and writes nothing', async () => {
    const world = await newWorld(env.DB, 'unchanged')
    const markdown = blogPost({ description: null })
    const created = await world.agent.createDraft({ ...english, markdown })
    const id = created.entry?.id ?? ''
    world.time.set('2026-10-13T12:00:00.000Z')
    const before = await rowsOf(world)

    const again = await world.agent.updateDraft({ id, version: 1, markdown })

    // The verdict says again what is wrong, because that is what is stored with the revision.
    expect(created.verdict?.ok).toBe(false)
    expect(again).toEqual({ outcome: 'unchanged', entry: created.entry, verdict: created.verdict })
    expect(await rowsOf(world)).toEqual(before)
    expect(await entryColumns(world.db, id)).toMatchObject({ version: 1, updated_at: T0 })
  })

  it('compares with the head and not with an earlier revision: the first file again is a change', async () => {
    const world = await newWorld(env.DB, 'unchanged')
    const first = blogPost({ title: 'The first file' })
    const second = blogPost({ title: 'The second file' })
    const created = await world.agent.createDraft({ ...english, markdown: first })
    const id = created.entry?.id ?? ''
    await world.agent.updateDraft({ id, version: 1, markdown: second })

    const same = await world.agent.updateDraft({ id, version: 2, markdown: second })
    const back = await world.agent.updateDraft({ id, version: 2, markdown: first })

    expect(same.outcome).toBe('unchanged')
    expect(back.outcome).toBe('saved')
    expect(back.entry?.version).toBe(3)
    expect(await revisionsOf(world.db, id)).toHaveLength(3)
  })

  it('answers conflict, with the current version and head, to a version the entry has left, whatever the file is', async () => {
    const world = await newWorld(env.DB, 'conflict')
    const created = await entryAtVersion1(world)
    const markdown = blogPost({ title: 'The second file', translationGroup: 'guide' })
    await world.agent.updateDraft({ id: created.id, version: 1, markdown })
    const head = (await world.agent.getEntry(english)).entry?.revision
    const before = await rowsOf(world)

    const answers = [
      // The head's own file, which would be `unchanged` at the right version.
      await world.agent.updateDraft({ id: created.id, version: 1, markdown }),
      // A file that cannot be stored, which would be `refused` at the right version.
      await world.agent.updateDraft({
        id: created.id,
        version: 1,
        markdown: '---\ntitle: [\n---\n',
      }),
      // A new file, which would be saved.
      await world.agent.updateDraft({ id: created.id, version: 1, markdown: edited }),
      // A version the entry has not reached yet.
      await world.agent.updateDraft({ id: created.id, version: 3, markdown: edited }),
    ]

    for (const answer of answers) {
      expect(answer).toEqual({
        outcome: 'conflict',
        conflict: { currentVersion: 2, headRevision: head },
      })
    }
    expect(await rowsOf(world)).toEqual(before)
    expect((await entryColumns(world.db, created.id))?.head_rev).toBe(head)
  })

  it('answers not_found for an entry nobody has, and writes nothing', async () => {
    const world = await newWorld(env.DB, 'not-found')
    const before = await rowsOf(world)

    const answer = await world.agent.updateDraft({ id: NO_ENTRY, version: 1, markdown: edited })

    expect(answer).toEqual({ outcome: 'not_found' })
    expect(await rowsOf(world)).toEqual(before)
  })

  it('refuses a file that cannot be stored, and the entry stays at its version', async () => {
    const world = await newWorld(env.DB, 'refused')
    const created = await entryAtVersion1(world)
    const before = await rowsOf(world)

    const answer = await world.agent.updateDraft({
      id: created.id,
      version: 1,
      markdown: '---\ntitle: [an unclosed list\n---\n',
    })

    expect(answer).toEqual(
      refusal(expect.objectContaining({ contract: 'frontmatter-syntax', path: '/frontmatter' })),
    )
    expect(await rowsOf(world)).toEqual(before)
    expect((await entryColumns(world.db, created.id))?.version).toBe(1)
  })

  it('refuses a translation group that another entry of the locale already has, and changes nothing', async () => {
    const world = await newWorld(env.DB, 'taken')
    const first = await createPost(world, { slug: 'first-post', group: 'guide' })
    const second = await createPost(world, { slug: 'second-post', group: 'other' })
    const before = await rowsOf(world)

    const answer = await world.agent.updateDraft({
      id: second.id,
      version: 1,
      markdown: blogPost({ translationGroup: 'guide' }),
    })

    expect(answer).toEqual(
      refusal({
        contract: 'unique-translation',
        severity: 'error',
        path: '/frontmatter/translationGroup',
        message: `Another entry of this collection and locale, ${first.id}, already belongs to this translation group.`,
        fix: `Give "translationGroup" another value, or change the entry ${first.id} with update_draft: a translation group holds one entry per locale.`,
      }),
    )
    expect(await rowsOf(world)).toEqual(before)
    expect(await entryColumns(world.db, second.id)).toMatchObject({
      version: 1,
      translation_group: 'other',
    })
  })

  it('refuses a row over the limit of the database as size-limit, and the entry keeps its revision', async () => {
    const world = await newWorld(env.DB, 'too-large')
    const created = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'a-note',
      markdown: '---\ntitle: A note\n---\n\nText\n',
    })
    const id = created.entry?.id ?? ''
    const before = await rowsOf(world)

    const answer = await world.agent.updateDraft({
      id,
      version: 1,
      markdown: `---\ntitle: A note\nfiller: ${'a'.repeat(700_000)}\n---\n\nText\n`,
    })

    expect(answer.outcome).toBe('refused')
    expect(answer.verdict?.errors).toEqual([
      expect.objectContaining({
        contract: 'size-limit',
        message: expect.stringMatching(
          /^The entry takes \d+ bytes and the limit is 1900000 bytes\.$/,
        ),
      }),
    ])
    expect(await rowsOf(world)).toEqual(before)
    expect((await entryColumns(world.db, id))?.version).toBe(1)
  })

  it('answers the conflict of the store, with its current version and head, when another write got in first', async () => {
    const world = await newWorld(env.DB, 'race')
    const created = await entryAtVersion1(world)
    let rival = ''
    const racing = agentFor(
      world.context(
        {},
        interleaved(world.store, 'appendRevision', async () => {
          const won = await world.agent.updateDraft({
            id: created.id,
            version: 1,
            markdown: blogPost({ title: 'The rival wins', translationGroup: 'guide' }),
          })
          rival = (await world.agent.getEntry(english)).entry?.revision ?? ''
          expect(won.outcome).toBe('saved')
        }),
      ),
    )

    const lost = await racing.updateDraft({ id: created.id, version: 1, markdown: edited })

    expect(lost).toEqual({
      outcome: 'conflict',
      conflict: { currentVersion: 2, headRevision: rival },
    })
    // The loser wrote nothing: its revision and its tags are not there.
    const revisions = await revisionsOf(world.db, created.id)
    expect(revisions.map((revision) => revision.id)).toHaveLength(2)
    expect((await entryColumns(world.db, created.id))?.head_rev).toBe(rival)
    expect(await countRows(world.db, 'revision_tags', world.tenant.key)).toBe(4)
  })

  it('tells the contracts which entry a file is for: none while it is created, the entry once it is updated', async () => {
    const world = await newWorld(env.DB, 'probe')
    const created = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'a-note',
      markdown: '---\ntitle: A note\nprobe: true\n---\n\nText\n',
    })
    const id = created.entry?.id ?? ''

    const updated = await world.agent.updateDraft({
      id,
      version: 1,
      markdown: '---\ntitle: A note\nprobe: true\n---\n\nMore text\n',
    })

    expect(created.verdict?.warnings.map((warning) => warning.message)).toEqual([
      'Run for the entry null.',
    ])
    expect(updated.verdict?.warnings.map((warning) => warning.message)).toEqual([
      `Run for the entry ${id}.`,
    ])
  })

  it('cannot write an entry whose collection the config no longer declares, and says whom to ask', async () => {
    const world = await newWorld(env.DB, 'legacy')
    const store = createD1Store(env.DB, { clock: world.time.clock })
    const stored = await store.createEntry(world.tenant.key, {
      collection: 'legacy',
      locale: 'en',
      slug: 'an-old-post',
      translationGroup: null,
      revision: newRevision({
        kind: 'token',
        userId: world.tenant.userId,
        tokenId: world.tenant.tokenId,
        meta: null,
      }),
    })
    if (stored.outcome !== 'saved') throw new Error('the store did not save the legacy entry')
    const id = stored.view.entry.id
    const before = await rowsOf(world)

    await expect(
      world.agent.updateDraft({ id, version: 1, markdown: edited }),
    ).rejects.toMatchObject({
      name: 'HollwareError',
      code: 'unknown_collection',
      message: `The entry ${id} belongs to the collection "legacy", which the config of the site no longer declares.`,
      fix: 'Ask whoever maintains hollware.config.ts to declare the collection "legacy" again: the entry and its revisions are kept.',
    })
    await expect(world.agent.publish({ id, version: 1 })).rejects.toMatchObject({
      code: 'unknown_collection',
    })
    expect(await rowsOf(world)).toEqual(before)
  })
})
