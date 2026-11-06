import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { handlers } from '../../src/ops/index.ts'
import { resolvePath } from '../../src/ops/resolve.ts'
import type { ContentStore } from '../../src/ports.ts'
import { runDueUnpublishes } from '../../src/schedule/run.ts'
import { newHelp, rowsOf } from './help.ts'
import { agent, warmUpComark } from './support.ts'

vi.setConfig({ testTimeout: 120_000 })
beforeAll(warmUpComark, 120_000)

type Help = Awaited<ReturnType<typeof newHelp>>

function before<Method extends 'publish' | 'moveEntry' | 'publishGroup'>(
  method: Method,
  intervene: () => Promise<unknown>,
): (store: ContentStore) => ContentStore {
  let done = false
  return (store) => ({
    ...store,
    [method]: async (...args: Parameters<ContentStore[Method]>) => {
      if (!done) {
        done = true
        await intervene()
      }
      return Reflect.apply(store[method], store, args)
    },
  })
}

function siblingsOf(rows: Awaited<ReturnType<typeof rowsOf>>, parent: string | null) {
  return rows
    .filter((row) => row.parent === parent)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((row) => [row.slug, row.position])
}

describe('the tree under writes at the same time', () => {
  it('does not publish a child whose parent was unpublished after the child was checked', async () => {
    let world: Help | undefined
    world = await newHelp(
      'race-publish',
      before('publish', async () => {
        const parent = await world?.current('padre')
        if (parent !== undefined) await world?.writer.unpublish({ id: parent.id })
      }),
    )
    await world.page('padre')
    await world.page('hija', 'padre')
    const padre = await world.current('padre')
    await agent(world.context({}, world.plain)).publish({ id: padre.id, version: padre.version })
    const hija = await world.current('hija')

    const answer = await world.writer.publish({ id: hija.id, version: hija.version })

    expect(answer.outcome).toBe('blocked')
    expect(answer.verdict?.errors.map((error) => error.params?.['reason'])).toEqual(['unpublished'])
    expect((await world.current('hija')).status).toBe('draft')
  })

  it('keeps sibling positions distinct when two entries move into the same parent at once', async () => {
    let world: Help | undefined
    world = await newHelp(
      'race-positions',
      before('moveEntry', async () => {
        const other = await world?.current('b')
        if (other !== undefined) {
          await agent(world?.context({}, world.plain) ?? never()).moveEntry({
            id: other.id,
            version: other.version,
            parent: 'q',
            index: 0,
          })
        }
      }),
    )
    await world.page('p')
    await world.page('q')
    await world.page('a', 'p')
    await world.page('b', 'p')
    await world.page('c', 'q')
    const a = await world.current('a')

    const moved = await world.writer.moveEntry({
      id: a.id,
      version: a.version,
      parent: 'q',
      index: 0,
    })

    expect(moved.outcome).toBe('moved')
    expect(siblingsOf(await rowsOf(world.tenant.key), 'q')).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ])
    expect(siblingsOf(await rowsOf(world.tenant.key), 'p')).toEqual([])
  })

  it('refuses a move that a child created meanwhile would make deeper than the collection allows', async () => {
    let world: Help | undefined
    world = await newHelp(
      'race-depth',
      before('moveEntry', () =>
        agent(world?.context({}, world.plain) ?? never()).createDraft({
          collection: 'help',
          locale: 'es',
          slug: 'c',
          parent: 'b',
          markdown: '---\ntitle: C\n---\n\nC\n',
        }),
      ),
    )
    await world.page('x')
    await world.page('a')
    await world.page('b', 'a')
    const a = await world.current('a')

    const moved = await world.writer.moveEntry({ id: a.id, version: a.version, parent: 'x' })

    expect([moved.outcome, moved.reason]).toEqual(['invalid_parent', 'too_deep'])
    expect((await rowsOf(world.tenant.key)).map((row) => row.slug_path)).toEqual([
      'a',
      'a/b',
      'a/b/c',
      'x',
    ])
  })

  it('sends the event of a descendant published while its ancestor moved, at its new path', async () => {
    let world: Help | undefined
    world = await newHelp(
      'race-events',
      before('moveEntry', async () => {
        const hija = await world?.current('hija')
        if (hija !== undefined) {
          await agent(world?.context({}, world.plain) ?? never()).publish({
            id: hija.id,
            version: hija.version,
          })
        }
      }),
    )
    await world.page('padre')
    await world.page('hija', 'padre')
    await world.publishAll('padre')
    const padre = await world.current('padre')

    await world.writer.moveEntry({ id: padre.id, version: padre.version, slug: 'madre' })

    const { results } = await env.DB.prepare(
      "SELECT json_extract(payload, '$.path') AS path FROM outbox WHERE site_id = ?1 AND kind = 'entry.published' ORDER BY path",
    )
      .bind(world.tenant.key)
      .all<{ path: string }>()
    expect(results.map((row) => row.path)).toContain('/ayuda/madre/hija/')
  })

  it('reads the depth of the definition of the site as it is now, not as the Worker compiled it', async () => {
    const world = await newHelp('race-definition')
    await world.page('a')
    await world.page('b', 'a')
    await env.DB.prepare('UPDATE sites SET definition = ?1 WHERE id = ?2')
      .bind(
        JSON.stringify({ collections: { help: { nesting: { maxDepth: 2 } } } }),
        world.tenant.key,
      )
      .run()

    const answer = await world.writer.createDraft({
      collection: 'help',
      locale: 'es',
      slug: 'c',
      parent: 'b',
      markdown: '---\ntitle: C\n---\n\nC\n',
    })

    expect(answer.verdict?.errors.map((error) => error.params?.['reason'])).toEqual(['changed'])
    expect((await rowsOf(world.tenant.key)).map((row) => row.slug)).toEqual(['a', 'b'])
  })
})

