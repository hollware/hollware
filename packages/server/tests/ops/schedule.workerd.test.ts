import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { handlers } from '../../src/ops/index.ts'
import { runDueSchedules, runDueUnpublishes } from '../../src/schedule/run.ts'
import { scopesNow } from '../../src/schedule/standing.ts'
import { createAuditLog, type AuditActor } from '../../src/audit/log.ts'
import { agent as agentFor, blogFrontmatter, warmUpComark } from './support.ts'
import { createPost, entryColumns, newWorld, publicationsOf, type World } from './world.ts'

// Fails when: a publish with publishAt stops scheduling the entry (status scheduled at the next
// version, no publication yet) after the same checks as a publish; the cron run (src/schedule/
// run.ts) publishes before the time, stops publishing at the time in the name of who scheduled it
// and with the warnings acknowledged then, or keeps a schedule whose entry changed since (the entry
// must go back to a draft), or publishes for an OAuth client as anything but that client;
// unpublish stops cancelling a schedule; or publishAt is taken with a
// group, or for an entry that is published; or the cron publishes for a token since revoked, a
// person no longer a member or whose role no longer publishes, or an OAuth client whose grant is
// gone (T-108: src/schedule/standing.ts); or schedule_unpublish stops taking a published entry off
// the site at its time (and only a published one), or cancelling, or unpublishing now for a time
// that passed, or the cron unpublishes for someone who may no longer publish.

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

function run(world: World, audited = false) {
  return runDueSchedules({
    site: world.tenant.site,
    store: world.store,
    handlers,
    clock: world.time.clock,
    log: () => {},
    scopesOf: (actor) =>
      scopesNow({ db: env.DB, kv: env.OAUTH_KV }, actor, world.tenant.key, world.time.clock.now()),
    ...(audited
      ? {
          audit: (actor: AuditActor, requestId: string) =>
            createAuditLog({
              db: env.DB,
              actor,
              requestId,
              address: null,
              master: undefined,
              now: () => world.time.clock.now(),
              log: () => {},
            }),
        }
      : {}),
  })
}

const CLIENT = 'https://claude.ai/oauth/mcp-client.json'

/** A grant of the OAuth client for the tenant's site, as the OAuth library keeps it in KV. */
async function grant(world: World, id: string) {
  await env.OAUTH_KV.put(
    `grant:${world.tenant.userId}:${id}`,
    JSON.stringify({
      id,
      clientId: CLIENT,
      userId: world.tenant.userId,
      scope: ['content:read', 'content:write', 'content:publish'],
      metadata: { site: world.tenant.key },
    }),
  )
}

/**
 * The seeded token writes only; the cron reads it again at the time, so a token that
 * schedules a publication must hold content:publish in the database too.
 */
async function mayPublish(world: World) {
  await env.DB.prepare('UPDATE tokens SET scopes = ?1 WHERE id = ?2')
    .bind(
      JSON.stringify(['content:read', 'content:write', 'content:publish']),
      world.tenant.tokenId,
    )
    .run()
}

/** The entry scheduled by the tenant's token, for LATER, with the warning acknowledged. */
async function scheduled(world: World) {
  await mayPublish(world)
  const id = await post(world)
  await world.agent.publish({ id, version: 1, publishAt: LATER, acknowledgeWarnings: [TITLE_ACK] })
  return id
}

