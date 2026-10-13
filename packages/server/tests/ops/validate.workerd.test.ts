import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { blogPost, warmUpComark } from './support.ts'
import { createPost, newWorld, snapshotOf } from './world.ts'

// Fails when: validate stops answering as publish would, or writes. validate.ts runs the contracts
// in the write phase, or without the other entries of the site (the translation pair and the
// links read them), or without the routes of every collection of the site (a link to an entry of
// another collection stops counting as a link to an entry), answers a file the pipeline cannot
// store with something else than an ok answer whose verdict is the refusal, runs the contracts
// without the id of the entry when it exists, or saves, changes or publishes anything.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const english = { collection: 'blog', locale: 'en', slug: 'edge-caching-guide' }

describe('validate', () => {
  it('checks a file in the publish phase, where the rules that read other entries run: the translation pair', async () => {
    const world = await newWorld(env.DB, 'validate')
    const markdown = blogPost()

    const alone = await world.agent.validate({ ...english, markdown })
    await createPost(world, {
      slug: 'guia-de-cache',
      locale: 'es',
      group: 'edge-caching-guide',
    })
    const paired = await world.agent.validate({ ...english, markdown })

    expect(alone).toEqual({
      outcome: 'ok',
      verdict: {
        ok: false,
        phase: 'publish',
        errors: [
          {
            contract: 'translation-pair',
            severity: 'error',
            path: '/frontmatter/translationGroup',
            message: 'The es version of the translation group "edge-caching-guide" does not exist.',
            fix: 'Create the entry in es with translationGroup: "edge-caching-guide" in its frontmatter before publishing.',
          },
        ],
        warnings: [],
        contractsHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    })
    expect(paired.verdict).toMatchObject({ ok: true, phase: 'publish', errors: [], warnings: [] })
  })

  it('knows the links of the entries of every collection of the site, and which of them are published', async () => {
    const world = await newWorld(env.DB, 'links')
    const markdown = blogPost(
      {},
      '\nSee [the note](/en/notes/my-note/) and [the post](/en/blog/other-post/).\n',
    )
    await createPost(world, { slug: 'guia-de-cache', locale: 'es', group: 'edge-caching-guide' })

    const broken = await world.agent.validate({ ...english, markdown })
    const note = await world.agent.createDraft({
      collection: 'notes',
      locale: 'en',
      slug: 'my-note',
      markdown: '---\ntitle: A note\n---\n\nText\n',
    })
    const draft = await world.agent.validate({ ...english, markdown })
    await world.agent.publish({ id: note.entry?.id ?? '', version: 1 })
    const published = await world.agent.validate({ ...english, markdown })

    const links = (answer: typeof broken) =>
      answer.verdict.errors.map((error) => [error.contract, error.message, error.line])
    expect(links(broken)).toEqual([
      [
        'internal-links-resolve',
        'The link "/en/notes/my-note/" points at the entry notes/en/my-note, which does not exist.',
        9,
      ],
      [
        'internal-links-resolve',
        'The link "/en/blog/other-post/" points at the entry blog/en/other-post, which does not exist.',
        9,
      ],
    ])
    expect(links(draft)).toEqual([
      [
        'internal-links-resolve',
        'The link "/en/notes/my-note/" points at the entry notes/en/my-note, which is not published yet (draft).',
        9,
      ],
      [
        'internal-links-resolve',
        'The link "/en/blog/other-post/" points at the entry blog/en/other-post, which does not exist.',
        9,
      ],
    ])
    expect(links(published)).toEqual([
      [
        'internal-links-resolve',
        'The link "/en/blog/other-post/" points at the entry blog/en/other-post, which does not exist.',
        9,
      ],
    ])
  })

  it('answers what publish would answer for the same file', async () => {
    const world = await newWorld(env.DB, 'same')
    const markdown = blogPost(
      { title: 'A guide to caching at the edge of the network with Workers and D1 tonight' },
      '\n![](/images/edge.png)\n',
    )
    const created = await world.agent.createDraft({ ...english, markdown })

    const validated = await world.agent.validate({ ...english, markdown })
    const published = await world.agent.publish({ id: created.entry?.id ?? '', version: 1 })

    expect(validated.verdict.errors.map((error) => error.contract)).toEqual([
      'translation-pair',
      'images-have-alt',
    ])
    expect(published.outcome).toBe('blocked')
    expect(published.verdict).toEqual(validated.verdict)
  })

  it('writes nothing, for an entry that exists and for one that does not', async () => {
    const world = await newWorld(env.DB, 'writes')
    const existing = await createPost(world, { slug: 'edge-caching-guide', group: 'guide' })
    const before = await snapshotOf(world.db, world.tenant.key)

    await world.agent.validate({ ...english, markdown: blogPost({ title: 'Another title' }) })
    await world.agent.validate({
      collection: 'blog',
      locale: 'es',
      slug: 'a-new-post',
      markdown: blogPost({ translationGroup: 'guide' }),
    })

    expect(await snapshotOf(world.db, world.tenant.key)).toEqual(before)
    expect((await world.agent.getEntry(english)).entry?.version).toBe(existing.version)
  })

  it('answers ok, with the refusal as its verdict, for a file that cannot be stored', async () => {
    const world = await newWorld(env.DB, 'refused')

    const answer = await world.agent.validate({
      ...english,
      markdown: '---\ntitle: [an unclosed list\n---\n',
    })

    expect(answer).toEqual({
      outcome: 'ok',
      verdict: {
        ok: false,
        phase: 'publish',
        errors: [
          expect.objectContaining({
            contract: 'frontmatter-syntax',
            severity: 'error',
            path: '/frontmatter',
            line: 2,
          }),
        ],
        warnings: [],
        contractsHash: '',
      },
    })
  })

  it('tells the contracts the id of the entry it checks when it exists, and none when it does not', async () => {
    const world = await newWorld(env.DB, 'probe')
    const markdown = '---\ntitle: A note\nprobe: true\n---\n\nText\n'
    const note = { collection: 'notes', locale: 'en', slug: 'a-note', markdown }
    const messages = async () =>
      (await world.agent.validate(note)).verdict.warnings.map((warning) => warning.message)

    expect(await messages()).toEqual(['Run for the entry null.'])
    const created = await world.agent.createDraft(note)
    expect(await messages()).toEqual([`Run for the entry ${created.entry?.id}.`])
  })
})
