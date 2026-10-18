import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { reparseRevisions } from '../../src/derived/reparse.ts'
import { blogPost, warmUpComark } from '../ops/support.ts'
import { newWorld, type World } from '../ops/world.ts'

// Fails when: the cron's reparse (src/derived/reparse.ts) stops rebuilding the document of a
// revision an older pipeline parsed, or rebuilds one of another site, or keeps trying one the
// pipeline now refuses (or of a collection that is gone) every minute, or takes more than its
// batch in one run.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const AT = '2026-10-18T12:00:00.000Z'

async function draft(world: World, slug: string) {
  const created = await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug,
    markdown: blogPost(
      {
        title: 'Parsed again',
        date: '2026-10-01',
        tags: '[cloudflare]',
        translationGroup: slug,
      },
      '\n# Parsed again\n\nThree more words.\n',
    ),
  })
  if (created.entry === undefined) throw new Error(JSON.stringify(created))
  return created.entry.id
}

/** Makes the revisions of an entry look as an older pipeline left them. */
async function age(entryId: string) {
  await env.DB.prepare(
    "UPDATE revisions SET pipeline_version = '1', document = '{}', word_count = 0 WHERE entry_id = ?1",
  )
    .bind(entryId)
    .run()
}

const columns = (entryId: string) =>
  env.DB.prepare('SELECT pipeline_version, document, word_count FROM revisions WHERE entry_id = ?1')
    .bind(entryId)
    .first<{ pipeline_version: string; document: string; word_count: number }>()

describe('the reparse of the cron', () => {
  it('rebuilds what an older pipeline made, in its own site only', async () => {
    const world = await newWorld(env.DB, 'reparse')
    const other = await newWorld(env.DB, 'reparse-other')
    const mine = await draft(world, 'parsed-again')
    const theirs = await draft(other, 'parsed-again')
    const fresh = await columns(mine)
    await age(mine)
    await age(theirs)

    const looked = await reparseRevisions(env.DB, world.tenant.site, AT, () => {})

    expect(looked).toBe(1)
    expect(await columns(mine)).toEqual(fresh)
    expect(await columns(theirs)).toEqual({ pipeline_version: '1', document: '{}', word_count: 0 })
    expect(await reparseRevisions(env.DB, world.tenant.site, AT, () => {})).toBe(0)
  })

  it('keeps the document of a revision it cannot rebuild, and does not try it again', async () => {
    const world = await newWorld(env.DB, 'reparse-gone')
    const id = await draft(world, 'in-a-gone-collection')
    await age(id)
    await env.DB.prepare("UPDATE entries SET collection = 'gone' WHERE id = ?1").bind(id).run()
    const logged: object[] = []

    await reparseRevisions(env.DB, world.tenant.site, AT, (entry) => logged.push(entry))

    expect(await columns(id)).toEqual({ pipeline_version: '2', document: '{}', word_count: 0 })
    expect(logged).toEqual([
      {
        kind: 'reparse',
        site: world.tenant.key,
        revisionId: expect.stringMatching(/^rev_/),
        outcome: 'kept',
      },
    ])
    expect(await reparseRevisions(env.DB, world.tenant.site, AT, () => {})).toBe(0)
  })

  it('takes at most its batch in one run', async () => {
    const world = await newWorld(env.DB, 'reparse-batch')
    for (const slug of ['one', 'two', 'three']) await age(await draft(world, slug))

    expect(await reparseRevisions(env.DB, world.tenant.site, AT, () => {}, 2)).toBe(2)
    expect(await reparseRevisions(env.DB, world.tenant.site, AT, () => {}, 2)).toBe(1)
  })
})
