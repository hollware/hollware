import { newId } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

// Fails when: migrations/0002_append_only.sql loses a trigger, or a later migration rebuilds
// revisions, revision_tags or publications without creating their triggers again; a `_immutable`
// trigger stops covering a column, or covers a derived one; a `_no_replace` trigger stops
// matching an id (or, for tags, a revision and tag) that is taken; or one of these tables gains a
// column that is neither in its `_immutable` trigger nor listed as derived below, or a unique key
// that its `_no_replace` trigger does not check.

const TABLES = [
  {
    table: 'revisions',
    // Rebuilt by `hollware reparse`, with `updated_at`. Everything else is the revision itself.
    derived: [
      'frontmatter',
      'document',
      'comark_version',
      'pipeline_version',
      'word_count',
      'updated_at',
    ],
    immutable: [
      'id',
      'site_id',
      'entry_id',
      'markdown',
      'verdict',
      'actor_kind',
      'actor_user_id',
      'actor_token_id',
      'actor_meta',
      'created_at',
    ],
    // Every unique key. `_no_replace` checks `id` (which covers `id, site_id`).
    uniqueKeys: ['id', 'id, site_id'],
    deleted: 'append-only: a revision is never deleted',
    changed: 'append-only: only the derived columns of a revision change',
    replaced: 'append-only: a revision with this id already exists',
  },
  {
    table: 'revision_tags',
    derived: ['updated_at'],
    immutable: ['id', 'site_id', 'revision_id', 'tag', 'created_at'],
    // `_no_replace` checks `id` and `revision_id, tag`.
    uniqueKeys: ['id', 'id, site_id', 'revision_id, tag'],
    deleted: 'append-only: a revision tag is never deleted',
    changed: 'append-only: a revision tag never changes',
    replaced: 'append-only: this revision already has this tag',
  },
  {
    table: 'publications',
    derived: ['updated_at'],
    immutable: [
      'id',
      'site_id',
      'entry_id',
      'action',
      'revision_id',
      'verdict',
      'acknowledged',
      'actor_kind',
      'actor_user_id',
      'actor_token_id',
      'actor_meta',
      'created_at',
    ],
    uniqueKeys: ['id', 'id, site_id'],
    deleted: 'append-only: a publication is never deleted',
    changed: 'append-only: a publication never changes',
    replaced: 'append-only: a publication with this id already exists',
  },
] as const

const INSERT_REVISION = `INSERT INTO revisions (id, site_id, entry_id, markdown, frontmatter, document,
  comark_version, pipeline_version, word_count, verdict, actor_kind, actor_user_id, created_at,
  updated_at) VALUES (?1, ?2, ?3, '# Hello', '{}', '{}', '0.7.0', '1', 1, '{}', 'user', ?4, ?5, ?5)`

/** A published entry with one revision, one tag and one publication, under a site of its own. */
async function seed() {
  const site = `site-${crypto.randomUUID()}`
  const user = newId('usr')
  const entry = newId('ent')
  const ids = {
    revisions: newId('rev'),
    revision_tags: newId('tag'),
    publications: newId('pub'),
  }
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(
      site,
      now,
    ),
    env.DB.prepare(
      "INSERT INTO users (id, role, created_at, updated_at) VALUES (?1, 'owner', ?2, ?2)",
    ).bind(user, now),
    env.DB.prepare(
      `INSERT INTO entries (id, site_id, collection, locale, slug, status, version, head_rev,
        published_rev, published_at, created_at, updated_at)
        VALUES (?1, ?2, 'posts', 'en', 'hello', 'published', 1, ?3, ?3, ?4, ?4, ?4)`,
    ).bind(entry, site, ids.revisions, now),
    env.DB.prepare(INSERT_REVISION).bind(ids.revisions, site, entry, user, now),
    env.DB.prepare(
      `INSERT INTO revision_tags (id, site_id, revision_id, tag, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'news', ?4, ?4)`,
    ).bind(ids.revision_tags, site, ids.revisions, now),
    env.DB.prepare(
      `INSERT INTO publications (id, site_id, entry_id, action, revision_id, verdict, acknowledged,
        actor_kind, actor_user_id, created_at, updated_at)
        VALUES (?1, ?2, ?3, 'publish', ?4, '{}', '[]', 'user', ?5, ?6, ?6)`,
    ).bind(ids.publications, site, entry, ids.revisions, user, now),
  ])
  return { site, user, entry, ids, now }
}

/** Runs one statement: `ok`, or the message of the trigger (or constraint) that stopped it. */
async function attempt(statement: D1PreparedStatement): Promise<string> {
  try {
    await statement.run()
    return 'ok'
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return /append-only: [^:]+/.exec(message)?.[0] ?? message
  }
}