describe('the store of a nested collection', () => {
  it('writes no move whose path is not the path of its parent and its slug', async () => {
    const world = await newHelp('store-path')
    await world.page('p')
    const a = await world.page('a')
    const p = await world.current('p')

    const written = await world.plain.moveEntry(world.tenant.key, {
      entryId: a.id,
      expectedVersion: a.version,
      slug: 'a',
      slugPath: 'elsewhere/a',
      parent: { id: p.id, slugPath: 'p' },
      position: 0,
      positions: [],
      subtree: null,
      events: [],
      redirects: [],
      descendants: '',
      livePaths: ['elsewhere/a'],
      tree: { collection: 'help', locale: 'es', maxDepth: 3 },
    })

    const root = await world.plain.moveEntry(world.tenant.key, {
      entryId: a.id,
      expectedVersion: a.version,
      slug: 'a',
      slugPath: 'p/a',
      parent: null,
      position: a.position,
      positions: [],
      subtree: null,
      events: [],
      redirects: [],
      descendants: '',
      livePaths: ['p/a'],
      tree: { collection: 'help', locale: 'es', maxDepth: 3 },
    })

    expect([written.outcome, root.outcome]).toEqual(['tree_changed', 'tree_changed'])
    expect((await rowsOf(world.tenant.key)).map((row) => row.slug_path)).toEqual(['a', 'p'])
  })
})

