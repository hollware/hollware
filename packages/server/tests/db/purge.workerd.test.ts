import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { purgeEntry } from '../../src/db/purge.ts'
import { warmUpComark } from '../ops/support.ts'
import { createPost, newWorld, publishPost } from '../ops/world.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const NOW = '2026-10-20T10:00:00.000Z'

const TABLES = [
  'revisions',
  'publications',
  'redirects',
  'outbox',
  'reviews',
  'schedules',
  'unpublishes',
  'entry_embeddings',
]

describe('the purge of an entry', () => {
  it('deletes an entry of the trash with all it left, records who did, and touches no other', async () => {
    const world = await newWorld(env.DB, 'purge')
    const site = world.tenant.key
    const post = await createPost(world, { slug: 'to-purge', group: 'purge' })
    await createPost(world, { slug: 'purgar', locale: 'es', group: 'purge' })
    const kept = await createPost(world, { slug: 'kept-post', group: 'kept' })
    const live = await publishPost(world, post)
    const moved = await world.agent.moveEntry({
      id: post.id,
      version: live.version,
      slug: 'gone-post',
    })
    await world.agent.unpublish({ id: post.id })
    const draft = await world.agent.getEntry({
      collection: 'blog',
      locale: 'en',
      slug: 'gone-post',
    })
    const asked = await world.agent.requestReview({
      id: post.id,
      version: draft.entry?.version ?? 0,
    })
    await world.agent.commentReview({ id: asked.review?.id ?? '', body: 'A comment to purge.' })
    const now = await world.agent.getEntry({ collection: 'blog', locale: 'en', slug: 'gone-post' })
    await world.agent.deleteEntry({ id: post.id, version: now.entry?.version ?? 0 })
    const head = draft.entry?.revision ?? ''
    const event = await env.DB.prepare(
      'SELECT id FROM outbox WHERE site_id = ?1 AND entry_id = ?2 LIMIT 1',
    )
      .bind(site, post.id)
      .first<string>('id')
    const user = world.tenant.userId
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO deliveries (id, site_id, event_id, subscriber, attempts, delivered_at, last_error, created_at, updated_at) VALUES ('dlv_purge', ?1, ?2, 'webhook:site', 1, NULL, 'down', ?3, ?3)",
      ).bind(site, event, NOW),
      env.DB.prepare(
        "INSERT INTO entry_embeddings (id, site_id, entry_id, revision_id, model, chunker_version, pieces, related, created_at, updated_at) VALUES ('emb_purge', ?1, ?2, ?3, 'm', '1', 1, '[]', ?4, ?4)",
      ).bind(site, post.id, head, NOW),
      env.DB.prepare(
        "INSERT INTO schedules (id, site_id, entry_id, scheduled_at, version, acknowledged, actor_kind, actor_user_id, actor_token_id, actor_meta, created_at, updated_at) VALUES ('sch_purge', ?1, ?2, ?3, 1, '[]', 'user', ?4, NULL, NULL, ?3, ?3)",
      ).bind(site, post.id, NOW, user),
      env.DB.prepare(
        "INSERT INTO unpublishes (id, site_id, entry_id, unpublish_at, actor_kind, actor_user_id, actor_token_id, actor_meta, created_at, updated_at) VALUES ('unp_purge', ?1, ?2, ?3, 'user', ?4, NULL, NULL, ?3, ?3)",
      ).bind(site, post.id, NOW, user),
    ])
    const count = async (table: string, entry: string) =>
      (
        await env.DB.prepare(
          `SELECT count(*) AS n FROM ${table} WHERE site_id = ?1 AND entry_id = ?2`,
        )
          .bind(site, entry)
          .first<{ n: number }>()
      )?.n
    const before = await Promise.all(TABLES.map((table) => count(table, post.id)))
    const revisionIds = (
      await env.DB.prepare('SELECT id FROM revisions WHERE site_id = ?1 AND entry_id = ?2')
        .bind(site, post.id)
        .all<{ id: string }>()
    ).results.map((row) => row.id)

    const outcome = await purgeEntry(env.DB, {
      site,
      entryId: post.id,
      purgedBy: world.tenant.userId,
      now: NOW,
    })
    const again = await purgeEntry(env.DB, {
      site,
      entryId: post.id,
      purgedBy: world.tenant.userId,
      now: NOW,
    })
    const live2 = await purgeEntry(env.DB, {
      site,
      entryId: kept.id,
      purgedBy: world.tenant.userId,
      now: NOW,
    })

    expect(moved.outcome).toBe('moved')
    expect(asked.outcome).toBe('pending_review')
    expect(before).toEqual([1, 2, 1, 5, 1, 1, 1, 1])
    expect([outcome, again, live2]).toEqual(['purged', 'not_found', 'not_in_trash'])
    expect(await Promise.all(TABLES.map((table) => count(table, post.id)))).toEqual(
      TABLES.map(() => 0),
    )
    expect(
      await env.DB.prepare(
        `SELECT (SELECT count(*) FROM entries WHERE id = ?1) AS entries,
                (SELECT count(*) FROM revision_tags WHERE revision_id IN (SELECT value FROM json_each(?2))) AS tags,
                (SELECT count(*) FROM review_comments WHERE site_id = ?3 AND body = 'A comment to purge.') AS comments,
                (SELECT count(*) FROM deliveries WHERE id = 'dlv_purge') AS deliveries,
                (SELECT purged_by FROM entry_purges WHERE site_id = ?3 AND entry_id = ?1) AS purgedBy`,
      )
        .bind(post.id, JSON.stringify(revisionIds), site)
        .first(),
    ).toEqual({ entries: 0, tags: 0, comments: 0, deliveries: 0, purgedBy: world.tenant.userId })
    expect(await count('revisions', kept.id)).toBe(1)
    await expect(
      env.DB.prepare('DELETE FROM revisions WHERE site_id = ?1 AND entry_id = ?2')
        .bind(site, kept.id)
        .run(),
    ).rejects.toThrow('append-only: a revision is never deleted')
  })
})
