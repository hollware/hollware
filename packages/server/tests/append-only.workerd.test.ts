import { FORMER_PERSON, newId } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const TABLES = [
  {
    table: 'revisions',
    derived: [
      'frontmatter',
      'document',
      'comark_version',
      'pipeline_version',
      'word_count',
      'code_words',
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
    uniqueKeys: ['id', 'id, site_id'],
    deleted: 'append-only: a revision is never deleted',
    changed: 'append-only: only the derived columns of a revision change',
    replaced: 'append-only: a revision with this id already exists',
  },
  {
    table: 'revision_tags',
    derived: ['updated_at'],
    immutable: ['id', 'site_id', 'revision_id', 'tag', 'created_at'],
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
        published_rev, published_at, published_sort_key, created_at, updated_at)
        VALUES (?1, ?2, 'posts', 'en', 'hello', 'published', 1, ?3, ?3, ?4, ?4, ?4, ?4)`,
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
  it('have the nine triggers of migrations/0002_append_only.sql, the two of search, the three of site_changes and of audit_log, the two of assets and of entry_purges, the two that write the events of reviews and the one that closes the items of a review', async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
    ).all()
    expect(results).toEqual([
      { name: 'assets_immutable', tbl_name: 'assets' },
      { name: 'assets_no_delete', tbl_name: 'assets' },
      { name: 'audit_log_immutable', tbl_name: 'audit_log' },
      { name: 'audit_log_no_delete', tbl_name: 'audit_log' },
      { name: 'audit_log_no_replace', tbl_name: 'audit_log' },
      { name: 'entries_fts_publication', tbl_name: 'entries' },
      { name: 'entries_fts_removal', tbl_name: 'entries' },
      { name: 'entry_purges_immutable', tbl_name: 'entry_purges' },
      { name: 'entry_purges_no_delete', tbl_name: 'entry_purges' },
      { name: 'publications_immutable', tbl_name: 'publications' },
      { name: 'publications_no_delete', tbl_name: 'publications' },
      { name: 'publications_no_replace', tbl_name: 'publications' },
      { name: 'reviews_close_items', tbl_name: 'reviews' },
      { name: 'reviews_decided_event', tbl_name: 'reviews' },
      { name: 'reviews_requested_event', tbl_name: 'reviews' },
      { name: 'revision_tags_immutable', tbl_name: 'revision_tags' },
      { name: 'revision_tags_no_delete', tbl_name: 'revision_tags' },
      { name: 'revision_tags_no_replace', tbl_name: 'revision_tags' },
      { name: 'revisions_immutable', tbl_name: 'revisions' },
      { name: 'revisions_no_delete', tbl_name: 'revisions' },
      { name: 'revisions_no_replace', tbl_name: 'revisions' },
      { name: 'site_changes_immutable', tbl_name: 'site_changes' },
      { name: 'site_changes_no_delete', tbl_name: 'site_changes' },
      { name: 'site_changes_no_replace', tbl_name: 'site_changes' },
    ])
  })

  it('keep the record of a purge: it is neither changed nor deleted', async () => {
    const site = `purges-${crypto.randomUUID().slice(0, 8)}`
    await env.DB.prepare("INSERT INTO sites (id, created_at, updated_at) VALUES (?1, 'now', 'now')")
      .bind(site)
      .run()
    await env.DB.prepare(
      "INSERT INTO entry_purges (id, site_id, entry_id, purged_by, created_at, updated_at) VALUES (?1, ?2, 'ent_1', 'usr_1', 'now', 'now')",
    )
      .bind(`prg_${site}`, site)
      .run()
    const attempt = (sql: string) => env.DB.prepare(sql).bind(`prg_${site}`).run()

    await expect(
      attempt("UPDATE entry_purges SET purged_by = 'usr_2' WHERE id = ?1"),
    ).rejects.toThrow('append-only: the record of a purge never changes')
    await expect(attempt('DELETE FROM entry_purges WHERE id = ?1')).rejects.toThrow(
      'append-only: the record of a purge is never deleted',
    )
  })

  it('let an anonymization that is open name the former person where a line named the one it anonymizes, and change nothing else', async () => {
    const { site, user, ids, now } = await seed()
    const line = {
      change: newId('sit'),
      actor: newId('aud'),
      target: newId('aud'),
      asset: newId('ast'),
      purge: newId('prg'),
    }
    await env.DB.batch([
      env.DB.prepare(
        "INSERT OR IGNORE INTO users (id, role, created_at, updated_at) VALUES (?1, 'reviewer', ?2, ?2)",
      ).bind(FORMER_PERSON, now),
      env.DB.prepare(
        `INSERT INTO site_changes (id, site_id, version, actor_user_id, actor_meta, created_at, updated_at)
          VALUES (?1, ?2, 1, ?3, '{"name":"Claude Code"}', ?4, ?4)`,
      ).bind(line.change, site, user, now),
      env.DB.prepare(
        `INSERT INTO audit_log (id, site_id, action, outcome, actor_kind, actor_user_id, actor_meta, detail, ip_hash, created_at, updated_at)
          VALUES (?1, ?2, 'token.create', 'ok', 'user', ?3, '{"name":"Claude Code"}', '{"kind":"personal","label":"Ana at home"}', 'a-hash', ?4, ?4)`,
      ).bind(line.actor, site, user, now),
      env.DB.prepare(
        `INSERT INTO audit_log (id, site_id, action, outcome, actor_kind, target_type, target_id, created_at, updated_at)
          VALUES (?1, ?2, 'member.remove', 'ok', 'user', 'user', ?3, ?4, ?4)`,
      ).bind(line.target, site, user, now),
      env.DB.prepare(
        `INSERT INTO assets (id, site_id, sha256, format, width, height, bytes, widths, original_format, original_bytes, alt, filename, created_by, created_at, updated_at)
          VALUES (?1, ?2, ?3, 'image/webp', 640, 480, 1234, '[640]', 'image/png', 2345, 'A diagram', 'diagram.png', ?4, ?5, ?5)`,
      ).bind(line.asset, site, 'c'.repeat(64), user, now),
      env.DB.prepare(
        "INSERT INTO entry_purges (id, site_id, entry_id, purged_by, created_at, updated_at) VALUES (?1, ?2, 'ent_1', ?3, ?4, ?4)",
      ).bind(line.purge, site, user, now),
    ])
    const actor = `actor_user_id = '${FORMER_PERSON}', actor_token_id = NULL, actor_meta = NULL`
    const rows = [
      ['revisions', ids.revisions, actor, "markdown = '# Changed'"],
      ['publications', ids.publications, actor, "action = 'unpublish'"],
      [
        'site_changes',
        line.change,
        `actor_user_id = '${FORMER_PERSON}', actor_meta = NULL`,
        "after = '{}'",
      ],
      [
        'audit_log',
        line.actor,
        `${actor}, ip_hash = NULL, detail = json_remove(detail, '$.label')`,
        "outcome = 'denied'",
      ],
      ['audit_log', line.target, `target_id = '${FORMER_PERSON}'`, "action = 'member.role'"],
      ['assets', line.asset, `created_by = '${FORMER_PERSON}'`, "filename = 'other.png'"],
      ['entry_purges', line.purge, `purged_by = '${FORMER_PERSON}'`, "entry_id = 'ent_2'"],
    ] as const
    const changes = (set: (anonymize: string, other: string) => string) =>
      Promise.all(
        rows.map(([table, id, anonymize, other]) =>
          attempt(
            env.DB.prepare(`UPDATE ${table} SET ${set(anonymize, other)} WHERE id = ?1`).bind(id),
          ),
        ),
      )
    const refused = [
      'append-only: only the derived columns of a revision change',
      'append-only: a publication never changes',
      'append-only: a change of the structure never changes',
      'append-only: a line of the activity log never changes',
      'append-only: a line of the activity log never changes',
      'append-only: only the alt of an asset changes',
      'append-only: the record of a purge never changes',
    ]

    const closed = await changes((anonymize) => anonymize)
    await env.DB.prepare(
      'INSERT INTO anonymizations (id, site_id, user_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)',
    )
      .bind(newId('anm'), site, user, now)
      .run()
    const more = await changes((anonymize, other) => `${anonymize}, ${other}`)
    const detail = await attempt(
      env.DB.prepare(
        `UPDATE audit_log SET ${actor}, ip_hash = NULL, detail = '{}' WHERE id = ?1`,
      ).bind(line.actor),
    )
    const open = await changes((anonymize) => anonymize)

    expect(closed).toEqual(refused)
    expect(more).toEqual(refused)
    expect(detail).toBe('append-only: a line of the activity log never changes')
    expect(open).toEqual(rows.map(() => 'ok'))
    expect(
      await env.DB.prepare(
        'SELECT detail, target_id FROM audit_log WHERE id IN (?1, ?2) ORDER BY action DESC',
      )
        .bind(line.actor, line.target)
        .all(),
    ).toMatchObject({
      results: [
        { detail: '{"kind":"personal"}', target_id: null },
        { detail: null, target_id: FORMER_PERSON },
      ],
    })
  })

  it('keep site_changes as it was written: no line is changed, deleted or replaced', async () => {
    const site = `audit-${crypto.randomUUID().slice(0, 8)}`
    await env.DB.prepare("INSERT INTO sites (id, created_at, updated_at) VALUES (?1, 'now', 'now')")
      .bind(site)
      .run()
    await env.DB.prepare(
      "INSERT INTO site_changes (id, site_id, version, created_at, updated_at) VALUES (?1, ?2, 1, 'now', 'now')",
    )
      .bind(`sit_${site}`, site)
      .run()
    const attempt = (sql: string) => env.DB.prepare(sql).bind(`sit_${site}`).run()

    await expect(attempt("UPDATE site_changes SET after = '{}' WHERE id = ?1")).rejects.toThrow(
      'append-only: a change of the structure never changes',
    )
    await expect(attempt('DELETE FROM site_changes WHERE id = ?1')).rejects.toThrow(
      'append-only: a change of the structure is never deleted',
    )
    await expect(
      attempt(
        "INSERT OR REPLACE INTO site_changes (id, site_id, version, created_at, updated_at) SELECT ?1, site_id, 2, 'x', 'x' FROM site_changes WHERE id = ?1",
      ),
    ).rejects.toThrow('append-only: a change of the structure is written once')
  })

  describe('audit_log', () => {
    async function siteKeeping(retention: unknown): Promise<string> {
      const site = `log-${crypto.randomUUID().slice(0, 8)}`
      await env.DB.prepare(
        "INSERT INTO sites (id, definition, created_at, updated_at) VALUES (?1, ?2, 'now', 'now')",
      )
        .bind(site, JSON.stringify({ audit: { retentionDays: retention } }))
        .run()
      return site
    }

    async function line(site: string, daysAgo: number): Promise<string> {
      const id = newId('aud')
      const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString()
      await env.DB.prepare(
        "INSERT INTO audit_log (id, site_id, action, outcome, actor_kind, created_at, updated_at) VALUES (?1, ?2, 'publish', 'ok', 'user', ?3, ?3)",
      )
        .bind(id, site, at)
        .run()
      return id
    }

    const remove = (id: string) =>
      env.DB.prepare('DELETE FROM audit_log WHERE id = ?1').bind(id).run()

    it('never changes a line, nor replaces one by its id', async () => {
      const id = await line(await siteKeeping(null), 0)

      await expect(
        env.DB.prepare("UPDATE audit_log SET outcome = 'denied' WHERE id = ?1").bind(id).run(),
      ).rejects.toThrow('append-only: a line of the activity log never changes')
      await expect(
        env.DB.prepare(
          "INSERT OR REPLACE INTO audit_log (id, site_id, action, outcome, actor_kind, created_at, updated_at) SELECT id, site_id, 'publish', 'denied', 'user', 'x', 'x' FROM audit_log WHERE id = ?1",
        )
          .bind(id)
          .run(),
      ).rejects.toThrow('append-only: a line of the activity log is written once')
    })

    it('deletes a line only once it is older than the retention of its site', async () => {
      const site = await siteKeeping(30)
      const recent = await line(site, 29)
      const old = await line(site, 31)

      await expect(remove(recent)).rejects.toThrow(
        'append-only: a line of the activity log is kept for the retention of its site',
      )
      await remove(old)
      expect([await rowCount('audit_log', recent), await rowCount('audit_log', old)]).toEqual([
        1, 0,
      ])
    })

    it.each([
      ['no retention', null],
      ['a retention below 30 days, written around the operations', 1],
      ['a retention that is no whole number', '30'],
    ])('keeps every line of a site with %s', async (_name, retention) => {
      const id = await line(await siteKeeping(retention), 4000)

      await expect(remove(id)).rejects.toThrow(
        'append-only: a line of the activity log is kept for the retention of its site',
      )
    })
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
