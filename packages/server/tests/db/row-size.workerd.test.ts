import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

import { createD1Store } from '../../src/db/index.ts'
import { MAX_ROW_BYTES } from '../../src/limits.ts'
import type { Actor, NewRevision } from '../../src/ports.ts'
import {
  countRows,
  entryRow,
  fixedClock,
  idFactory,
  insertEntries,
  newRevision,
  seedOwner,
  siteKey,
  VERDICT,
} from './support.ts'

const NOW = '2026-10-12T10:00:00.000Z'

const HUGE = 'a'.repeat(1_950_000)

const OTHER_COLUMNS = 407

const HELLO = { collection: 'blog', locale: 'en', slug: 'hello' }

async function setup() {
  const owner = await seedOwner(env.DB, siteKey('size'))
  const store = createD1Store(env.DB, { clock: fixedClock(NOW).clock })
  const revision = (overrides: Partial<NewRevision> = {}) => newRevision(owner.actor, overrides)
  return { owner, store, revision }
}

describe('createEntry with a row over the limit', () => {
  it('counts the bytes of every column, the Markdown in UTF-8: 1,000,000 two-byte characters and 407 more', async () => {
    const { owner, store, revision } = await setup()

    const answer = await store.createEntry(owner.site, {
      ...HELLO,
      translationGroup: null,
      revision: revision({ markdown: 'é'.repeat(1_000_000) }),
    })

    expect(answer).toEqual({
      outcome: 'too_large',
      bytes: 2_000_000 + OTHER_COLUMNS,
      limit: 1_900_000,
    })
    expect(await countRows(env.DB, 'entries', owner.site)).toBe(0)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(0)
  })

  it('writes a row of exactly the limit, and refuses one with one byte more', async () => {
    const { owner, store, revision } = await setup()
    const room = MAX_ROW_BYTES - OTHER_COLUMNS

    const refused = await store.createEntry(owner.site, {
      ...HELLO,
      translationGroup: null,
      revision: revision({ markdown: 'a'.repeat(room + 1) }),
    })
    const written = await store.createEntry(owner.site, {
      ...HELLO,
      translationGroup: null,
      revision: revision({ markdown: 'a'.repeat(room) }),
    })

    expect(refused).toEqual({
      outcome: 'too_large',
      bytes: MAX_ROW_BYTES + 1,
      limit: MAX_ROW_BYTES,
    })
    if (written.outcome !== 'saved') throw new Error(`Not saved: ${JSON.stringify(written)}`)
    expect(written.view.revision.markdown).toHaveLength(room)
    expect(
      await env.DB.prepare(
        'SELECT length(CAST(markdown AS BLOB)) AS bytes FROM revisions WHERE id = ?',
      )
        .bind(written.view.revision.id)
        .first<number>('bytes'),
    ).toBe(room)
    expect(await countRows(env.DB, 'entries', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(1)
  })

  it.each<[string, (actor: Actor) => Partial<NewRevision>]>([
    ['the Markdown', () => ({ markdown: HUGE })],
    ['the frontmatter', () => ({ frontmatter: { big: HUGE } })],
    ['the document', () => ({ document: { nodes: [['p', {}, HUGE]], frontmatter: {}, meta: {} } })],
    ['the verdict', () => ({ verdict: { ...VERDICT, contractsHash: HUGE } })],
    ['the meta of the actor', (actor) => ({ actor: { ...actor, meta: { client: HUGE } } })],
    ['the version of Comark', () => ({ comarkVersion: HUGE })],
    ['the version of the pipeline', () => ({ pipelineVersion: HUGE })],
  ])(
    'refuses a row that is over the limit because of %s alone, and writes nothing',
    async (_label, overrides) => {
      const { owner, store, revision } = await setup()

      const answer = await store.createEntry(owner.site, {
        ...HELLO,
        translationGroup: null,
        revision: revision(overrides(owner.actor)),
      })

      expect(answer).toMatchObject({ outcome: 'too_large', limit: 1_900_000 })
      expect(answer.outcome === 'too_large' && answer.bytes).toBeGreaterThan(1_950_000)
      expect(await countRows(env.DB, 'entries', owner.site)).toBe(0)
      expect(await countRows(env.DB, 'revisions', owner.site)).toBe(0)
      expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(0)
    },
  )
})

describe('appendRevision with a row over the limit', () => {
  it('refuses it, with what it counted, and changes nothing: not the entry, not its revisions, not its tags', async () => {
    const { owner, store, revision } = await setup()
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      {
        id: id('ent_a'),
        slug: 'a',
        updatedAt: NOW,
        revisions: [{ id: id('rev_a'), tags: ['old'] }],
      },
    ])
    const before = await entryRow(env.DB, id('ent_a'))

    const answer = await store.appendRevision(owner.site, {
      entryId: id('ent_a'),
      expectedVersion: 1,
      translationGroup: null,
      revision: revision({ markdown: 'é'.repeat(1_000_000), tags: ['new'] }),
    })

    expect(answer).toMatchObject({ outcome: 'too_large', limit: 1_900_000 })
    expect(answer.outcome === 'too_large' && answer.bytes).toBeGreaterThan(2_000_000)
    expect(await entryRow(env.DB, id('ent_a'))).toEqual(before)
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(1)
    expect(await countRows(env.DB, 'revision_tags', owner.site)).toBe(1)
  })

  it('writes a row of exactly the limit, and refuses one with one byte more', async () => {
    const { owner, store, revision } = await setup()
    const id = idFactory()
    await insertEntries(env.DB, owner, [
      { id: id('ent_a'), slug: 'a', updatedAt: NOW, revisions: [{ id: id('rev_a') }] },
    ])
    const room = MAX_ROW_BYTES - OTHER_COLUMNS - (id('ent_a').length - 30)

    const refused = await store.appendRevision(owner.site, {
      entryId: id('ent_a'),
      expectedVersion: 1,
      translationGroup: null,
      revision: revision({ markdown: 'a'.repeat(room + 1) }),
    })
    const written = await store.appendRevision(owner.site, {
      entryId: id('ent_a'),
      expectedVersion: 1,
      translationGroup: null,
      revision: revision({ markdown: 'a'.repeat(room) }),
    })

    expect(refused).toEqual({
      outcome: 'too_large',
      bytes: MAX_ROW_BYTES + 1,
      limit: MAX_ROW_BYTES,
    })
    expect(written.outcome).toBe('saved')
    expect(await countRows(env.DB, 'revisions', owner.site)).toBe(2)
  })
})