async function rowCount(table: string, id: string): Promise<number | null> {
  return env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE id = ?`).bind(id).first('n')
}

describe('append-only tables', () => {
  it('have the nine triggers of migrations/0002_append_only.sql, after every migration', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    ).all()
    expect(results).toEqual([
      { name: 'publications_immutable', tbl_name: 'publications' },
      { name: 'publications_no_delete', tbl_name: 'publications' },
      { name: 'publications_no_replace', tbl_name: 'publications' },
      { name: 'revision_tags_immutable', tbl_name: 'revision_tags' },
      { name: 'revision_tags_no_delete', tbl_name: 'revision_tags' },
      { name: 'revision_tags_no_replace', tbl_name: 'revision_tags' },
      { name: 'revisions_immutable', tbl_name: 'revisions' },
      { name: 'revisions_no_delete', tbl_name: 'revisions' },
      { name: 'revisions_no_replace', tbl_name: 'revisions' },
    ])
  })

  describe.each(TABLES)('$table', (spec) => {
    const { table, derived, immutable, uniqueKeys, deleted, changed, replaced } = spec
    it('has exactly the columns this test sorts into immutable and derived', async () => {
      const { results } = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{
        name: string
      }>()
      expect(results.map((column) => column.name).sort()).toEqual([...immutable, ...derived].sort())
    })

    it('has only the unique keys that its _no_replace trigger checks', async () => {
      const { results: indexes } = await env.DB.prepare(`PRAGMA index_list(${table})`).all<{
        name: string
        unique: number
      }>()
      const keys: string[] = []
      for (const index of indexes.filter((candidate) => candidate.unique === 1)) {
        const { results: columns } = await env.DB.prepare(`PRAGMA index_info(${index.name})`).all<{
          seqno: number
          name: string
        }>()
        keys.push(
          columns
            .sort((a, b) => a.seqno - b.seqno)
            .map((column) => column.name)
            .join(', '),
        )
      }
      expect(keys.sort()).toEqual([...uniqueKeys].sort())
    })

    it('never deletes a row', async () => {
      const { ids } = await seed()
      expect(
        await attempt(env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(ids[table])),
      ).toBe(deleted)
      expect(await rowCount(table, ids[table])).toBe(1)
    })

    it('rejects a change to every column that is not derived, and lets the derived ones change', async () => {
      const { ids } = await seed()
      const update = (column: string) =>
        attempt(
          env.DB.prepare(`UPDATE ${table} SET ${column} = ${column} WHERE id = ?`).bind(ids[table]),
        )
      const outcomes: Record<string, string> = {}
      for (const column of [...immutable, ...derived]) outcomes[column] = await update(column)
      expect(outcomes).toEqual({
        ...Object.fromEntries(immutable.map((column) => [column, changed])),
        ...Object.fromEntries(derived.map((column) => [column, 'ok'])),
      })
    })

    it('never replaces a row, so INSERT OR REPLACE cannot delete it around the DELETE trigger', async () => {
      const { ids } = await seed()
      const copy = (verb: string) =>
        attempt(
          env.DB.prepare(`${verb} INTO ${table} SELECT * FROM ${table} WHERE id = ?`).bind(
            ids[table],
          ),
        )
      expect(await copy('INSERT')).toBe(replaced)
      expect(await copy('INSERT OR REPLACE')).toBe(replaced)
      expect(await rowCount(table, ids[table])).toBe(1)
    })
  })

  it('never replaces the tag of a revision under a new id', async () => {
    const { site, ids, now } = await seed()
    const outcome = await attempt(
      env.DB.prepare(
        `INSERT OR REPLACE INTO revision_tags (id, site_id, revision_id, tag, created_at, updated_at)
          VALUES (?1, ?2, ?3, 'news', ?4, ?4)`,
      ).bind(newId('tag'), site, ids.revisions, now),
    )
    expect(outcome).toBe('append-only: this revision already has this tag')
    expect(await rowCount('revision_tags', ids.revision_tags)).toBe(1)
  })

  it('rolls back the whole batch when a trigger aborts one of its statements', async () => {
    const { site, user, entry, ids, now } = await seed()
    const added = newId('rev')
    await expect(
      env.DB.batch([
        env.DB.prepare(INSERT_REVISION).bind(added, site, entry, user, now),
        env.DB.prepare('DELETE FROM revisions WHERE id = ?').bind(ids.revisions),
      ]),
    ).rejects.toThrow('append-only: a revision is never deleted')
    expect(await rowCount('revisions', added)).toBe(0)
  })
})
