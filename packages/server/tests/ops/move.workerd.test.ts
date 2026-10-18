import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { agent, warmUpComark } from './support.ts'
import { createPost, newWorld, publishPost, type World } from './world.ts'

// Fails when: move_entry (src/ops/move.ts, moveEntry of src/db/writes.ts) stops giving an entry its
// new slug with the next version, keeping its revisions; stops keeping the old slug as a redirect
// for an entry that was ever published (and keeps one for a draft never published); lets a slug
// another entry holds be taken; moves at a version that is not the entry's; lets a published entry
// move without content:publish; leaves a redirect from a slug an entry takes again; or
// list_redirects stops answering the old and the new path of each, newest first, a page at a
// time, of its own site only.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

async function live(world: World, slug: string) {
  const en = await createPost(world, { slug, group: slug })
  await createPost(world, { slug: `${slug}-es`, locale: 'es', group: slug })
  return publishPost(world, en)
}

describe('move_entry', () => {
  it('gives a published entry another slug, and keeps the old one as a redirect', async () => {
    const world = await newWorld(env.DB, 'move')
    const entry = await live(world, 'edge-caching')

    const moved = await world.agent.moveEntry({
      id: entry.id,
      version: entry.version,
      slug: 'caching-at-the-edge',
    })
    const redirects = await world.agent.listRedirects()

    expect([moved.outcome, moved.entry?.slug, moved.entry?.version]).toEqual([
      'moved',
      'caching-at-the-edge',
      entry.version + 1,
    ])
    expect(redirects.redirects).toEqual([
      {
        collection: 'blog',
        locale: 'en',
        from: 'edge-caching',
        to: 'caching-at-the-edge',
        fromPath: '/en/blog/edge-caching/',
        toPath: '/en/blog/caching-at-the-edge/',
        entryId: entry.id,
      },
    ])
    expect(moved.redirect?.fromPath).toBe('/en/blog/edge-caching/')
    // The subscribers hear of it at its new path, and purge the pages that showed it by its tags.
    const { results } = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE site_id = ?1 AND entry_id = ?2 AND kind = 'entry.published' ORDER BY created_at DESC, rowid DESC LIMIT 1",
    )
      .bind(world.tenant.key, entry.id)
      .all<{ payload: string }>()
    expect(JSON.parse(results[0]?.payload ?? '{}').path).toBe('/en/blog/caching-at-the-edge/')
    expect(
      (
        await world.agent.getEntry({
          collection: 'blog',
          locale: 'en',
          slug: 'caching-at-the-edge',
        })
      ).entry?.id,
    ).toBe(entry.id)
  })

  it('keeps no redirect for a draft never published, and refuses a slug that is taken', async () => {
    const world = await newWorld(env.DB, 'move-draft')
    const draft = await createPost(world, { slug: 'first-name', group: 'first-name' })
    await createPost(world, { slug: 'taken-name', group: 'taken-name' })

    const taken = await world.agent.moveEntry({ id: draft.id, version: 1, slug: 'taken-name' })
    const stale = await world.agent.moveEntry({ id: draft.id, version: 9, slug: 'free-name' })
    const moved = await world.agent.moveEntry({ id: draft.id, version: 1, slug: 'free-name' })
    const same = await world.agent.moveEntry({ id: draft.id, version: 2, slug: 'free-name' })

    expect([taken.outcome, stale.outcome, moved.outcome, same.outcome]).toEqual([
      'taken',
      'conflict',
      'moved',
      'unchanged',
    ])
    expect(moved.redirect).toBeUndefined()
    expect((await world.agent.listRedirects()).redirects).toEqual([])
  })

  it('takes content:publish for a published entry', async () => {
    const world = await newWorld(env.DB, 'move-scope')
    const entry = await live(world, 'scoped')
    const writer = agent(
      world.context({
        principal: {
          kind: 'token',
          userId: world.tenant.userId,
          tokenId: world.tenant.tokenId,
          site: world.tenant.key,
          scopes: ['content:read', 'content:write'],
        },
      }),
    )

    await expect(
      writer.moveEntry({ id: entry.id, version: entry.version, slug: 'elsewhere' }),
    ).rejects.toThrow('takes content:publish')
  })

  it('drops the redirect from a slug the entry takes back, and pages the rest', async () => {
    const world = await newWorld(env.DB, 'move-back')
    const other = await newWorld(env.DB, 'move-back-other')
    const entry = await live(world, 'one')
    const there = await world.agent.moveEntry({ id: entry.id, version: entry.version, slug: 'two' })
    world.time.set('2026-10-13T11:00:00.000Z')
    const again = await world.agent.moveEntry({
      id: entry.id,
      version: there.entry?.version ?? 0,
      slug: 'three',
    })
    const page = await world.agent.listRedirects({ limit: 1 })
    const next = await world.agent.listRedirects({ limit: 1, cursor: page.nextCursor ?? '' })
    await world.agent.moveEntry({ id: entry.id, version: again.entry?.version ?? 0, slug: 'one' })

    expect(
      [...page.redirects, ...next.redirects].map((redirect) => [redirect.from, redirect.to]),
    ).toEqual([
      ['two', 'three'],
      ['one', 'three'],
    ])
    // Back at one: no redirect from it any more, and the one from two leads to one.
    expect(
      (await world.agent.listRedirects()).redirects.map((redirect) => [redirect.from, redirect.to]),
    ).toEqual([
      ['three', 'one'],
      ['two', 'one'],
    ])
    expect((await other.agent.listRedirects()).redirects).toEqual([])
  })
})
