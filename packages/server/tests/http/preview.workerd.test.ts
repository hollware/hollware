import { defineCollection, defineConfig, verifyPreviewToken } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { handlers } from '../../src/ops/index.ts'
import { seedSite } from '../support/sites.ts'
import { adminPerson, call } from './admin-session.ts'
import { boot, CONFIG, NOW, OTHER_SITE_KEY, SITE_KEY } from './support.ts'

// Fails when: the admin's route of previews (`POST /v1/admin/preview`, src/http/admin-api.ts)
// stops making a signed token of one hour for an entry of the person's site for any member, or
// answers the entry's page on the site with `?hollware-preview=<token>` (null without a site
// URL), or answers 200 for an entry of another site, a body that names no entry, a token of
// another client or no signing secret (503 `unavailable`), or stops writing the line
// `preview.create` of the activity log without the token; or the read API stops reading the
// latest revision with `?preview=` (uncacheable: `no-store` and no ETag, a refusal included) for a
// valid token and nothing else (T-103).

const SECRET = 'q'.repeat(32)
const DRAFT = 'from-draft-to-published'
const PUBLISHED = 'edge-caching-basics'

const WITH_URL = defineConfig({
  sites: {
    [SITE_KEY]: {
      locales: ['en', 'es'],
      defaultLocale: 'en',
      url: 'https://site.example/',
      collections: {
        blog: defineCollection({
          schema: z.object({ title: z.string().min(1) }),
          routes: { en: '/blog/:slug/', es: '/es/blog/:slug/' },
        }),
      },
    },
  },
})

let seededOnce: ReturnType<typeof seedSite> | undefined
let otherOnce: ReturnType<typeof seedSite> | undefined

async function world(options: { url?: boolean; secret?: boolean; now?: string } = {}) {
  // The tests share the database of the file: the site is seeded once.
  const seeded = await (seededOnce ??= seedSite(env.DB, SITE_KEY))
  const other = await (otherOnce ??= seedSite(env.DB, OTHER_SITE_KEY))
  const worker = boot({
    handlers,
    config: options.url === false ? CONFIG : WITH_URL,
    ...(options.now === undefined ? {} : { now: options.now }),
    bindings: options.secret === false ? {} : { HOLLWARE_SECRET: SECRET },
  })
  const idOf = (slug: string, from = seeded) => {
    const found = from.entries.find((entry) => entry.slug === slug)
    if (found === undefined) throw new Error(`no seeded entry ${slug}`)
    return found.id
  }
  return { worker, seeded, other, idOf }
}

interface Made {
  token: string
  expiresAt: string
  url: string | null
}

