import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { getNavigation } from '../../src/ops/navigation.ts'
import { resolvePath } from '../../src/ops/resolve.ts'
import { newHelp, rowsOf } from './help.ts'
import { agent, warmUpComark } from './support.ts'

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

describe('create_draft in a nested collection', () => {
  it('puts an entry under its parent, last among its siblings, at the path of its ancestors', async () => {
    const world = await newHelp('tree-create')
    await world.page('facturacion')
    const pagos = await world.page('pagos', 'facturacion')
    const reembolsos = await world.page('reembolsos', 'pagos')
    const facturas = await world.page('facturas', 'facturacion')

    expect([pagos.parent, pagos.slugPath, pagos.position]).toEqual([
      'facturacion',
      'facturacion/pagos',
      0,
    ])
    expect([reembolsos.parent, reembolsos.slugPath]).toEqual([
      'pagos',
      'facturacion/pagos/reembolsos',
    ])
    expect(facturas.position).toBe(1)
  })

  it('refuses a parent that is missing, one that would make it too deep, and any in a flat collection', async () => {
    const world = await newHelp('tree-refuse')
    await world.page('a')
    await world.page('b', 'a')
    await world.page('c', 'b')
    const refusal = async (slug: string, parent: string, collection = 'help') =>
      (
        await world.writer.createDraft({
          collection,
          locale: 'es',
          slug,
          parent,
          markdown: '---\ntitle: X\n---\n\nX\n',
        })
      ).verdict?.errors.map((error) => [error.contract, error.params?.['reason']])

    expect(await refusal('d', 'c')).toEqual([['entry-parent', 'too_deep']])
    expect(await refusal('d', 'nadie')).toEqual([['entry-parent', 'missing']])
    expect(await refusal('nota', 'a', 'notes')).toEqual([['entry-parent', 'not_nested']])
    expect((await rowsOf(world.tenant.key)).map((row) => row.slug)).toEqual(['a', 'b', 'c'])
  })
})

