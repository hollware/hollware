import { describe, expect, it } from 'vite-plus/test'

import type { ContentStore, EntryView, StoredPublication, WriteRefusal } from '../../src/ports.ts'
import { agent, blogPost, contextFor, NO_ENTRY, tenantOf, UNTOUCHED } from './support.ts'

// Fails when: a handler maps an answer of the store that the real store cannot be made to give at
// that call to something else than the spec says. update-draft.ts and publish.ts stop answering
// not_found when the store says the entry is gone between the read and the write; create-draft.ts,
// publish.ts and unpublish.ts stop failing as `internal` on an answer that their call never gets
// (the cause naming the call and the answer, and the message saying nothing about it); answers.ts
// violationOf stops failing on a translation group that is taken in a collection that has none;
// answers.ts publicationView stops failing on a publish that names no revision or verdict, which
// the schema forbids, and shows the entry as if it had been published at nothing.
// The answers that the real store does give (conflict, taken, too_large) are the tests that run
// in workerd, in drafts, publishing and isolation: this store is scripted only for the rest.

const CLOCK = { now: () => new Date('2026-10-13T10:00:00.000Z') }
const REVISION = 'rev_01JAB3XQ8ZK4M6N2P5R7S9T0VX'
const tenant = tenantOf(
  'refusals-site',
  'usr_01JAB3XQ8ZK4M6N2P5R7S9T0VA',
  'tok_01JAB3XQ8ZK4M6N2P5R7S9T0VB',
)

/** An English draft of the blog at version 1, as the store would read it. */
const VIEW: EntryView = {
  entry: {
    id: NO_ENTRY,
    collection: 'blog',
    locale: 'en',
    slug: 'a-post',
    translationGroup: 'guide',
    status: 'draft',
    version: 1,
    headRevision: REVISION,
    publishedRevision: null,
    publishedAt: null,
    updatedAt: '2026-10-13T09:00:00.000Z',
  },
  revision: {
    id: REVISION,
    entryId: NO_ENTRY,
    markdown: blogPost({ translationGroup: 'guide' }),
    frontmatter: {},
    document: { nodes: [], frontmatter: {}, meta: {} },
    comarkVersion: '0.7.0',
    pipelineVersion: '1',
    wordCount: 8,
    verdict: { ok: true, phase: 'write', errors: [], warnings: [], contractsHash: 'stored' },
    tags: [],
    actor: { kind: 'token', userId: tenant.userId, tokenId: tenant.tokenId, meta: null },
    createdAt: '2026-10-13T09:00:00.000Z',
  },
}

/** The pair of its translation group, so that nothing in the publish phase is missing. */
const TRANSLATIONS = [
  {
    collection: 'blog',
    locale: 'en',
    slug: 'a-post',
    id: NO_ENTRY,
    status: 'draft',
    translationGroup: 'guide',
  },
  {
    collection: 'blog',
    locale: 'es',
    slug: 'una-entrada',
    id: 'ent_01JAB3XQ8ZK4M6N2P5R7S9T0VC',
    status: 'draft',
    translationGroup: 'guide',
  },
] as const

/** A store that reads the draft above, and answers each write the way the test scripts it. */
function scripted(writes: Partial<ContentStore>): ContentStore {
  return {
    ...UNTOUCHED,
    findEntryById: async () => VIEW,
    lookup: () => ({
      lookupMany: async (refs) => refs.map(() => null),
      translations: async () => TRANSLATIONS,
    }),
    ...writes,
  }
}

function callerOver(store: ContentStore) {
  return agent(contextFor(tenant, store, { clock: CLOCK, requestId: 'req_refusals_1' }))
}

const CHANGED = blogPost({ title: 'A changed title', translationGroup: 'guide' })
const NOT_FOUND: WriteRefusal = { outcome: 'not_found' }
const CONFLICT: WriteRefusal = { outcome: 'conflict', currentVersion: 2, headRevision: REVISION }
const TAKEN: WriteRefusal = { outcome: 'taken', field: 'slug', by: NO_ENTRY }
const TOO_LARGE: WriteRefusal = { outcome: 'too_large', bytes: 2_000_000, limit: 1_900_000 }