describe('publishAt', () => {
  it('publishes at the time in the name of the OAuth client that scheduled it', async () => {
    const world = await newWorld(env.DB, 'schedule-oauth')
    const id = await post(world)
    await grant(world, 'grant-1')
    const client = agentFor(
      world.context({
        principal: {
          kind: 'oauth',
          userId: world.tenant.userId,
          clientId: CLIENT,
          site: world.tenant.key,
          scopes: ['content:read', 'content:write', 'content:publish'],
        },
      }),
    )
    await client.publish({ id, version: 1, publishAt: LATER, acknowledgeWarnings: [TITLE_ACK] })

    world.time.set(LATER)
    expect(await run(world)).toEqual({ published: 1, cancelled: 0 })
    const [publication] = await publicationsOf(world.db, id)
    expect([publication?.actor_kind, publication?.actor_token_id]).toEqual(['oauth_client', null])
    expect(JSON.parse(publication?.actor_meta ?? '')).toEqual({
      oauthClient: 'https://claude.ai/oauth/mcp-client.json',
    })
  })

  it('schedules the entry, and the cron run publishes it at the time, in the name of who scheduled it', async () => {
    const world = await newWorld(env.DB, 'schedule')
    await mayPublish(world)
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

  it('writes a line of the activity log for what it publishes, as the deployment for who scheduled it', async () => {
    const world = await newWorld(env.DB, 'schedule-audit')
    await mayPublish(world)
    const id = await post(world)
    await world.agent.publish({
      id,
      version: 1,
      publishAt: LATER,
      acknowledgeWarnings: [TITLE_ACK],
    })

    world.time.set(LATER)
    await run(world, true)

    const { results } = await env.DB.prepare(
      'SELECT action, outcome, actor_kind, actor_user_id, actor_token_id, target_type, target_id, detail FROM audit_log WHERE site_id = ?1',
    )
      .bind(world.tenant.key)
      .all()
    expect(results).toEqual([
      {
        action: 'schedule.publish',
        outcome: 'ok',
        actor_kind: 'system',
        actor_user_id: world.tenant.userId,
        actor_token_id: null,
        target_type: 'entry',
        target_id: id,
        detail: JSON.stringify({
          scheduledAt: LATER,
          scheduledBy: { kind: 'token', tokenId: world.tenant.tokenId },
        }),
      },
    ])
  })

  it('cancels what a token since revoked scheduled, and logs it as denied', async () => {
    const world = await newWorld(env.DB, 'schedule-revoked')
    const id = await scheduled(world)
    await env.DB.prepare('UPDATE tokens SET revoked_at = ?1 WHERE id = ?2')
      .bind(LATER, world.tenant.tokenId)
      .run()

    world.time.set(LATER)

    expect(await run(world, true)).toEqual({ published: 0, cancelled: 1 })
    expect((await entryColumns(world.db, id))?.status).toBe('draft')
    expect(await publicationsOf(world.db, id)).toEqual([])
    const { results } = await env.DB.prepare(
      'SELECT outcome, error_code FROM audit_log WHERE site_id = ?1',
    )
      .bind(world.tenant.key)
      .all()
    expect(results).toEqual([{ outcome: 'denied', error_code: 'insufficient_scope' }])
  })

  it('cancels it when the token expired, the person left, or the role no longer publishes', async () => {
    const expired = await newWorld(env.DB, 'schedule-expired')
    const left = await newWorld(env.DB, 'schedule-left')
    const demoted = await newWorld(env.DB, 'schedule-demoted')
    const ids = [await scheduled(expired), await scheduled(left), await scheduled(demoted)]
    await env.DB.prepare('UPDATE tokens SET expires_at = ?1 WHERE id = ?2')
      .bind(LATER, expired.tenant.tokenId)
      .run()
    await env.DB.prepare('DELETE FROM members WHERE user_id = ?1 AND site_id = ?2')
      .bind(left.tenant.userId, left.tenant.key)
      .run()
    await env.DB.prepare("UPDATE members SET role = 'author' WHERE user_id = ?1 AND site_id = ?2")
      .bind(demoted.tenant.userId, demoted.tenant.key)
      .run()

    const runs = []
    for (const world of [expired, left, demoted]) {
      world.time.set(LATER)
      runs.push(await run(world))
    }

    expect(runs).toEqual([
      { published: 0, cancelled: 1 },
      { published: 0, cancelled: 1 },
      { published: 0, cancelled: 1 },
    ])
    for (const [index, world] of [expired, left, demoted].entries()) {
      expect(await publicationsOf(world.db, ids[index] ?? '')).toEqual([])
    }
  })

  it('cancels what an OAuth client scheduled once its grant of the site is revoked', async () => {
    const world = await newWorld(env.DB, 'schedule-oauth-revoked')
    const id = await post(world)
    const client = agentFor(
      world.context({
        principal: {
          kind: 'oauth',
          userId: world.tenant.userId,
          clientId: CLIENT,
          site: world.tenant.key,
          scopes: ['content:read', 'content:write', 'content:publish'],
        },
      }),
    )
    await client.publish({ id, version: 1, publishAt: LATER, acknowledgeWarnings: [TITLE_ACK] })

    world.time.set(LATER)

    // The person revoked its grant for this site in the admin; one for another site stays.
    await env.OAUTH_KV.put(
      `grant:${world.tenant.userId}:grant-elsewhere`,
      JSON.stringify({
        id: 'grant-elsewhere',
        clientId: CLIENT,
        userId: world.tenant.userId,
        scope: ['content:read', 'content:write', 'content:publish'],
        metadata: { site: 'another-site' },
      }),
    )
    expect(await run(world)).toEqual({ published: 0, cancelled: 1 })
    expect(await publicationsOf(world.db, id)).toEqual([])
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

describe('schedule_unpublish', () => {
  async function published(label: string) {
    const world = await newWorld(env.DB, label)
    await mayPublish(world)
    const id = await post(world)
    await world.agent.publish({ id, version: 1, acknowledgeWarnings: [TITLE_ACK] })
    return { world, id }
  }

  function unpublishRun(world: World, audited = false) {
    return runDueUnpublishes({
      site: world.tenant.site,
      store: world.store,
      handlers,
      clock: world.time.clock,
      log: () => {},
      scopesOf: (actor) =>
        scopesNow(
          { db: env.DB, kv: env.OAUTH_KV },
          actor,
          world.tenant.key,
          world.time.clock.now(),
        ),
      ...(audited
        ? {
            audit: (actor: AuditActor, requestId: string) =>
              createAuditLog({
                db: env.DB,
                actor,
                requestId,
                address: null,
                master: undefined,
                now: () => world.time.clock.now(),
                log: () => {},
              }),
          }
        : {}),
    })
  }

  it('keeps a published entry live until its time, then takes it off the site', async () => {
    const { world, id } = await published('unpublish-at')

    const scheduled = await world.agent.scheduleUnpublish({ id, unpublishAt: LATER })
    const read = await world.agent.getEntry({
      collection: 'blog',
      locale: 'en',
      slug: 'scheduled-post',
    })

    expect([scheduled.outcome, scheduled.unpublishAt, read.entry?.unpublishAt]).toEqual([
      'scheduled',
      LATER,
      LATER,
    ])
    expect(await unpublishRun(world)).toEqual({ published: 0, cancelled: 0 })
    expect((await entryColumns(world.db, id))?.status).toBe('published')

    world.time.set(LATER)
    expect(await unpublishRun(world, true)).toEqual({ published: 1, cancelled: 0 })
    expect((await entryColumns(world.db, id))?.status).toBe('draft')
    expect(await unpublishRun(world)).toEqual({ published: 0, cancelled: 0 })
    const { results } = await env.DB.prepare(
      "SELECT outcome FROM audit_log WHERE site_id = ?1 AND action = 'schedule.unpublish'",
    )
      .bind(world.tenant.key)
      .all()
    expect(results).toEqual([{ outcome: 'ok' }])
  })

  it('takes only a published entry, cancels with null, and unpublishes now for a time gone by', async () => {
    const { world, id } = await published('unpublish-cases')
    const draft = (await createPost(world, { slug: 'still-a-draft', group: 'still-a-draft' })).id

    const notLive = await world.agent.scheduleUnpublish({ id: draft, unpublishAt: LATER })
    await world.agent.scheduleUnpublish({ id, unpublishAt: LATER })
    const cancelled = await world.agent.scheduleUnpublish({ id, unpublishAt: null })
    world.time.set(LATER)
    const none = await unpublishRun(world)
    const now = await world.agent.scheduleUnpublish({ id, unpublishAt: '2026-10-13T11:00:00.000Z' })

    expect([notLive.outcome, cancelled.outcome, none, now.outcome]).toEqual([
      'not_published',
      'cancelled',
      { published: 0, cancelled: 0 },
      'unpublished',
    ])
    expect((await entryColumns(world.db, id))?.status).toBe('draft')
  })

  it('is dropped by an unpublish before its time, so a new publication stays live', async () => {
    const { world, id } = await published('unpublish-dropped')
    await world.agent.scheduleUnpublish({ id, unpublishAt: LATER })

    const off = await world.agent.unpublish({ id })
    await world.agent.publish({
      id,
      version: off.entry?.version ?? 0,
      acknowledgeWarnings: [TITLE_ACK],
    })
    world.time.set(LATER)

    expect(await unpublishRun(world)).toEqual({ published: 0, cancelled: 0 })
    expect((await entryColumns(world.db, id))?.status).toBe('published')
  })

  it('does not unpublish for a token since revoked, and drops the schedule', async () => {
    const { world, id } = await published('unpublish-revoked')
    await world.agent.scheduleUnpublish({ id, unpublishAt: LATER })
    await env.DB.prepare('UPDATE tokens SET revoked_at = ?1 WHERE id = ?2')
      .bind(LATER, world.tenant.tokenId)
      .run()

    world.time.set(LATER)

    expect(await unpublishRun(world)).toEqual({ published: 0, cancelled: 1 })
    expect((await entryColumns(world.db, id))?.status).toBe('published')
    expect(await unpublishRun(world)).toEqual({ published: 0, cancelled: 0 })
  })
})
