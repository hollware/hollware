import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import type { PublishWrite } from '../../src/ports.ts'
import { seedSite, type SeededEntry, type SeededSite } from '../support/sites.ts'
import { fixedClock, VERDICT } from './support.ts'

// Fails when: src/db/writes.ts publishGroup stops publishing every entry of a group in one batch,
// all or none (ADR-024): a member that moved past its version, or that does not exist, must leave
// every other member as it was, with no publication appended, and the refusal must name that
// member; or a group that is in order stops ending with each entry published at the next version.

const NOW = '2026-10-14T10:00:00.000Z'

async function seeded() {
  const site = await seedSite(env.DB, `group-${crypto.randomUUID()}`)
  const [english, , draft] = site.entries
  if (english === undefined || draft === undefined) throw new Error('seedSite changed')
  return { site, english, draft, store: createD1Store(env.DB, { clock: fixedClock(NOW).clock }) }
}

function write(site: SeededSite, entry: SeededEntry, expectedVersion = 1): PublishWrite {
  return {
    entryId: entry.id,
    expectedVersion,
    verdict: { ...VERDICT, phase: 'publish' },
    acknowledged: [],
    actor: { kind: 'token', userId: site.userId, tokenId: site.tokenId, meta: null },
    sortKey: NOW,
  }
}

async function state(site: string) {
  const entries = await env.DB.prepare(
    'SELECT slug, status, version FROM entries WHERE site_id = ?1 ORDER BY slug',
  )
    .bind(site)
    .all()
  const publications = await env.DB.prepare(
    'SELECT count(*) AS n FROM publications WHERE site_id = ?1',
  )
    .bind(site)
    .first<{ n: number }>()
  return { entries: entries.results, publications: publications?.n }
}

const BEFORE = [
  { slug: 'cache-en-el-borde', status: 'published', version: 1 },
  { slug: 'edge-caching-basics', status: 'published', version: 1 },
  { slug: 'from-draft-to-published', status: 'draft', version: 1 },
]

describe('publishGroup', () => {
  it('publishes every entry of the group at its next version, in one step', async () => {
    const { site, english, draft, store } = await seeded()

    const answer = await store.publishGroup(site.site, [write(site, draft), write(site, english)])

    expect(answer.outcome).toBe('published')
    expect(
      answer.outcome === 'published'
        ? answer.views.map(({ entry }) => [entry.slug, entry.status, entry.version])
        : [],
    ).toEqual([
      ['from-draft-to-published', 'published', 2],
      ['edge-caching-basics', 'published', 2],
    ])
    expect(await state(site.site)).toEqual({
      entries: [
        { slug: 'cache-en-el-borde', status: 'published', version: 1 },
        { slug: 'edge-caching-basics', status: 'published', version: 2 },
        { slug: 'from-draft-to-published', status: 'published', version: 2 },
      ],
      publications: 4,
    })
  })

  it('publishes none when one member moved past its version, and names it', async () => {
    const { site, english, draft, store } = await seeded()

    const answer = await store.publishGroup(site.site, [
      write(site, draft),
      write(site, english, 0),
    ])

    expect(answer).toMatchObject({ outcome: 'conflict', entryId: english.id, currentVersion: 1 })
    expect(await state(site.site)).toEqual({ entries: BEFORE, publications: 2 })
  })

  it('publishes none when one member does not exist, and names it', async () => {
    const { site, draft, store } = await seeded()
    const missing = { ...draft, id: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW' }

    const answer = await store.publishGroup(site.site, [write(site, draft), write(site, missing)])

    expect(answer).toEqual({ outcome: 'not_found', entryId: missing.id })
    expect(await state(site.site)).toEqual({ entries: BEFORE, publications: 2 })
  })
})
