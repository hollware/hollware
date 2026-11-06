import { describe, expect, it } from 'vite-plus/test'

import {
  buildTree,
  dropZone,
  flatten,
  moveTarget,
  stepTarget,
  type TreeEntry,
} from '../app/lib/entry-tree.ts'

const entry = (slug: string, parent: string | null, position: number | null): TreeEntry => ({
  id: `ent_${slug}`,
  slug,
  parent,
  position,
  title: slug,
})

const HELP = [
  entry('pagos', 'facturacion', 1),
  entry('facturas', 'facturacion', 0),
  entry('reembolsos', 'pagos', 0),
  entry('facturacion', null, 1),
  entry('cuenta', null, 0),
  entry('perfil', 'cuenta', 0),
]

const tree = buildTree(HELP)

describe('the tree of a nested collection', () => {
  it('nests the entries under their parents, each level by position, with their depth', () => {
    expect(flatten(tree).map((node) => [node.entry.slug, node.depth])).toEqual([
      ['cuenta', 1],
      ['perfil', 2],
      ['facturacion', 1],
      ['facturas', 2],
      ['pagos', 2],
      ['reembolsos', 3],
    ])
  })

  it('leaves out the children of a closed branch', () => {
    expect(
      flatten(tree, (node) => node.entry.slug !== 'facturacion').map((node) => node.entry.slug),
    ).toEqual(['cuenta', 'perfil', 'facturacion'])
  })

  it('splits a row in a quarter above, a quarter below and the middle', () => {
    expect([dropZone(4, 40), dropZone(20, 40), dropZone(36, 40)]).toEqual([
      'before',
      'inside',
      'after',
    ])
  })
})

describe('a drop on the tree', () => {
  it('puts an entry inside another as its last child, or beside it among its siblings', () => {
    expect(moveTarget(tree, 'perfil', 'facturacion', 'inside', 3)).toEqual({
      parent: 'facturacion',
      index: 2,
    })
    expect(moveTarget(tree, 'perfil', 'pagos', 'before', 3)).toEqual({
      parent: 'facturacion',
      index: 1,
    })
    expect(moveTarget(tree, 'facturas', 'pagos', 'after', 3)).toEqual({
      parent: 'facturacion',
      index: 1,
    })
  })

  it('refuses a drop on the entry itself or below it, and one deeper than the collection allows', () => {
    expect(moveTarget(tree, 'facturacion', 'reembolsos', 'inside', 3)).toBeNull()
    expect(moveTarget(tree, 'facturacion', 'facturacion', 'after', 3)).toBeNull()
    expect(moveTarget(tree, 'pagos', 'perfil', 'inside', 3)).toBeNull()
    expect(moveTarget(tree, 'pagos', 'perfil', 'inside', 4)).toEqual({ parent: 'perfil', index: 0 })
  })
})

describe('a keyboard step on the tree', () => {
  it('moves an entry up and down among its siblings, into the one above, and out to its parent', () => {
    expect(stepTarget(tree, 'pagos', 'up', 3)).toEqual({ parent: 'facturacion', index: 0 })
    expect(stepTarget(tree, 'facturas', 'down', 3)).toEqual({ parent: 'facturacion', index: 1 })
    expect(stepTarget(tree, 'pagos', 'indent', 3)).toBeNull()
    expect(stepTarget(tree, 'facturacion', 'indent', 3)).toBeNull()
    expect(stepTarget(tree, 'perfil', 'outdent', 3)).toEqual({ parent: null, index: 1 })
    expect(stepTarget(tree, 'cuenta', 'up', 3)).toBeNull()
  })
})