describe('POST /v1/admin/preview', () => {
  it('makes a link of one hour to the entry on the site, for any member', async () => {
    const { worker, idOf } = await world()
    const author = await adminPerson(worker, 'author')

    const answer = await call(worker, author.access, '/v1/admin/preview', {
      entryId: idOf(DRAFT),
    })
    const made = await answer.json<Made>()

    expect(answer.status).toBe(200)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(made.expiresAt).toBe('2026-10-13T13:00:00.000Z')
    expect(made.url).toBe(`https://site.example/blog/${DRAFT}/?hollware-preview=${made.token}`)
    expect(
      await verifyPreviewToken({
        secret: SECRET,
        site: SITE_KEY,
        token: made.token,
        now: new Date(NOW),
      }),
    ).toEqual({ ok: true, entryId: idOf(DRAFT), expiresAt: made.expiresAt })
  })

  it('makes a link the read API honours: the draft is read with it, and not without it', async () => {
    const { worker, seeded, idOf } = await world()
    const owner = await adminPerson(worker, 'editor')
    const made = await (
      await call(worker, owner.access, '/v1/admin/preview', { entryId: idOf(DRAFT) })
    ).json<Made>()

    const without = await worker.send(`/v1/blog/en/${DRAFT}`, { token: seeded.token })
    const previewed = await worker.send(`/v1/blog/en/${DRAFT}?preview=${made.token}`, {
      token: seeded.token,
    })

    expect(without.status).toBe(404)
    expect(previewed.status).toBe(200)
    expect(previewed.headers.get('cache-control')).toBe('no-store')
    expect(previewed.headers.get('etag')).toBeNull()
    expect(
      await previewed
        .json<{ entry: { slug: string; status: string } }>()
        .then(({ entry }) => entry),
    ).toMatchObject({ slug: DRAFT, status: 'draft' })
  })

  it('answers no url when the site has none', async () => {
    const { worker, idOf } = await world({ url: false })
    const owner = await adminPerson(worker, 'owner')

    const made = await (
      await call(worker, owner.access, '/v1/admin/preview', { entryId: idOf(DRAFT) })
    ).json<Made>()

    expect(made.url).toBeNull()
    expect(made.token.startsWith('hw_prv_')).toBe(true)
  })

  it('writes a line of the activity log, and never the token', async () => {
    const { worker, idOf } = await world({ now: '2026-10-13T12:30:00.000Z' })
    const person = await adminPerson(worker, 'author')

    const made = await (
      await call(worker, person.access, '/v1/admin/preview', { entryId: idOf(PUBLISHED) })
    ).json<Made>()

    const { results } = await env.DB.prepare(
      `SELECT action, outcome, actor_kind, actor_user_id, target_type, target_id, detail
       FROM audit_log WHERE site_id = ?1 AND actor_user_id = ?2`,
    )
      .bind(SITE_KEY, person.userId)
      .all()
    expect(results).toEqual([
      {
        action: 'preview.create',
        outcome: 'ok',
        actor_kind: 'user',
        actor_user_id: person.userId,
        target_type: 'entry',
        target_id: idOf(PUBLISHED),
        detail: '{"expiresAt":"2026-10-13T13:30:00.000Z"}',
      },
    ])
    expect(JSON.stringify(results)).not.toContain(made.token)
  })

  it('refuses an entry that is not of the site, and a body that names none', async () => {
    const { worker, idOf, other } = await world()
    const owner = await adminPerson(worker, 'owner')
    const send = async (body: unknown) => {
      const answer = await call(worker, owner.access, '/v1/admin/preview', body)
      return [answer.status, (await answer.json<{ code: string }>()).code]
    }

    expect(await send({ entryId: idOf(DRAFT, other) })).toEqual([404, 'not_found'])
    expect(await send({ entryId: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VW' })).toEqual([404, 'not_found'])
    expect(await send({ entryId: 'nope' })).toEqual([400, 'invalid_input'])
    expect(await send({})).toEqual([400, 'invalid_input'])
  })

  it('is the admin only: a personal token, even an owner`s, is refused', async () => {
    const { worker, idOf } = await world()
    const owner = await adminPerson(worker, 'owner')

    const answer = await call(worker, owner.token, '/v1/admin/preview', { entryId: idOf(DRAFT) })

    expect(answer.status).toBe(403)
    expect((await answer.json<{ message: string }>()).message).toBe('Only the admin may do this.')
  })

  it('answers 503 unavailable, naming the secret, when the Worker has none', async () => {
    const { worker, idOf } = await world({ secret: false })
    const owner = await adminPerson(worker, 'owner')

    const answer = await call(worker, owner.access, '/v1/admin/preview', { entryId: idOf(DRAFT) })

    expect(answer.status).toBe(503)
    expect(await answer.json()).toEqual({
      code: 'unavailable',
      message: 'This Hollware cannot make preview links: it has no signing secret.',
      fix: 'Set the Worker secret HOLLWARE_SECRET to at least 32 characters (`hollware deploy` makes one), then try again.',
    })
  })
})

describe('the read API with a preview token', () => {
  it('refuses an expired token with a 400 that nothing keeps, and answers another entry with its token as no entry', async () => {
    const { worker, seeded, idOf } = await world()
    const owner = await adminPerson(worker, 'owner')
    const made = await (
      await call(worker, owner.access, '/v1/admin/preview', { entryId: idOf(DRAFT) })
    ).json<Made>()

    const another = await worker.send(`/v1/blog/en/${PUBLISHED}?preview=${made.token}`, {
      token: seeded.token,
    })
    const missing = await worker.send(`/v1/blog/en/no-such-entry?preview=${made.token}`, {
      token: seeded.token,
    })
    worker.clock.set('2026-10-13T13:00:00.000Z')
    const expired = await worker.send(`/v1/blog/en/${DRAFT}?preview=${made.token}`, {
      token: seeded.token,
    })

    // The same for a published entry of another slug and for no entry: the token tells nothing.
    expect([another.status, missing.status, expired.status]).toEqual([404, 404, 400])
    expect(await another.json()).toEqual(await missing.json())
    expect(expired.headers.get('cache-control')).toBe('no-store')
    expect(await expired.json()).toEqual({
      code: 'invalid_input',
      message: 'This preview link has expired.',
      fix: 'Ask for a new preview link: in the admin, open the entry and choose "Preview on the site".',
    })
  })

  it('keeps answering a published entry as before without a token: an ETag, revalidated', async () => {
    const { worker, seeded } = await world()

    const first = await worker.send(`/v1/blog/en/${PUBLISHED}`, { token: seeded.token })
    const again = await worker.send(`/v1/blog/en/${PUBLISHED}`, {
      token: seeded.token,
      headers: { 'if-none-match': first.headers.get('etag') ?? '' },
    })

    expect(first.headers.get('cache-control')).toBe('private, no-cache')
    expect([first.status, again.status]).toEqual([200, 304])
  })
})
