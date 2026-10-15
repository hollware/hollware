import { CHUNKER_VERSION, chunksOf, newId, type EntryDocument } from '@hollware/core'
import { and, eq, isNotNull, isNull, ne, or } from 'drizzle-orm'
import type { Db } from '../db/d1.ts'
import { entries, entryEmbeddings, revisions } from '../db/schema.ts'
import { vectorId, type Semantic } from './ports.ts'

export type IndexOutcome = 'indexed' | 'current' | 'removed' | 'absent'

function stringOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** The ids of the vectors of `pieces` pieces of an entry, from `from` on. */
function idsOf(entryId: string, from: number, pieces: number): string[] {
  return Array.from({ length: Math.max(0, pieces - from) }, (_, offset) =>
    vectorId(entryId, from + offset),
  )
}

/**
 * Brings the vectors of one entry in line with what it has published: the pieces of its published
 * revision, embedded with the model of `semantic`. It reads the entry as it is now, so it is right
 * whichever event called it and however late: an entry whose vectors already are of its published
 * revision, model and chunker is `current` and costs no embedding; an entry with nothing published
 * (unpublished, deleted, gone) loses its vectors and its row.
 */
export async function syncEntryVectors(
  db: Db,
  semantic: Semantic,
  input: { readonly site: string; readonly entryId: string; readonly now: string },
): Promise<IndexOutcome> {
  const { site, entryId, now } = input
  const [published] = await db
    .select({
      collection: entries.collection,
      locale: entries.locale,
      revisionId: revisions.id,
      frontmatter: revisions.frontmatter,
      document: revisions.document,
    })
    .from(entries)
    .innerJoin(
      revisions,
      and(eq(revisions.id, entries.publishedRev), eq(revisions.siteId, entries.siteId)),
    )
    .where(and(eq(entries.siteId, site), eq(entries.id, entryId)))
    .limit(1)
  const [stored] = await db
    .select({
      revisionId: entryEmbeddings.revisionId,
      model: entryEmbeddings.model,
      chunkerVersion: entryEmbeddings.chunkerVersion,
      pieces: entryEmbeddings.pieces,
    })
    .from(entryEmbeddings)
    .where(and(eq(entryEmbeddings.siteId, site), eq(entryEmbeddings.entryId, entryId)))
    .limit(1)

  if (published === undefined) {
    if (stored === undefined) return 'absent'
    await semantic.index.remove(idsOf(entryId, 0, stored.pieces))
    await db
      .delete(entryEmbeddings)
      .where(and(eq(entryEmbeddings.siteId, site), eq(entryEmbeddings.entryId, entryId)))
    return 'removed'
  }
  if (
    stored !== undefined &&
    stored.revisionId === published.revisionId &&
    stored.model === semantic.embedder.model &&
    stored.chunkerVersion === CHUNKER_VERSION
  ) {
    return 'current'
  }

  const frontmatter: Record<string, unknown> = JSON.parse(published.frontmatter)
  const document: EntryDocument = JSON.parse(published.document)
  const description = stringOf(frontmatter['description'])
  const chunks = chunksOf({
    title: stringOf(frontmatter['title']) ?? '',
    ...(description === undefined ? {} : { description }),
    document,
  })
  const vectors = await semantic.embedder.embed(chunks.map((chunk) => chunk.text))
  await semantic.index.upsert(
    chunks.map((chunk) => ({
      id: vectorId(entryId, chunk.index),
      values: vectors[chunk.index] ?? [],
      metadata: {
        site,
        entry: entryId,
        collection: published.collection,
        locale: published.locale,
        piece: chunk.index,
      },
    })),
  )
  // A revision with fewer sections than the one before leaves vectors that no piece has now.
  if (stored !== undefined)
    await semantic.index.remove(idsOf(entryId, chunks.length, stored.pieces))
  const row = {
    revisionId: published.revisionId,
    model: semantic.embedder.model,
    chunkerVersion: CHUNKER_VERSION,
    pieces: chunks.length,
    updatedAt: now,
  }
  await db
    .insert(entryEmbeddings)
    .values({ id: newId('emb'), siteId: site, entryId, createdAt: now, ...row })
    .onConflictDoUpdate({ target: [entryEmbeddings.siteId, entryEmbeddings.entryId], set: row })
  return 'indexed'
}

/**
 * The entries whose vectors are not those of what they publish: published with no vectors (before
 * the Worker had semantic search, or an event that never reached the subscriber), of another
 * revision, model or chunker; and entries with vectors and nothing published. At most `limit`.
 */
export async function staleEntries(
  db: Db,
  input: { readonly site: string; readonly model: string; readonly limit: number },
): Promise<string[]> {
  const { site, model, limit } = input
  const published = await db
    .select({ id: entries.id })
    .from(entries)
    .leftJoin(
      entryEmbeddings,
      and(eq(entryEmbeddings.entryId, entries.id), eq(entryEmbeddings.siteId, entries.siteId)),
    )
    .where(
      and(
        eq(entries.siteId, site),
        isNotNull(entries.publishedRev),
        or(
          isNull(entryEmbeddings.id),
          ne(entryEmbeddings.revisionId, entries.publishedRev),
          ne(entryEmbeddings.model, model),
          ne(entryEmbeddings.chunkerVersion, CHUNKER_VERSION),
        ),
      ),
    )
    .limit(limit)
  const left = limit - published.length
  const orphans =
    left <= 0
      ? []
      : await db
          .select({ id: entryEmbeddings.entryId })
          .from(entryEmbeddings)
          .innerJoin(
            entries,
            and(
              eq(entries.id, entryEmbeddings.entryId),
              eq(entries.siteId, entryEmbeddings.siteId),
            ),
          )
          .where(and(eq(entryEmbeddings.siteId, site), isNull(entries.publishedRev)))
          .limit(left)
  return [...published, ...orphans].map((row) => row.id)
}

/**
 * What the cron trigger does for the vectors of a site: brings at most `limit` stale entries in
 * line, so that a site that turns semantic search on, or changes its model, is indexed a few
 * entries a minute without a command. An entry that fails is left for the next run.
 */
export async function healVectors(
  db: Db,
  semantic: Semantic,
  input: { readonly site: string; readonly now: string; readonly limit?: number },
): Promise<{ readonly synced: number; readonly failed: number }> {
  const ids = await staleEntries(db, {
    site: input.site,
    model: semantic.embedder.model,
    limit: input.limit ?? 20,
  })
  let failed = 0
  for (const entryId of ids) {
    await syncEntryVectors(db, semantic, { site: input.site, entryId, now: input.now }).catch(
      () => {
        failed += 1
      },
    )
  }
  return { synced: ids.length - failed, failed }
}