describe('reviews, schedules and the trash of a nested collection', () => {
  it('refuses a review that unpublishes a parent without its published children, and approves both', async () => {
    const world = await newHelp('review-children')
    await world.page('padre')
    await world.page('hija', 'padre')
    await world.publishAll('padre', 'hija')
    await world.page('otra')
    const ask = async (withChild: boolean) => {
      const [padre, hija, otra] = await Promise.all(
        ['padre', 'hija', 'otra'].map((slug) => world.current(slug)),
      )
      if (padre === undefined || hija === undefined || otra === undefined) throw new Error('gone')
      return world.writer.requestReview({
        id: otra.id,
        version: otra.version,
        unpublish: [
          { id: padre.id, version: padre.version },
          ...(withChild ? [{ id: hija.id, version: hija.version }] : []),
        ],
      })
    }

    const alone = await ask(false)
    const both = await ask(true)
    const approved =
      both.review === undefined ? both : await world.writer.approveReview({ id: both.review.id })

    expect([alone.outcome, alone.verdict?.errors.map((error) => error.message)]).toEqual([
      'blocked',
      ['Its published children "hija" would be left with no page above them.'],
    ])
    expect(approved.outcome).toBe('published')
    expect([(await world.current('padre')).status, (await world.current('hija')).status]).toEqual([
      'draft',
      'draft',
    ])
  })

  it('blocks the approval of a review whose parent got a published child after it was asked', async () => {
    const world = await newHelp('review-later-child')
    await world.page('padre')
    await world.publishAll('padre')
    await world.page('hija', 'padre')
    await world.page('otra')
    const [padre, otra] = [await world.current('padre'), await world.current('otra')]
    const asked = await world.writer.requestReview({
      id: otra.id,
      version: otra.version,
      unpublish: [{ id: padre.id, version: padre.version }],
    })
    await world.publishAll('hija')

    const approved = await world.writer.approveReview({ id: asked.review?.id ?? '' })

    expect(approved.outcome).toBe('blocked')
    expect([(await world.current('padre')).status, (await world.current('hija')).status]).toEqual([
      'published',
      'published',
    ])
  })

  it('answers has_children for an unpublication due now, and the cron tells it failed and keeps the parent', async () => {
    const world = await newHelp('schedule-children')
    await world.page('padre')
    await world.page('hija', 'padre')
    await world.publishAll('padre', 'hija')
    const padre = await world.current('padre')

    const now = await world.writer.scheduleUnpublish({
      id: padre.id,
      unpublishAt: '2020-01-01T00:00:00.000Z',
    })
    await world.writer.scheduleUnpublish({ id: padre.id, unpublishAt: '2026-10-13T10:30:00.000Z' })
    world.time.set('2026-10-13T11:00:00.000Z')
    const lines: object[] = []
    const run = await runDueUnpublishes({
      site: world.tenant.site,
      store: world.plain,
      handlers,
      clock: world.time.clock,
      log: (line) => lines.push(line),
      scopesOf: () => Promise.resolve(['content:read', 'content:write', 'content:publish']),
    })

    expect([now.outcome, now.children?.map((child) => child.slug)]).toEqual([
      'has_children',
      ['hija'],
    ])
    expect(run).toEqual({ published: 0, cancelled: 1 })
    expect(lines).toEqual([expect.objectContaining({ outcome: 'has_children' })])
    expect((await world.current('padre')).status).toBe('published')
  })

  it('puts an entry back from the trash after its siblings, which moved meanwhile', async () => {
    const world = await newHelp('restore-position')
    await world.page('p')
    await world.page('a', 'p')
    await world.page('b', 'p')
    await world.page('c', 'p')
    const b = await world.current('b')
    await world.writer.deleteEntry({ id: b.id, version: b.version })
    const c = await world.current('c')
    await world.writer.moveEntry({ id: c.id, version: c.version, index: 0 })

    await world.writer.restoreEntry({ id: b.id })

    expect(siblingsOf(await rowsOf(world.tenant.key), 'p')).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
    ])
  })

  it('renumbers a parent of fifty children in statements under the limit of D1', async () => {
    const world = await newHelp('many-siblings')
    await world.page('p')
    for (let n = 0; n < 50; n += 1) await world.page(`n${n}`, 'p')
    const last = await world.current('n49')

    const moved = await world.writer.moveEntry({ id: last.id, version: last.version, index: 0 })

    const order = siblingsOf(await rowsOf(world.tenant.key), 'p')
    expect(moved.outcome).toBe('moved')
    expect(order.slice(0, 3)).toEqual([
      ['n49', 0],
      ['n0', 1],
      ['n1', 2],
    ])
    expect(new Set(order.map(([, position]) => position)).size).toBe(50)
  })
})

describe('resolving paths of a nested collection', () => {
  it('answers an old path of an entry before an entry that has its last slug now', async () => {
    const world = await newHelp('resolve-exact')
    await world.page('a')
    await world.page('x', 'a')
    await world.page('b')
    await world.publishAll('a', 'x', 'b')
    const x = await world.current('x')
    await world.writer.moveEntry({ id: x.id, version: x.version, slug: 'z' })
    await world.page('x', 'b')
    await world.publishAll('x')

    const answer = await resolvePath({ path: '/ayuda/a/x/' }, world.reader)

    expect(answer).toMatchObject({ outcome: 'redirect', slug: 'z', path: '/ayuda/a/z/' })
  })

  it('resolves no draft with a preview token but the entry the token names', async () => {
    const world = await newHelp('resolve-preview')
    await world.page('publicada')
    await world.publishAll('publicada')
    await world.page('secreta')
    const vista = await world.page('vista')
    const head = world.context({
      view: 'head',
      principal: { kind: 'binding', scopes: ['content:read'] },
    })

    const resolve = (path: string) => resolvePath({ path }, head, vista.id)

    expect((await resolve('/ayuda/vista/')).outcome).toBe('ok')
    expect((await resolve('/ayuda/publicada/')).outcome).toBe('ok')
    expect(await resolve('/ayuda/secreta/')).toEqual({ outcome: 'not_found' })
  })
})

function never(): never {
  throw new Error('the world is not there yet')
}