describe('move_entry in a nested collection', () => {
  it('moves an entry and its descendants under another parent, and closes the gap it leaves', async () => {
    const world = await newHelp('tree-move')
    await world.page('cuenta')
    await world.page('facturacion')
    const pagos = await world.page('pagos', 'cuenta')
    await world.page('perfil', 'cuenta')
    await world.page('reembolsos', 'pagos')

    const moved = await world.writer.moveEntry({
      id: pagos.id,
      version: pagos.version,
      parent: 'facturacion',
    })

    expect([moved.outcome, moved.entry?.slugPath]).toEqual(['moved', 'facturacion/pagos'])
    expect(
      (await rowsOf(world.tenant.key)).map((row) => [row.slug_path, row.parent, row.position]),
    ).toEqual([
      ['cuenta', null, 0],
      ['cuenta/perfil', 'cuenta', 0],
      ['facturacion', null, 1],
      ['facturacion/pagos', 'facturacion', 0],
      ['facturacion/pagos/reembolsos', 'pagos', 0],
    ])
  })

  it('puts an entry at an index among its siblings, and renumbers them', async () => {
    const world = await newHelp('tree-order')
    await world.page('raiz')
    await world.page('uno', 'raiz')
    await world.page('dos', 'raiz')
    const tres = await world.page('tres', 'raiz')

    await world.writer.moveEntry({ id: tres.id, version: tres.version, index: 0 })

    expect(
      (await rowsOf(world.tenant.key))
        .filter((row) => row.parent === 'raiz')
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((row) => row.slug),
    ).toEqual(['tres', 'uno', 'dos'])
  })

  it('refuses a cycle, a subtree that would be too deep, and a published entry under a draft', async () => {
    const world = await newHelp('tree-invalid')
    const a = await world.page('a')
    await world.page('b', 'a')
    await world.page('x')
    await world.page('y', 'x')
    await world.page('z', 'y')
    await world.page('suelta')
    await world.publishAll('suelta')
    const suelta = await world.current('suelta')
    const x = await world.current('x')

    const reasons = await Promise.all([
      world.writer.moveEntry({ id: a.id, version: a.version, parent: 'b' }),
      world.writer.moveEntry({ id: a.id, version: a.version, parent: 'a' }),
      world.writer.moveEntry({ id: x.id, version: x.version, parent: 'a' }),
      world.writer.moveEntry({ id: suelta.id, version: suelta.version, parent: 'a' }),
    ])

    expect(reasons.map((answer) => [answer.outcome, answer.reason])).toEqual([
      ['invalid_parent', 'cycle'],
      ['invalid_parent', 'cycle'],
      ['invalid_parent', 'too_deep'],
      ['invalid_parent', 'unpublished'],
    ])
  })

  it('rewrites the paths of the descendants when an ancestor is renamed, with a redirect from each old path', async () => {
    const world = await newHelp('tree-rename')
    await world.page('facturacion')
    await world.page('pagos', 'facturacion')
    await world.page('reembolsos', 'pagos')
    await world.publishAll('facturacion', 'pagos', 'reembolsos')
    const facturacion = await world.current('facturacion')

    await world.writer.moveEntry({
      id: facturacion.id,
      version: facturacion.version,
      slug: 'cobros',
    })

    expect((await rowsOf(world.tenant.key)).map((row) => row.slug_path)).toEqual([
      'cobros',
      'cobros/pagos',
      'cobros/pagos/reembolsos',
    ])
    expect(
      (await world.writer.listRedirects()).redirects
        .map((one) => [one.fromPath ?? '', one.toPath ?? ''])
        .sort(([a = ''], [b = '']) => a.localeCompare(b)),
    ).toEqual([
      ['/ayuda/facturacion/', '/ayuda/cobros/'],
      ['/ayuda/facturacion/pagos/', '/ayuda/cobros/pagos/'],
      ['/ayuda/facturacion/pagos/reembolsos/', '/ayuda/cobros/pagos/reembolsos/'],
    ])
    const { results } = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE site_id = ?1 AND kind = 'entry.published' AND json_extract(payload, '$.path') LIKE '/ayuda/cobros%' ORDER BY json_extract(payload, '$.path')",
    )
      .bind(world.tenant.key)
      .all<{ payload: string }>()
    expect(results.map((row) => JSON.parse(row.payload).path)).toEqual([
      '/ayuda/cobros/',
      '/ayuda/cobros/pagos/',
      '/ayuda/cobros/pagos/reembolsos/',
    ])
  })

  it('keeps every path the path of its parent and its slug, through any moves', async () => {
    const world = await newHelp('tree-invariant')
    const slugs = ['a', 'b', 'c', 'd', 'e', 'f']
    for (const slug of slugs) await world.page(slug)
    let seed = 7
    const next = () => {
      seed = (seed * 48271) % 2147483647
      return seed
    }
    for (let move = 0; move < 30; move += 1) {
      const entry = await world.current(slugs[next() % slugs.length] ?? 'a')
      const pick = next() % (slugs.length + 1)
      await world.writer.moveEntry({
        id: entry.id,
        version: entry.version,
        parent: pick === slugs.length ? null : (slugs[pick] ?? null),
        index: next() % 3,
      })
    }

    const rows = await rowsOf(world.tenant.key)
    for (const row of rows) {
      expect(row.slug_path).toBe(
        row.parent_path === null ? row.slug : `${row.parent_path}/${row.slug}`,
      )
      expect(row.slug_path.split('/').length).toBeLessThanOrEqual(3)
    }
    const byParent = Map.groupBy(rows, (row) => row.parent)
    for (const siblings of byParent.values()) {
      expect(siblings.map((row) => row.position).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual(
        siblings.map((_, at) => at),
      )
    }
  })
})

describe('the children of an entry', () => {
  it('keep it out of the trash and on the site, and its parent in the trash keeps it there', async () => {
    const world = await newHelp('tree-children')
    await world.page('padre')
    await world.page('hija', 'padre')
    await world.publishAll('padre', 'hija')
    const padre = await world.current('padre')

    const unpublished = await world.writer.unpublish({ id: padre.id })
    const hija = await world.current('hija')
    await world.writer.unpublish({ id: hija.id })
    await world.writer.unpublish({ id: padre.id })
    const draftPadre = await world.current('padre')
    const trashed = await world.writer.deleteEntry({
      id: draftPadre.id,
      version: draftPadre.version,
    })

    expect([unpublished.outcome, unpublished.children?.map((child) => child.slug)]).toEqual([
      'has_children',
      ['hija'],
    ])
    expect([trashed.outcome, trashed.children?.map((child) => child.slug)]).toEqual([
      'has_children',
      ['hija'],
    ])

    const draftHija = await world.current('hija')
    await world.writer.deleteEntry({ id: draftHija.id, version: draftHija.version })
    const padreNow = await world.current('padre')
    await world.writer.deleteEntry({ id: padreNow.id, version: padreNow.version })
    const restored = await world.writer.restoreEntry({ id: draftHija.id })

    expect(restored.outcome).toBe('parent_in_trash')
  })
})

