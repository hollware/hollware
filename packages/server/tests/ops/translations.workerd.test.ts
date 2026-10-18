import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, warmUpComark } from './support.ts'
import { createPost, newWorld, type World } from './world.ts'

// Fails when: a translation (an entry of a group in another locale than the site's default, es
// here) stops being told outdated once its source changed after it was saved, or stays outdated
// once it is saved again; or one written before its source is called outdated; or the entries in
// the default locale get the flag (src/ops/translations.ts, list_entries, get_entry,
// get_translations).

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const at = (world: World, minute: number) =>
  world.time.set(`2026-10-18T10:${String(minute).padStart(2, '0')}:00.000Z`)

async function edit(world: World, id: string, title: string) {
  const read = await world.agent.listEntries({ collection: 'blog' })
  const entry = read.entries.find((candidate) => candidate.id === id)
  const saved = await world.agent.updateDraft({
    id,
    version: entry?.version ?? 0,
    markdown: blogPost({ title, translationGroup: 'pair' }),
  })
  if (saved.outcome !== 'saved') throw new Error(JSON.stringify(saved))
}

const flags = async (world: World) =>
  Object.fromEntries(
    (await world.agent.listEntries({ collection: 'blog' })).entries.map((entry) => [
      entry.locale,
      entry.translationOutdated,
    ]),
  )

describe('an outdated translation', () => {
  it('is one whose source changed after it was saved, until it is saved again', async () => {
    const world = await newWorld(env.DB, 'outdated')
    at(world, 0)
    const source = await createPost(world, { slug: 'origen', locale: 'es', group: 'pair' })
    at(world, 1)
    const translation = await createPost(world, { slug: 'source', locale: 'en', group: 'pair' })

    const fresh = await flags(world)
    at(world, 2)
    await edit(world, source.id, 'Cambiado')
    const behind = await flags(world)
    const read = await world.agent.getEntry({ collection: 'blog', locale: 'en', slug: 'source' })
    const group = await world.agent.getTranslations({
      collection: 'blog',
      translationGroup: 'pair',
    })
    at(world, 3)
    await edit(world, translation.id, 'Changed')
    const caughtUp = await flags(world)

    expect([fresh, behind, caughtUp]).toEqual([
      { es: undefined, en: false },
      { es: undefined, en: true },
      { es: undefined, en: false },
    ])
    // The source of the group is its entry in es, and none other: its first and its head revision.
    expect(
      await world.store.sourceHeadTimes(world.tenant.key, 'es', [
        { collection: 'blog', group: 'pair' },
      ]),
    ).toEqual(
      new Map([
        ['blog\0pair', { first: '2026-10-18T10:00:00.000Z', head: '2026-10-18T10:02:00.000Z' }],
      ]),
    )
    expect(
      await world.store.sourceHeadTimes(world.tenant.key, 'en', [
        { collection: 'blog', group: 'pair' },
      ]),
    ).toEqual(
      new Map([
        ['blog\0pair', { first: '2026-10-18T10:01:00.000Z', head: '2026-10-18T10:03:00.000Z' }],
      ]),
    )
    expect(read.entry?.translationOutdated).toBe(true)
    expect(group.entries?.find((entry) => entry.locale === 'en')?.translationOutdated).toBe(true)
  })

  it('is not one written before its source existed', async () => {
    const world = await newWorld(env.DB, 'outdated-first')
    at(world, 0)
    await createPost(world, { slug: 'source', locale: 'en', group: 'pair' })
    at(world, 1)
    const source = await createPost(world, { slug: 'origen', locale: 'es', group: 'pair' })
    at(world, 2)
    await edit(world, source.id, 'Cambiado')

    expect(await flags(world)).toEqual({ es: undefined, en: false })
  })
})
