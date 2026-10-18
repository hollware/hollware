import { catalogRule } from '@hollware/core'
import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { agent, warmUpComark } from './support.ts'
import { newWorld, type World } from './world.ts'

// Fails when: the rule `reference` of the catalog (src/contracts/rules.ts of @hollware/core) stops
// refusing a slug that names no entry, or stops blocking the publication of an entry that names
// one that is not published, or reads another locale than the one it is given; or get_entry with
// references (src/ops/get-entry.ts) stops answering the published entries a field names, in its
// order, leaving out one that is not published.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

/** The world with a rule on notes: `author` names notes by their slug, in en. */
function withReferences(world: World) {
  const site = world.tenant.site
  const notes = site.collections.get('notes')
  const rule = catalogRule('reference')
  if (notes === undefined || rule === undefined) throw new Error('no notes, or no rule')
  const made = rule.make({ field: 'author', collection: 'notes', locale: 'en' }, 'error')
  const collections = new Map(site.collections)
  collections.set('notes', { ...notes, contracts: [...notes.contracts, made] })
  return agent({ ...world.context(), site: { ...site, collections } })
}

const note = (title: string, author?: string | string[]) =>
  `---\ntitle: ${title}\n${author === undefined ? '' : `author: ${JSON.stringify(author)}\n`}---\n\n${title}.\n`

describe('the reference rule', () => {
  it('refuses a slug that names nothing, and blocks publishing until what it names is published', async () => {
    const world = await newWorld(env.DB, 'references')
    const notes = withReferences(world)
    const ada = await notes.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'ada',
      markdown: note('Ada'),
    })
    const nobody = await notes.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'by-nobody',
      markdown: note('By nobody', 'nobody'),
    })
    const post = await notes.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'by-ada',
      markdown: note('By Ada', ['ada']),
    })

    const blocked = await notes.publish({ id: post.entry?.id ?? '', version: 1 })
    await notes.publish({ id: ada.entry?.id ?? '', version: 1 })
    const published = await notes.publish({ id: post.entry?.id ?? '', version: 1 })

    expect(nobody.verdict?.errors.map((error) => [error.contract, error.path])).toEqual([
      ['reference', '/frontmatter/author'],
    ])
    expect(post.verdict?.errors).toEqual([])
    expect(blocked.outcome).toBe('blocked')
    expect(blocked.verdict?.errors.map((error) => error.message)).toEqual([
      '"author" names "ada" of "notes", which is not published.',
    ])
    expect(published.outcome).toBe('published')
  })

  it('answers the published entries a field names, with get_entry and references', async () => {
    const world = await newWorld(env.DB, 'references-read')
    const notes = withReferences(world)
    for (const slug of ['ada', 'grace', 'draft-only']) {
      const made = await notes.createDraft({
        collection: 'notes',
        locale: 'en',
        slug,
        markdown: note(slug),
      })
      if (slug !== 'draft-only') await notes.publish({ id: made.entry?.id ?? '', version: 1 })
    }
    await notes.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'by-three',
      markdown: note('By three', ['grace', 'draft-only', 'ada']),
    })

    const read = await notes.getEntry({
      collection: 'notes',
      locale: 'en',
      slug: 'by-three',
      references: true,
    })
    const plain = await notes.getEntry({ collection: 'notes', locale: 'en', slug: 'by-three' })

    expect(Object.keys(read.references ?? {})).toEqual(['author'])
    expect(read.references?.['author']?.map((entry) => entry.slug)).toEqual(['grace', 'ada'])
    expect(plain.references).toBeUndefined()
  })
})
