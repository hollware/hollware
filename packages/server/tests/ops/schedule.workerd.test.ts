import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { handlers } from '../../src/ops/index.ts'
import { runDueSchedules } from '../../src/schedule/run.ts'
import { blogFrontmatter, warmUpComark } from './support.ts'
import { entryColumns, newWorld, publicationsOf, type World } from './world.ts'

// Fails when: a publish with publishAt stops scheduling the entry (status scheduled at the next
// version, no publication yet) after the same checks as a publish; the cron run (src/schedule/
// run.ts) publishes before the time, stops publishing at the time in the name of who scheduled it
// and with the warnings acknowledged then, or keeps a schedule whose entry changed since (the entry
// must go back to a draft); unpublish stops cancelling a schedule; or publishAt is taken with a
// group, or for an entry that is published.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const LATER = '2026-10-13T12:00:00.000Z'
const TITLE = 'A guide to caching at the edge of the network with Workers and D1 tonight'
const TITLE_ACK = { contract: 'seo-title-length', path: '/frontmatter/title' }

/** An English post with its Spanish translation, a long title, and no links: one warning. */
async function post(world: World) {
  const frontmatter = blogFrontmatter({ title: JSON.stringify(TITLE) })
  const created = await world.agent.createDraft({
    collection: 'blog',
    locale: 'en',
    slug: 'scheduled-post',
    markdown: `${frontmatter}\nText.\n`,
  })
  await world.agent.createDraft({
    collection: 'blog',
    locale: 'es',
    slug: 'post-programado',
    markdown: `${blogFrontmatter()}\nTexto.\n`,
  })
  if (created.entry === undefined) throw new Error(JSON.stringify(created))
  return created.entry.id
}

function run(world: World) {
  return runDueSchedules({
    site: world.tenant.site,
    store: world.store,
    handlers,
    clock: world.time.clock,
    log: () => {},
  })
}

describe('publishAt', () => {
  it('schedules the entry, and the cron run publishes it at the time, in the name of who scheduled it', async () => {
    const world = await newWorld(env.DB, 'schedule')
    const id = await post(world)

    const asked = await world.agent.publish({ id, version: 1, publishAt: LATER })
    const scheduled = await world.agent.publish({
      id,
      version: 1,
      publishAt: LATER,
      acknowledgeWarnings: [TITLE_ACK],
    })

    expect(asked.outcome).toBe('needs_acknowledgement')
    expect([scheduled.outcome, scheduled.entry?.status, scheduled.entry?.version]).toEqual([
      'scheduled',
      'scheduled',
      2,
    ])
    expect(await run(world)).toEqual({ published: 0, cancelled: 0 })
    expect(await publicationsOf(world.db, id)).toEqual([])

    world.time.set(LATER)
    expect(await run(world)).toEqual({ published: 1, cancelled: 0 })
    expect((await entryColumns(world.db, id))?.status).toBe('published')
    const [publication] = await publicationsOf(world.db, id)
    expect([
      publication?.actor_user_id,
      publication?.actor_token_id,
      publication?.acknowledged,
    ]).toEqual([world.tenant.userId, world.tenant.tokenId, JSON.stringify([TITLE_ACK])])
    expect(await run(world)).toEqual({ published: 0, cancelled: 0 })
  })

  it('takes an entry that changed after it was scheduled back to a draft at the time', async () => {
    const world = await newWorld(env.DB, 'schedule-changed')
    const id = await post(world)
    await world.agent.publish({
      id,
      version: 1,
      publishAt: LATER,
      acknowledgeWarnings: [TITLE_ACK],
    })
    await world.agent.updateDraft({
      id,
      version: 2,
      markdown: `${blogFrontmatter({ title: JSON.stringify(TITLE) })}\nChanged.\n`,
    })

    world.time.set(LATER)

    expect(await run(world)).toEqual({ published: 0, cancelled: 1 })
    expect((await entryColumns(world.db, id))?.status).toBe('draft')
    expect(await publicationsOf(world.db, id)).toEqual([])
  })

  it('is cancelled by unpublish, which leaves a draft', async () => {
    const world = await newWorld(env.DB, 'schedule-cancel')
    const id = await post(world)
    await world.agent.publish({
      id,
      version: 1,
      publishAt: LATER,
      acknowledgeWarnings: [TITLE_ACK],
    })

    const cancelled = await world.agent.unpublish({ id })
    world.time.set(LATER)

    expect([cancelled.outcome, cancelled.entry?.status]).toEqual(['unpublished', 'draft'])
    expect(await run(world)).toEqual({ published: 0, cancelled: 0 })
    expect(await publicationsOf(world.db, id)).toEqual([])
  })

  it('is refused with a group, and for an entry that is published', async () => {
    const world = await newWorld(env.DB, 'schedule-refused')
    const id = await post(world)

    await expect(
      world.agent.publish({ id, version: 1, publishAt: LATER, group: [{ id, version: 1 }] }),
    ).rejects.toThrow('A group cannot be scheduled')
    await world.agent.publish({ id, version: 1, acknowledgeWarnings: [TITLE_ACK] })
    await expect(
      world.agent.publish({ id, version: 2, publishAt: LATER, acknowledgeWarnings: [TITLE_ACK] }),
    ).rejects.toThrow('The entry is published')
  })
})
