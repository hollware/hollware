import { isId } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import type { Actor, ContentStore, EntryView } from '../../src/ports.ts'
import {
  countRows,
  entryRow,
  fixedClock,
  newRevision,
  seedOwner,
  siteKey,
  storedTags,
  VERDICT,
} from './support.ts'

const NOW = '2026-10-12T10:00:00.000Z'

const HELLO = { collection: 'blog', locale: 'en', slug: 'hello' }

async function created(answer: ReturnType<ContentStore['createEntry']>): Promise<EntryView> {
  const result = await answer
  if (result.outcome !== 'saved')
    throw new Error(`The entry was not saved: ${JSON.stringify(result)}`)
  return result.view
}

describe('createEntry', () => {
  it('saves a draft at version 1 with its first revision, its tags and its actor', async () => {
    const owner = await seedOwner(env.DB, siteKey('create'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const markdown = '---\ntitle: Hello\n---\n\nHello world\n'

    const result = await store.createEntry(owner.site, {
      ...HELLO,
      translationGroup: 'greetings',
      revision: newRevision(owner.actor, {
        markdown,
        tags: ['news', 'agents'],
        actor: { ...owner.actor, meta: { client: 'claude-code' } },
      }),
    })

    if (result.outcome !== 'saved') throw new Error(`Not saved: ${JSON.stringify(result)}`)
    const { entry, revision } = result.view
    expect(isId('ent', entry.id)).toBe(true)
    expect(isId('rev', revision.id)).toBe(true)
    expect(result.view).toEqual({
      entry: {
        id: entry.id,
        collection: 'blog',
        locale: 'en',
        slug: 'hello',
        translationGroup: 'greetings',
        status: 'draft',
        version: 1,
        headRevision: revision.id,
        publishedRevision: null,
        publishedAt: null,
        scheduledAt: null,
        deletedAt: null,
        updatedAt: NOW,
      },
      revision: {
        id: revision.id,
        entryId: entry.id,
        markdown,
        frontmatter: { title: 'Hello' },
        document: { nodes: [['p', {}, 'Hello world']], frontmatter: { title: 'Hello' }, meta: {} },
        comarkVersion: '0.7.0',
        pipelineVersion: '1',
        wordCount: 2,
        codeWords: 0,
        verdict: VERDICT,
        tags: ['agents', 'news'],
        actor: { ...owner.actor, meta: { client: 'claude-code' } },
        createdAt: NOW,
      },
    })
    expect(await store.findEntryById(owner.site, entry.id, 'head')).toEqual(result.view)
    expect(await store.findEntry(owner.site, HELLO, 'published')).toBeNull()
    expect(await entryRow(env.DB, entry.id)).toEqual({
      id: entry.id,
      site_id: owner.site,
      collection: 'blog',
      locale: 'en',
      slug: 'hello',
      translation_group: 'greetings',
      status: 'draft',
      version: 1,
      head_rev: revision.id,
      published_rev: null,
      published_at: null,
      published_sort_key: null,
      scheduled_at: null,
      deleted_at: null,
      created_at: NOW,
      updated_at: NOW,
    })
    expect(
      await env.DB.prepare('SELECT * FROM revisions WHERE id = ?').bind(revision.id).first(),
    ).toEqual({
      id: revision.id,
      site_id: owner.site,
      entry_id: entry.id,
      markdown,
      frontmatter: '{"title":"Hello"}',
      document: '{"nodes":[["p",{},"Hello world"]],"frontmatter":{"title":"Hello"},"meta":{}}',
      comark_version: '0.7.0',
      pipeline_version: '1',
      word_count: 2,
      code_words: 0,
      verdict: '{"ok":true,"phase":"write","errors":[],"warnings":[],"contractsHash":"abc123"}',
      actor_kind: 'token',
      actor_user_id: owner.actor.userId,
      actor_token_id: owner.actor.tokenId,
      actor_meta: '{"client":"claude-code"}',
      created_at: NOW,
      updated_at: NOW,
    })
    expect(await storedTags(env.DB, revision.id)).toEqual(['agents', 'news'])
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(2)
  })

  it('records an actor that is a user with no token, and one that is an OAuth client', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-actor'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const user: Actor = { kind: 'user', userId: owner.actor.userId, tokenId: null, meta: null }
    const client: Actor = {
      kind: 'oauth_client',
      userId: owner.actor.userId,
      tokenId: null,
      meta: { client: 'cursor' },
    }

    const first = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(user),
      }),
    )
    const second = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        slug: 'hello-from-a-client',
        translationGroup: null,
        revision: newRevision(client),
      }),
    )

    expect([first.revision.actor, second.revision.actor]).toEqual([user, client])
    expect((await store.findEntry(owner.site, HELLO, 'head'))?.revision.actor).toEqual(user)
    expect(
      await env.DB.prepare(
        'SELECT actor_kind, actor_token_id, actor_meta FROM revisions WHERE id = ?',
      )
        .bind(second.revision.id)
        .first(),
    ).toEqual({
      actor_kind: 'oauth_client',
      actor_token_id: null,
      actor_meta: '{"client":"cursor"}',
    })
  })

  it('keeps the Markdown byte for byte, the odd characters included', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-bytes'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const markdown =
      '\uFEFF---\r\ntitle: Diseño 🚀\r\n---\r\n\r\nUna línea con espacios al final   \r\n\r\n\r\n'

    const { revision } = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(owner.actor, { markdown }),
      }),
    )

    expect(revision.markdown).toBe(markdown)
    expect(
      await env.DB.prepare('SELECT markdown FROM revisions WHERE id = ?')
        .bind(revision.id)
        .first<string>('markdown'),
    ).toBe(markdown)
  })

  it('writes each tag once, sorted, however the revision listed them', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-tags'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })

    const { revision } = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(owner.actor, { tags: ['b', 'a', 'b', 'c', 'a'] }),
      }),
    )

    expect(revision.tags).toEqual(['a', 'b', 'c'])
    expect(await storedTags(env.DB, revision.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps tags that need escaping in SQL and in JSON', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-escape'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })

    const { revision } = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(owner.actor, {
          tags: ["it's", 'línea\nnueva', 'back\\slash', 'emoji 🚀', 'a"b'],
        }),
      }),
    )

    const sorted = ['a"b', 'back\\slash', 'emoji 🚀', "it's", 'línea\nnueva']
    expect(revision.tags).toEqual(sorted)
    expect(await storedTags(env.DB, revision.id)).toEqual(sorted)
    expect((await store.findEntry(owner.site, HELLO, 'head'))?.revision.tags).toEqual(sorted)
  })

  it('saves 150 tags, in as many statements as the limit of bound values needs', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-150'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const tags = Array.from({ length: 150 }, (_, i) => `tag-${String(i).padStart(3, '0')}`)

    const { revision } = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(owner.actor, { tags: tags.toReversed() }),
      }),
    )

    expect(revision.tags).toEqual(tags)
    expect(await storedTags(env.DB, revision.id)).toEqual(tags)
    expect((await store.findEntry(owner.site, HELLO, 'head'))?.revision.tags).toEqual(tags)
  })

  it('writes the entry, its revision and its tags in one batch: a revision that fails leaves no entry', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-atomic'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const nobody = { ...owner.actor, userId: 'usr_not_a_user' }

    await expect(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(nobody, { tags: ['a'] }),
      }),
    ).rejects.toThrow('FOREIGN KEY constraint failed')

    expect(await countRows(env.DB, 'entries', owner.site)).toBe(0)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(0)
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(0)
  })
})

