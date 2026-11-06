export interface TreeEntry {
  readonly id: string
  readonly slug: string
  readonly parent: string | null
  readonly position: number | null
  readonly title: string
}

export type TreeRow = TreeEntry & {
  readonly collection: string
  readonly locale: string
  readonly status: 'draft' | 'scheduled' | 'published'
}

export interface TreeNode<Entry extends TreeEntry> {
  readonly entry: Entry
  readonly depth: number
  readonly children: readonly TreeNode<Entry>[]
}

export type DropZone = 'before' | 'inside' | 'after'

export interface MoveTarget {
  readonly parent: string | null
  readonly index: number
}

function bySiblingOrder(a: TreeEntry, b: TreeEntry): number {
  const position =
    (a.position ?? Number.POSITIVE_INFINITY) - (b.position ?? Number.POSITIVE_INFINITY)
  return Math.sign(position || 0) || a.title.localeCompare(b.title) || (a.slug < b.slug ? -1 : 1)
}

export function buildTree<Entry extends TreeEntry>(entries: readonly Entry[]): TreeNode<Entry>[] {
  const present = new Set(entries.map((entry) => entry.slug))
  const children = new Map<string | null, Entry[]>()
  for (const entry of entries) {
    const parent = entry.parent !== null && present.has(entry.parent) ? entry.parent : null
    children.set(parent, [...(children.get(parent) ?? []), entry])
  }
  const grow = (
    parent: string | null,
    depth: number,
    seen: ReadonlySet<string>,
  ): TreeNode<Entry>[] =>
    [...(children.get(parent) ?? [])].sort(bySiblingOrder).map((entry) => ({
      entry,
      depth,
      children: seen.has(entry.slug)
        ? []
        : grow(entry.slug, depth + 1, new Set([...seen, entry.slug])),
    }))
  return grow(null, 1, new Set())
}

export function flatten<Entry extends TreeEntry>(
  nodes: readonly TreeNode<Entry>[],
  open: (node: TreeNode<Entry>) => boolean = () => true,
): TreeNode<Entry>[] {
  return nodes.flatMap((node) => [node, ...(open(node) ? flatten(node.children, open) : [])])
}

export function heightOf(node: TreeNode<TreeEntry>): number {
  return 1 + Math.max(0, ...node.children.map(heightOf))
}

function find<Entry extends TreeEntry>(
  nodes: readonly TreeNode<Entry>[],
  slug: string,
): TreeNode<Entry> | undefined {
  for (const node of nodes) {
    if (node.entry.slug === slug) return node
    const below = find(node.children, slug)
    if (below !== undefined) return below
  }
  return undefined
}

function siblingsOf<Entry extends TreeEntry>(
  tree: readonly TreeNode<Entry>[],
  parent: string | null,
): readonly TreeNode<Entry>[] {
  return parent === null ? tree : (find(tree, parent)?.children ?? [])
}

export function dropZone(offset: number, height: number): DropZone {
  if (offset < height / 4) return 'before'
  if (offset > (height * 3) / 4) return 'after'
  return 'inside'
}

export function moveTarget<Entry extends TreeEntry>(
  tree: readonly TreeNode<Entry>[],
  dragged: string,
  target: string,
  zone: DropZone,
  maxDepth: number,
): MoveTarget | null {
  const moving = find(tree, dragged)
  const onto = find(tree, target)
  if (moving === undefined || onto === undefined) return null
  if (find([moving], target) !== undefined) return null
  const depth = zone === 'inside' ? onto.depth + 1 : onto.depth
  if (depth + heightOf(moving) - 1 > maxDepth) return null
  if (zone === 'inside') {
    const others = onto.children.filter((child) => child.entry.slug !== dragged)
    return { parent: target, index: others.length }
  }
  const parent = onto.entry.parent
  const others = siblingsOf(tree, parent).filter((sibling) => sibling.entry.slug !== dragged)
  const at = others.findIndex((sibling) => sibling.entry.slug === target)
  return { parent, index: zone === 'before' ? at : at + 1 }
}

export type Step = 'up' | 'down' | 'outdent' | 'indent'

export function stepTarget<Entry extends TreeEntry>(
  tree: readonly TreeNode<Entry>[],
  slug: string,
  step: Step,
  maxDepth: number,
): MoveTarget | null {
  const node = find(tree, slug)
  if (node === undefined) return null
  const siblings = siblingsOf(tree, node.entry.parent)
  const at = siblings.findIndex((sibling) => sibling.entry.slug === slug)
  const previous = siblings[at - 1]
  const next = siblings[at + 1]
  switch (step) {
    case 'up':
      return previous === undefined
        ? null
        : moveTarget(tree, slug, previous.entry.slug, 'before', maxDepth)
    case 'down':
      return next === undefined ? null : moveTarget(tree, slug, next.entry.slug, 'after', maxDepth)
    case 'indent':
      return previous === undefined
        ? null
        : moveTarget(tree, slug, previous.entry.slug, 'inside', maxDepth)
    case 'outdent':
      return node.entry.parent === null
        ? null
        : moveTarget(tree, slug, node.entry.parent, 'after', maxDepth)
  }
}