describe('publishing in a nested collection', () => {
  it('blocks a child whose parent is not published, and publishes both in one group', async () => {
    const world = await newHelp('tree-publish')
    const padre = await world.page('padre')
    const hija = await world.page('hija', 'padre')

    const alone = await world.writer.publish({ id: hija.id, version: hija.version })
    const both = await world.writer.publish({
      id: hija.id,
      version: hija.version,
      group: [{ id: padre.id, version: padre.version }],
    })

    expect([alone.outcome, alone.verdict?.errors.map((error) => error.message)]).toEqual([
      'blocked',
      ['Its parent "padre" is not published, so the entry would have no page above it.'],
    ])
    expect(both.outcome).toBe('published')
  })
})

describe('reading a nested collection', () => {
  async function published() {
    const world = await newHelp('tree-read')
    await world.page('cuenta')
    await world.page('facturacion')
    await world.page('pagos', 'facturacion')
    await world.page('reembolsos', 'pagos')
    await world.page('borrador', 'facturacion')
    await world.publishAll('cuenta', 'facturacion', 'pagos', 'reembolsos')
    return world
  }

  it('answers the navigation as a tree of the published entries', async () => {
    const world = await published()

    const navigation = await getNavigation({ collection: 'help' }, world.reader)

    const shape = (entries: (typeof navigation.groups)[number]['entries']): unknown[] =>
      entries.map((entry) => [entry.slug, entry.path, shape(entry.children)])
    expect(navigation.groups.map((group) => shape(group.entries))).toEqual([
      [
        ['cuenta', '/ayuda/cuenta/', []],
        [
          'facturacion',
          '/ayuda/facturacion/',
          [
            [
              'pagos',
              '/ayuda/facturacion/pagos/',
              [['reembolsos', '/ayuda/facturacion/pagos/reembolsos/', []]],
            ],
          ],
        ],
      ],
    ])
  })

  it('gives get_entry the ancestors of an entry, from the root down', async () => {
    const world = await published()

    const found = await agent(world.reader).getEntry({
      collection: 'help',
      locale: 'es',
      slug: 'reembolsos',
    })

    expect(found.ancestors).toEqual([
      { slug: 'facturacion', title: 'Página facturacion', path: '/ayuda/facturacion/' },
      { slug: 'pagos', title: 'Página pagos', path: '/ayuda/facturacion/pagos/' },
    ])
  })

  it('resolves a path to its entry, and an old one to where the entry is now', async () => {
    const world = await published()
    const pagos = await world.current('pagos')
    await world.writer.moveEntry({ id: pagos.id, version: pagos.version, parent: 'cuenta' })
    const cuenta = await world.current('cuenta')
    await world.writer.moveEntry({ id: cuenta.id, version: cuenta.version, slug: 'mi-cuenta' })

    const resolve = (path: string) => resolvePath({ path }, world.reader)

    expect(await resolve('/ayuda/mi-cuenta/pagos/reembolsos/?ref=x')).toEqual({
      outcome: 'ok',
      collection: 'help',
      locale: 'es',
      slug: 'reembolsos',
      path: '/ayuda/mi-cuenta/pagos/reembolsos/',
    })
    expect(await resolve('/ayuda/facturacion/pagos/reembolsos/')).toMatchObject({
      outcome: 'redirect',
      path: '/ayuda/mi-cuenta/pagos/reembolsos/',
    })
    expect(await resolve('/ayuda/cuenta/')).toMatchObject({
      outcome: 'redirect',
      path: '/ayuda/mi-cuenta/',
    })
    expect(await resolve('/ayuda/facturacion/borrador/')).toEqual({ outcome: 'not_found' })
    expect(await resolve('/ayuda/a/b/c/d/')).toEqual({ outcome: 'not_found' })
  })
})
