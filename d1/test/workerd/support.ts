import { env } from 'cloudflare:workers'

export interface EntryRow {
  id: string
  version: number
  head_rev: string | null
}

export interface RevisionRow {
  id: string
  entry_id: string
  markdown: string
  created_at: string
}

/** Inserts an entry at `version` with no head revision. */
export async function seedEntry(id: string, version: number): Promise<void> {
  await env.DB.prepare('INSERT INTO entries (id, version, head_rev) VALUES (?, ?, NULL)')
    .bind(id, version)
    .run()
}

/** Inserts one revision straight through D1, the way the setup of a test needs it. */
export async function seedRevision(row: RevisionRow): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO revisions (id, entry_id, markdown, created_at) VALUES (?, ?, ?, ?)',
  )
    .bind(row.id, row.entry_id, row.markdown, row.created_at)
    .run()
}

export async function entryRow(id: string): Promise<EntryRow | null> {
  return env.DB.prepare('SELECT id, version, head_rev FROM entries WHERE id = ?')
    .bind(id)
    .first<EntryRow>()
}

export async function revisionsOf(entryId: string): Promise<RevisionRow[]> {
  const { results } = await env.DB.prepare(
    'SELECT id, entry_id, markdown, created_at FROM revisions WHERE entry_id = ? ORDER BY id',
  )
    .bind(entryId)
    .all<RevisionRow>()
  return results
}

export async function triggerNames(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name",
  ).all<{ name: string }>()
  return results.map((row) => row.name)
}

/** Runs `run` and returns what it rejected with. Fails the test when it resolves. */
export async function rejection(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run()
  } catch (error) {
    if (error instanceof Error) return error
    throw new Error(`rejected with something that is not an Error: ${String(error)}`)
  }
  throw new Error('expected a rejection, but the promise resolved')
}

/**
 * The message at the end of the `cause` chain: the text SQLite produced. A raw D1 error is
 * `D1_ERROR: <text>` with that text as its cause; a single drizzle statement wraps that again in
 * a `DrizzleQueryError` ("Failed query: ...").
 */
export function rootMessage(error: Error): string {
  return error.cause instanceof Error ? rootMessage(error.cause) : error.message
}
