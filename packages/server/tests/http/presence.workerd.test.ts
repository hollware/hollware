import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { handlers } from '../../src/ops/index.ts'
import { seedSite } from '../support/sites.ts'
import { adminPerson, call } from './admin-session.ts'
import { boot, CONFIG, NOW, OTHER_SITE_KEY, SITE_KEY } from './support.ts'

const ENTRY = 'from-draft-to-published'

let seededOnce: ReturnType<typeof seedSite> | undefined
let otherOnce: ReturnType<typeof seedSite> | undefined

async function world() {
  const seeded = await (seededOnce ??= seedSite(env.DB, SITE_KEY))
  const other = await (otherOnce ??= seedSite(env.DB, OTHER_SITE_KEY))
  const at = (now: string) => boot({ handlers, config: CONFIG, now })
  const idOf = (slug: string, from = seeded) => {
    const found = from.entries.find((entry) => entry.slug === slug)
    if (found === undefined) throw new Error(`no seeded entry ${slug}`)
    return found.id
  }
  return { worker: at(NOW), at, idOf, other }
}

interface Presence {
  version: number
  savedAt: string
  savedBy: { id: string; kind: string } | null
  editors: { id: string; kind: string }[]
}

describe('POST /v1/admin/presence', () => {
  it('tells each person who else has the entry open, with the version and the author of its latest revision', async () => {
    const { worker, idOf } = await world()
    const ana = await adminPerson(worker, 'editor')
    const bea = await adminPerson(worker, 'author')
    const beat = (who: { access: string }) =>
      call(worker, who.access, '/v1/admin/presence', { entryId: idOf(ENTRY) }).then((answer) =>
        answer.json<Presence>(),
      )

    const first = await beat(ana)
    const second = await beat(bea)
    const third = await beat(ana)

    expect(first.editors).toEqual([])
    expect(second.editors).toEqual([{ id: ana.userId, name: 'Test user', kind: 'person' }])
    expect(third.editors).toEqual([{ id: bea.userId, name: 'Test user', kind: 'person' }])
    expect(third.version).toBe(first.version)
    expect(third.savedBy?.kind).toBe('person')
    expect(third.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('forgets a person who leaves, and one not seen for 45 seconds', async () => {
    const { worker, at, idOf } = await world()
    const ana = await adminPerson(worker, 'editor')
    const bea = await adminPerson(worker, 'editor')
    const beat = (on: typeof worker, who: { access: string }, leaving = false) =>
      call(on, who.access, '/v1/admin/presence', {
        entryId: idOf('edge-caching-basics'),
        ...(leaving ? { leaving } : {}),
      }).then((answer) => answer.json<Presence>())

    await beat(worker, bea)
    await beat(worker, bea, true)
    const afterLeaving = await beat(worker, ana)
    await beat(worker, bea)
    const later = at(new Date(Date.parse(NOW) + 46_000).toISOString())
    const afterSilence = await beat(later, ana)

    expect(afterLeaving.editors).toEqual([])
    expect(afterSilence.editors).toEqual([])
  })

  it('refuses an entry of another site, a body without one, and a personal token', async () => {
    const { worker, idOf, other } = await world()
    const owner = await adminPerson(worker, 'owner')
    const send = async (body: unknown) => {
      const answer = await call(worker, owner.access, '/v1/admin/presence', body)
      return [answer.status, (await answer.json<{ code: string }>()).code]
    }

    expect(await send({ entryId: idOf(ENTRY, other) })).toEqual([404, 'not_found'])
    expect(await send({})).toEqual([400, 'invalid_input'])
    expect(
      (await call(worker, owner.token, '/v1/admin/presence', { entryId: idOf(ENTRY) })).status,
    ).toBe(403)
  })
})
