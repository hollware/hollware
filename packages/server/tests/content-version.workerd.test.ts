import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { seedSite } from './support/sites.ts'

const WATCHED = ['assets', 'entries', 'entry_embeddings', 'redirects']

async function contentVersion(site: string): Promise<number | null> {
  return env.DB.prepare('SELECT content_version AS v FROM sites WHERE id = ?').bind(site).first('v')
}

function key(name: string): string {
  return `${name}-${crypto.randomUUID().slice(0, 8)}`
}

describe('the content version of a site', () => {
  it('has a trigger for each write that a table its published reads answer from allows', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%content_version%' ORDER BY name",
    ).all()

    expect(results).toEqual(
      WATCHED.flatMap((table) =>
        (table === 'assets' ? ['insert', 'update'] : ['delete', 'insert', 'update']).map(
          (event) => ({ name: `${table}_content_version_${event}`, tbl_name: table }),
        ),
      ),
    )
  })

  it('grows by one on each write to a watched table that the table allows', async () => {
    const site = key('every')
    const { userId, entries } = await seedSite(env.DB, site)
    const entry = key('ent')
    const now = '2026-11-07T00:00:00.000Z'
    const writes: Record<string, readonly D1PreparedStatement[]> = {
      entries: [
        env.DB.prepare(
          "INSERT INTO entries (id, site_id, collection, locale, slug, status, version, head_rev, created_at, updated_at) VALUES (?1, ?2, 'blog', 'en', ?1, 'draft', 1, 'rev', ?3, ?3)",
        ).bind(entry, site, now),
        env.DB.prepare("UPDATE entries SET updated_at = 'later' WHERE id = ?1").bind(entry),
      ],
      redirects: [
        env.DB.prepare(
          "INSERT INTO redirects (id, site_id, collection, locale, from_slug, entry_id, created_at, updated_at) VALUES ('red', ?1, 'blog', 'en', 'old', ?2, ?3, ?3)",
        ).bind(site, entry, now),
        env.DB.prepare("UPDATE redirects SET updated_at = 'later' WHERE site_id = ?1").bind(site),
        env.DB.prepare('DELETE FROM redirects WHERE site_id = ?1').bind(site),
      ],
      entry_embeddings: [
        env.DB.prepare(
          "INSERT INTO entry_embeddings (id, site_id, entry_id, revision_id, model, chunker_version, pieces, created_at, updated_at) VALUES ('emb', ?1, ?2, ?3, 'm', '1', 1, ?4, ?4)",
        ).bind(site, entries[0]?.id, entries[0]?.revisionId, now),
        env.DB.prepare("UPDATE entry_embeddings SET updated_at = 'later' WHERE site_id = ?1").bind(
          site,
        ),
        env.DB.prepare('DELETE FROM entry_embeddings WHERE site_id = ?1').bind(site),
      ],
      assets: [
        env.DB.prepare(
          "INSERT INTO assets (id, site_id, sha256, format, bytes, original_format, original_bytes, alt, filename, created_by, created_at, updated_at) VALUES ('ast', ?1, ?4, 'image/webp', 1, 'image/png', 1, 'alt', 'a.png', ?2, ?3, ?3)",
        ).bind(site, userId, now, 'a'.repeat(64)),
        env.DB.prepare("UPDATE assets SET updated_at = 'later' WHERE site_id = ?1").bind(site),
      ],
      'entries ': [env.DB.prepare('DELETE FROM entries WHERE id = ?1').bind(entry)],
    }
    const steps: string[] = []

    for (const [table, statements] of Object.entries(writes)) {
      for (const statement of statements) {
        const before = (await contentVersion(site)) ?? 0
        await statement.run()
        steps.push(`${table.trim()} +${((await contentVersion(site)) ?? 0) - before}`)
      }
    }

    expect(steps).toEqual([
      'entries +1',
      'entries +1',
      'redirects +1',
      'redirects +1',
      'redirects +1',
      'entry_embeddings +1',
      'entry_embeddings +1',
      'entry_embeddings +1',
      'assets +1',
      'assets +1',
      'entries +1',
    ])
  })

  it('grows when an entry of the site is written, and stays when another site is', async () => {
    const [mine, theirs] = [key('mine'), key('theirs')]
    const { entries } = await seedSite(env.DB, mine)
    await seedSite(env.DB, theirs)
    const before = { mine: await contentVersion(mine), theirs: await contentVersion(theirs) }

    await env.DB.prepare("UPDATE entries SET updated_at = 'later' WHERE id = ?1 AND site_id = ?2")
      .bind(entries[0]?.id, mine)
      .run()

    expect(before.mine).toBeGreaterThan(0)
    expect(await contentVersion(mine)).toBe((before.mine ?? 0) + 1)
    expect(await contentVersion(theirs)).toBe(before.theirs)
  })
})