describe('createEntry for a slug or a translation that is taken', () => {
  it('answers taken by the entry that holds the slug, and writes nothing', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-slug'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const first = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(owner.actor, { tags: ['one'] }),
      }),
    )

    const again = await store.createEntry(owner.site, {
      ...HELLO,
      translationGroup: 'another-group',
      revision: newRevision(owner.actor, { markdown: 'second', tags: ['two', 'three'] }),
    })

    expect(again).toEqual({ outcome: 'taken', field: 'slug', by: first.entry.id })
    expect(await countRows(env.DB, 'entries', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(1)
    expect((await store.findEntryById(owner.site, first.entry.id, 'head'))?.revision.markdown).toBe(
      first.revision.markdown,
    )
  })

  it('answers taken by the entry that holds the translation, and writes nothing', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-group'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const first = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: 'greetings',
        revision: newRevision(owner.actor),
      }),
    )

    const again = await store.createEntry(owner.site, {
      ...HELLO,
      slug: 'hello-again',
      translationGroup: 'greetings',
      revision: newRevision(owner.actor, { tags: ['two'] }),
    })

    expect(again).toEqual({ outcome: 'taken', field: 'translationGroup', by: first.entry.id })
    expect(await countRows(env.DB, 'entries', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(0)
  })

  it('reports the slug first when it and the translation are both taken, by different entries', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-both'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const bySlug = await created(
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(owner.actor),
      }),
    )
    await created(
      store.createEntry(owner.site, {
        ...HELLO,
        slug: 'holds-the-group',
        translationGroup: 'greetings',
        revision: newRevision(owner.actor),
      }),
    )

    const again = await store.createEntry(owner.site, {
      ...HELLO,
      translationGroup: 'greetings',
      revision: newRevision(owner.actor),
    })

    expect(again).toEqual({ outcome: 'taken', field: 'slug', by: bySlug.entry.id })
  })

  it('lets the same slug, or the same translation group, live in another locale or collection, and entries with no group share none', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-free'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const make = (
      ref: { collection: string; locale: string; slug: string },
      group: string | null,
    ) =>
      store.createEntry(owner.site, {
        ...ref,
        translationGroup: group,
        revision: newRevision(owner.actor),
      })

    const results = [
      await make(HELLO, 'greetings'),
      await make({ ...HELLO, locale: 'es', slug: 'hola' }, 'greetings'),
      await make({ ...HELLO, locale: 'pt' }, null),
      await make({ ...HELLO, collection: 'docs' }, 'greetings'),
      await make({ ...HELLO, slug: 'no-group-1' }, null),
      await make({ ...HELLO, slug: 'no-group-2' }, null),
    ]

    expect(results.map((result) => result.outcome)).toEqual(Array(6).fill('saved'))
    expect(await countRows(env.DB, 'entries', owner.site)).toBe(6)
  })

  it('answers saved to one of two creates that race for a slug, and taken, by the winner, to the other', async () => {
    const owner = await seedOwner(env.DB, siteKey('create-race'))
    const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
    const make = (markdown: string) =>
      store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: newRevision(owner.actor, { markdown, tags: [markdown] }),
      })

    const results = await Promise.all([make('first'), make('second')])

    const winner = results.find((result) => result.outcome === 'saved')
    const loser = results.find((result) => result.outcome === 'taken')
    if (winner?.outcome !== 'saved' || loser === undefined) {
      throw new Error(`Not one of each: ${JSON.stringify(results)}`)
    }
    expect(loser).toEqual({ outcome: 'taken', field: 'slug', by: winner.view.entry.id })
    expect(await countRows(env.DB, 'entries', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(1)
    expect(await storedTags(env.DB, winner.view.revision.id)).toEqual([
      winner.view.revision.markdown,
    ])
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(1)
  })
})
