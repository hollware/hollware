import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, warmUpComark } from './support.ts'
import { createPost, newWorld, publishPost, revisionsOf } from './world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const markdownOf = (title: string) =>
  blogPost({ title, date: '2026-10-01', tags: '[cloudflare]', translationGroup: 'history' })

async function threeRevisions(label: string) {
  const world = await newWorld(env.DB, label)
  const created = await createPost(world, {
    slug: 'history',
    title: 'First',
    group: 'history',
    at: '2026-10-18T10:00:00.000Z',
  })
  await createPost(world, { slug: 'historia', locale: 'es', group: 'history' })
  const published = await publishPost(world, created, '2026-10-18T10:30:00.000Z')
  world.time.set('2026-10-18T11:00:00.000Z')
  const second = await world.agent.updateDraft({
    id: created.id,
    version: published.version,
    markdown: markdownOf('Second'),
  })
  if (second.entry === undefined) throw new Error(JSON.stringify(second))
  return { world, id: created.id, version: second.entry.version }
}

describe('the history of an entry', () => {
  it('lists every revision newest first, a page at a time, with what each is', async () => {
    const { world, id } = await threeRevisions('history-list')

    const first = await world.agent.listRevisions({ id, limit: 1 })
    const next = await world.agent.listRevisions({ id, limit: 1, cursor: first.nextCursor ?? '' })

    expect(
      [...(first.revisions ?? []), ...(next.revisions ?? [])].map((revision) => [
        revision.title,
        revision.head,
        revision.live,
        revision.published,
        revision.via,
        revision.author,
      ]),
    ).toEqual([
      ['Second', true, false, false, 'token', world.tenant.userId],
      ['First', false, true, true, 'token', world.tenant.userId],
    ])
    expect(next.nextCursor).toBe(null)
    expect(first.revisions?.[0]?.createdAt).toBe('2026-10-18T11:00:00.000Z')
  })

  it('reads the whole Markdown of an earlier revision, and nothing of another site', async () => {
    const { world, id } = await threeRevisions('history-get')
    const other = await newWorld(env.DB, 'history-get-other')
    const [, older] = (await world.agent.listRevisions({ id })).revisions ?? []

    const read = await world.agent.getRevision({ id: older?.id ?? '' })
    const theirs = await other.agent.getRevision({ id: older?.id ?? '' })

    expect([read.outcome, read.revision?.markdown]).toEqual(['ok', markdownOf('First')])
    expect(theirs.outcome).toBe('not_found')
  })

  it('goes back to a revision as a new one, and keeps every revision there was', async () => {
    const { world, id, version } = await threeRevisions('history-restore')
    const [, older] = (await world.agent.listRevisions({ id })).revisions ?? []
    const kept = (await revisionsOf(world.db, id)).map((row) => row.markdown)
    const before = kept.length

    const stale = await world.agent.restoreRevision({
      id,
      version: version - 1,
      revision: older?.id ?? '',
    })
    const restored = await world.agent.restoreRevision({ id, version, revision: older?.id ?? '' })
    const again = await world.agent.restoreRevision({
      id,
      version: version + 1,
      revision: older?.id ?? '',
    })

    expect([stale.outcome, restored.outcome, restored.entry?.version, again.outcome]).toEqual([
      'conflict',
      'saved',
      version + 1,
      'unchanged',
    ])
    const after = await revisionsOf(world.db, id)
    expect(after.length).toBe(before + 1)
    expect(after.at(-1)?.markdown).toBe(markdownOf('First'))
    expect(after.slice(0, before).map((row) => row.markdown)).toEqual(kept)
  })

  it('takes no revision of another entry', async () => {
    const { world, id, version } = await threeRevisions('history-other-entry')
    const elsewhere = await createPost(world, { slug: 'elsewhere', group: 'elsewhere' })
    const [own] = (await world.agent.listRevisions({ id: elsewhere.id })).revisions ?? []

    const crossed = await world.agent.restoreRevision({ id, version, revision: own?.id ?? '' })

    expect(crossed.outcome).toBe('not_found')
  })
})
