import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { writeRevision } from './optimistic-write.ts'
import { entries } from './schema.ts'
import { sessionAsDatabase } from './session-db.ts'

/**
 * Wiring proof, not product: the one route pair that puts the optimistic write (on the primary)
 * and a session read behind HTTP, so the build bundles drizzle-orm the way a real Worker would.
 */
export default {
  async fetch(request, env) {
    const { pathname, searchParams } = new URL(request.url)
    const entryId = /^\/entries\/([^/]+)$/.exec(pathname)?.[1]
    if (entryId === undefined) return new Response('Not Found', { status: 404 })

    if (request.method === 'GET') {
      const db = drizzle(sessionAsDatabase(env.DB.withSession('first-unconstrained')))
      const [entry] = await db.select().from(entries).where(eq(entries.id, entryId))
      return entry === undefined ? new Response('Not Found', { status: 404 }) : Response.json(entry)
    }

    if (request.method === 'PUT') {
      const outcome = await writeRevision(drizzle(env.DB), {
        entryId,
        expectedVersion: Number(searchParams.get('expectedVersion')),
        revisionId: `rev_${crypto.randomUUID()}`,
        markdown: await request.text(),
        createdAt: new Date().toISOString(),
      })
      return outcome.outcome === 'written'
        ? Response.json({ version: outcome.version }, { status: 201 })
        : Response.json({ error: 'conflict' }, { status: 409 })
    }

    return new Response('Method Not Allowed', { status: 405 })
  },
} satisfies ExportedHandler<Env>
