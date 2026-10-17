import { HollwareError, makePreviewToken } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createRpc } from '../../src/rpc/index.ts'
import { handlers } from '../../src/ops/index.ts'
import { SITE, SITE_KEY, testClock } from '../http/support.ts'
import { seedSite } from '../support/sites.ts'

// Fails when: getEntry of the RPC (`createRpc`, src/rpc/methods.ts) stops reading the latest
// revision of the one entry a valid preview token names, or reads it for a token that is expired,
// of another site, forged, of another entry or checked with no HOLLWARE_SECRET, or answers the
// published version (or nothing) in place of an error for a token that does not hold, or lets a
// preview widen any other read (listEntries stays published-only) (T-103).

const SECRET = 'p'.repeat(32)
const DRAFT = 'from-draft-to-published'

/** The RPC surface over the real handlers and the real D1, with a site seeded: two published, one draft. */
let seededOnce: ReturnType<typeof seedSite> | undefined

async function world(secret: string | null = SECRET) {
  // The tests only read, and the database is shared by the tests of the file: one seed for all.
  const seeded = await (seededOnce ??= seedSite(env.DB, SITE_KEY))
  const clock = testClock()
  const rpc = createRpc(
    { sites: new Map([[SITE.key, SITE]]), handlers, clock, log: () => {} },
    secret === null ? { DB: env.DB } : { DB: env.DB, HOLLWARE_SECRET: secret },
  )
  const idOf = (slug: string) => {
    const found = seeded.entries.find((entry) => entry.slug === slug)
    if (found === undefined) throw new Error(`no seeded entry ${slug}`)
    return found.id
  }
  const tokenFor = async (entryId: string, site = SITE_KEY) =>
    (await makePreviewToken({ secret: SECRET, site, entryId, now: clock.now() })).token
  return { rpc, clock, idOf, tokenFor }
}

async function refusal(promise: Promise<unknown>): Promise<HollwareError> {
  const error: unknown = await promise.then(
    () => null,
    (caught: unknown) => caught,
  )
  if (!(error instanceof HollwareError)) throw new Error('the call was not refused')
  return error
}

describe('getEntry with a preview token', () => {
  it('reads a draft that was never published only with the token of that entry', async () => {
    const { rpc, idOf, tokenFor } = await world()

    const without = await rpc.getEntry(SITE_KEY, 'blog', DRAFT, 'en')
    const previewed = await rpc.getEntry(SITE_KEY, 'blog', DRAFT, 'en', {
      preview: await tokenFor(idOf(DRAFT)),
    })

    expect(without).toEqual({ outcome: 'not_found' })
    expect(previewed.outcome).toBe('ok')
    expect([previewed.entry?.id, previewed.entry?.slug, previewed.entry?.status]).toEqual([
      idOf(DRAFT),
      DRAFT,
      'draft',
    ])
  })

  it('never lets the token widen another read: the list stays published-only', async () => {
    const { rpc } = await world()

    const listed = await rpc.listEntries(SITE_KEY, 'blog', { locale: 'en' })

    expect(listed.entries?.map((entry) => entry.slug)).toEqual(['edge-caching-basics'])
  })

  it('refuses an expired token, a second after its hour, instead of answering the published version', async () => {
    const { rpc, clock, idOf, tokenFor } = await world()
    const token = await tokenFor(idOf('edge-caching-basics'))
    clock.set('2026-10-13T12:59:59.000Z')
    const stillGood = await rpc.getEntry(SITE_KEY, 'blog', 'edge-caching-basics', 'en', {
      preview: token,
    })
    clock.set('2026-10-13T13:00:00.000Z')

    const error = await refusal(
      rpc.getEntry(SITE_KEY, 'blog', 'edge-caching-basics', 'en', { preview: token }),
    )

    expect(stillGood.outcome).toBe('ok')
    expect([error.code, error.message]).toEqual(['invalid_input', 'This preview link has expired.'])
    expect(error.fix).toBe(
      'Ask for a new preview link: in the admin, open the entry and choose "Preview on the site".',
    )
  })

  it('answers another entry with the token of this one as no entry, as it answers a slug of none', async () => {
    const { rpc, idOf, tokenFor } = await world()
    const preview = await tokenFor(idOf(DRAFT))

    const another = await rpc.getEntry(SITE_KEY, 'blog', 'edge-caching-basics', 'en', { preview })
    const none = await rpc.getEntry(SITE_KEY, 'blog', 'no-such-entry', 'en', { preview })

    expect([another, none]).toEqual([{ outcome: 'not_found' }, { outcome: 'not_found' }])
  })

  it('refuses the token of another site and a token that was changed', async () => {
    const { rpc, idOf, tokenFor } = await world()
    const forged = `${await tokenFor(idOf(DRAFT), 'another-site')}`
    const tampered = `${(await tokenFor(idOf(DRAFT))).slice(0, -3)}AAA`

    const errors = await Promise.all(
      [forged, tampered, 'hw_prv_nonsense'].map((preview) =>
        refusal(rpc.getEntry(SITE_KEY, 'blog', DRAFT, 'en', { preview })),
      ),
    )

    expect(errors.map((error) => error.message)).toEqual([
      'This preview link is not valid.',
      'This preview link is not valid.',
      'This preview link is not valid.',
    ])
  })

  it('answers not_found, not an error, for a token that holds when the slug is none', async () => {
    const { rpc, idOf, tokenFor } = await world()

    const answer = await rpc.getEntry(SITE_KEY, 'blog', 'never-written', 'en', {
      preview: await tokenFor(idOf(DRAFT)),
    })

    expect(answer).toEqual({ outcome: 'not_found' })
  })

  it('names the secret when the Worker has none to check a token with', async () => {
    const { rpc, idOf, tokenFor } = await world(null)

    const error = await refusal(
      rpc.getEntry(SITE_KEY, 'blog', DRAFT, 'en', { preview: await tokenFor(idOf(DRAFT)) }),
    )

    expect(error.message).toBe(
      'This Hollware cannot check preview links: it has no HOLLWARE_SECRET of 32 characters or more.',
    )
    expect(error.fix).toContain('HOLLWARE_SECRET')
  })
})
