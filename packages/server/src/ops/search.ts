import { chunksOf, type Chunk } from '@hollware/core'
import type { SearchHit } from '../ports.ts'
import { entrySummary } from './answers.ts'
import { forReaders } from './assets.ts'
import { collectionOfEntry, requireCollection, requireLocale } from './collections.ts'
import { entryPath } from './event.ts'
import type { OperationContext, OperationHandler } from './types.ts'
import { fuse, semanticSearch, SEMANTIC_TOP_K } from './semantic-search.ts'

/**
 * The published entries of the site that match the query, best first: by its words, by meaning,
 * or both (ADR-030). Without the semantic search of the deployment, every mode is full text, and
 * the answer's `mode` says which one ran.
 */
export const search: OperationHandler<'search'> = async (input, context) => {
  if (input.collection !== undefined) requireCollection(context.site, input.collection)
  if (input.locale !== undefined) requireLocale(context.site, input.locale)
  const query = {
    text: input.query,
    collection: input.collection,
    locale: input.locale,
    limit: input.limit,
    minScore: input.minScore,
  }
  const semantic = context.semantic ?? null
  const asked = input.mode ?? 'hybrid'
  const mode = semantic === null ? 'fulltext' : asked
  const site = context.site.key
  let hits
  if (semantic === null || mode === 'fulltext') {
    hits = await context.store.searchEntries(site, query)
  } else if (mode === 'semantic') {
    hits = await semanticSearch(semantic, context.store, site, query)
  } else {
    // Each list longer than the answer, so that an entry low in one can rise with the other.
    const wide = { ...query, limit: Math.max(query.limit, SEMANTIC_TOP_K) }
    const [words, meaning] = await Promise.all([
      context.store.searchEntries(site, wide),
      semanticSearch(semantic, context.store, site, wide),
    ])
    hits = fuse([words, meaning], query.limit)
  }
  const passages = input.passages
    ? await Promise.all(hits.map((hit) => passageOf(context, hit, input.query)))
    : []
  return {
    outcome: 'ok',
    mode,
    results: hits.map((hit, place) => {
      const passage = passages[place]
      return {
        entry: forReaders(context, entrySummary(hit.entry)),
        snippet: hit.snippet,
        score: hit.score,
        ...(passage === undefined ? {} : { passage }),
      }
    }),
  }
}

/** The words of a text, lowercase and without accents, as full text compares them. */
function wordsOf(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1)
}

/** The piece that holds the most words of the query, a section before the summary on a tie. */
function bestByWords(chunks: readonly Chunk[], query: string): Chunk | undefined {
  const asked = new Set(wordsOf(query))
  let best: { chunk: Chunk; found: number } | undefined
  for (const chunk of chunks) {
    const found = new Set(
      wordsOf(`${chunk.heading ?? ''} ${chunk.text}`).filter((word) => asked.has(word)),
    ).size
    if (
      best === undefined ||
      found > best.found ||
      (found === best.found && best.chunk.index === 0 && found > 0)
    ) {
      best = { chunk, found }
    }
  }
  return best?.chunk
}

/**
 * The passage a hit stands on: the piece a match by meaning found, or the one that holds most of
 * the words of the query, read from the published revision with the chunker of the vectors, and
 * the URL of the entry on the site. `undefined` for an entry no longer published.
 */
async function passageOf(context: OperationContext, hit: SearchHit, query: string) {
  const found = await context.store.findEntryById(context.site.key, hit.entry.entry.id, 'published')
  if (found === null) return undefined
  const { entry, revision } = found
  const title = revision.frontmatter['title']
  const description = revision.frontmatter['description']
  const chunks = chunksOf({
    title: typeof title === 'string' ? title : '',
    ...(typeof description === 'string' ? { description } : {}),
    document: revision.document,
  })
  const chunk =
    (hit.piece === undefined ? undefined : chunks.find((piece) => piece.index === hit.piece)) ??
    bestByWords(chunks, query) ??
    chunks[0]
  const path = entryPath(collectionOfEntry(context.site, entry), entry.locale, entry.slug)
  const heading = chunk?.heading ?? null
  const text = chunk?.text ?? ''
  return {
    heading,
    // A section's piece starts with its heading, for the vector: the passage has it apart.
    text:
      heading !== null && text.startsWith(heading) ? text.slice(heading.length).trimStart() : text,
    url: path === null || context.site.url === null ? null : `${context.site.url}${path}`,
  }
}