describe('an entry that the store reads and then no longer finds when it writes', () => {
  it('is not_found for update_draft', async () => {
    const store = scripted({ appendRevision: async () => NOT_FOUND })

    expect(
      await callerOver(store).updateDraft({ id: NO_ENTRY, version: 1, markdown: CHANGED }),
    ).toEqual({ outcome: 'not_found' })
  })

  it('is not_found for publish', async () => {
    const store = scripted({ publish: async () => NOT_FOUND })

    expect(await callerOver(store).publish({ id: NO_ENTRY, version: 1 })).toEqual({
      outcome: 'not_found',
    })
  })
})

describe('an answer that the call it comes from never gets', () => {
  const NEW_POST = { collection: 'blog', locale: 'en', slug: 'a-post', markdown: blogPost() }

  it.each([
    [
      'create_draft',
      'createEntry',
      CONFLICT,
      (store: ContentStore) => callerOver(store).createDraft(NEW_POST),
    ],
    [
      'create_draft',
      'createEntry',
      NOT_FOUND,
      (store: ContentStore) => callerOver(store).createDraft(NEW_POST),
    ],
    [
      'publish',
      'publish',
      TAKEN,
      (store: ContentStore) => callerOver(store).publish({ id: NO_ENTRY, version: 1 }),
    ],
    [
      'unpublish',
      'unpublish',
      CONFLICT,
      (store: ContentStore) => callerOver(store).unpublish({ id: NO_ENTRY }),
    ],
    [
      'unpublish',
      'unpublish',
      TAKEN,
      (store: ContentStore) => callerOver(store).unpublish({ id: NO_ENTRY }),
    ],
    [
      'unpublish',
      'unpublish',
      TOO_LARGE,
      (store: ContentStore) => callerOver(store).unpublish({ id: NO_ENTRY }),
    ],
  ])(
    'is an internal error in %s that blames the store call %s and the answer %j, and tells the caller nothing else',
    async (_operation, call, answer, run) => {
      const store = scripted({ [call]: async () => answer })

      await expect(run(store)).rejects.toMatchObject({
        name: 'HollwareError',
        code: 'internal',
        message: 'The operation failed on the server.',
        fix: 'Try again. If it keeps failing, give the site operator this request id: req_refusals_1.',
        cause: { message: `The store answered ${answer.outcome} to ${call}, which it never does.` },
      })
    },
  )

  it('is an error, not a violation, when the store says a translation group is taken in a collection that has none', async () => {
    const store = scripted({
      createEntry: async () => ({ outcome: 'taken', field: 'translationGroup', by: NO_ENTRY }),
    })

    await expect(
      callerOver(store).createDraft({
        collection: 'notes',
        locale: 'en',
        slug: 'a-note',
        markdown: '---\ntitle: A note\n---\n\nText\n',
      }),
    ).rejects.toThrow(
      'The store said that a translation group is taken in the collection notes, which has no translations',
    )
  })
})

describe('a publication that the schema forbids', () => {
  it('is an error, not an answer, when the store reads a publish that names no revision and no verdict', async () => {
    const corrupt: StoredPublication = {
      id: 'pub_01JAB3XQ8ZK4M6N2P5R7S9T0VD',
      entryId: NO_ENTRY,
      action: 'publish',
      revisionId: null,
      verdict: null,
      acknowledged: [],
      actor: VIEW.revision.actor,
      createdAt: '2026-10-13T09:30:00.000Z',
    }
    const store = scripted({ findEntry: async () => VIEW, lastPublication: async () => corrupt })

    await expect(
      callerOver(store).getEntry({ collection: 'blog', locale: 'en', slug: 'a-post' }),
    ).rejects.toThrow(
      'The publication pub_01JAB3XQ8ZK4M6N2P5R7S9T0VD is a publish with no revision or verdict',
    )
  })
})
