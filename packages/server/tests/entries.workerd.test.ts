import { newId } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

// Fails when: a CHECK of the `entries` table in src/db/schema.ts (and so migrations/0001_core.sql)
// stops refusing an incoherent row: a draft with a published revision, a sort key or a
// schedule; a published entry without its revision, its first publication time or its sort key;
// a scheduled entry without its time; an unknown status; a version under 1.

const NOW = '2026-10-13T00:00:00.000Z'

interface Row {
  status: string
  version: number
  published_rev: string | null
  published_at: string | null
  published_sort_key: string | null
  scheduled_at: string | null
}

const DRAFT: Row = {
  status: 'draft',
  version: 1,
  published_rev: null,
  published_at: null,
  published_sort_key: null,
  scheduled_at: null,
}

/** Inserts one entry with the given columns into a site of its own: `ok` or the constraint that stopped it. */
async function insert(row: Row): Promise<string> {
  const site = `site-${crypto.randomUUID()}`
  const revision = newId('rev')
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(
        site,
        NOW,
      ),
      env.DB.prepare(
        `INSERT INTO entries (id, site_id, collection, locale, slug, status, version, head_rev,
          published_rev, published_at, published_sort_key, scheduled_at, created_at, updated_at)
          VALUES (?1, ?2, 'posts', 'en', 'hello', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
      ).bind(
        newId('ent'),
        site,
        row.status,
        row.version,
        revision,
        row.published_rev === null ? null : revision,
        row.published_at,
        row.published_sort_key,
        row.scheduled_at,
        NOW,
      ),
    ])
    return 'ok'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return /CHECK constraint failed: (\w+)/.exec(message)?.[1] ?? message
  }
}

describe('the coherence checks of entries', () => {
  it('accept a draft, a published entry and a scheduled one that are whole', async () => {
    const published = { published_rev: 'set', published_at: NOW, published_sort_key: NOW }
    expect(await insert(DRAFT)).toBe('ok')
    expect(await insert({ ...DRAFT, status: 'published', ...published })).toBe('ok')
    expect(await insert({ ...DRAFT, status: 'scheduled', scheduled_at: NOW })).toBe('ok')
  })

  it('refuse each incoherent row with the check that names it', async () => {
    const outcomes = {
      'a draft with a published revision': await insert({ ...DRAFT, published_rev: 'set' }),
      'a draft with a sort key': await insert({ ...DRAFT, published_sort_key: NOW }),
      'a draft with a schedule': await insert({ ...DRAFT, scheduled_at: NOW }),
      'a published entry without its revision': await insert({
        ...DRAFT,
        status: 'published',
        published_at: NOW,
        published_sort_key: NOW,
      }),
      'a published entry without its first publication': await insert({
        ...DRAFT,
        status: 'published',
        published_rev: 'set',
        published_sort_key: NOW,
      }),
      'a published entry without its sort key': await insert({
        ...DRAFT,
        status: 'published',
        published_rev: 'set',
        published_at: NOW,
      }),
      'a scheduled entry without its time': await insert({ ...DRAFT, status: 'scheduled' }),
      'an unknown status': await insert({ ...DRAFT, status: 'archived' }),
      'a version under 1': await insert({ ...DRAFT, version: 0 }),
    }
    expect(outcomes).toEqual({
      'a draft with a published revision': 'entries_draft',
      'a draft with a sort key': 'entries_draft',
      'a draft with a schedule': 'entries_draft',
      'a published entry without its revision': 'entries_published',
      'a published entry without its first publication': 'entries_published',
      'a published entry without its sort key': 'entries_published',
      'a scheduled entry without its time': 'entries_scheduled',
      'an unknown status': 'entries_status',
      'a version under 1': 'entries_version',
    })
  })
})
