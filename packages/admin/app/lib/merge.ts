interface Hunk {
  readonly start: number
  readonly end: number
  readonly lines: readonly string[]
}

const MAX_CELLS = 4_000_000

function hunks(base: readonly string[], other: readonly string[]): Hunk[] {
  let head = 0
  while (head < base.length && head < other.length && base[head] === other[head]) head++
  let tail = 0
  while (
    tail < base.length - head &&
    tail < other.length - head &&
    base[base.length - 1 - tail] === other[other.length - 1 - tail]
  ) {
    tail++
  }
  const from = base.slice(head, base.length - tail)
  const to = other.slice(head, other.length - tail)
  if (from.length === 0 && to.length === 0) return []
  if (from.length === 0 || to.length === 0 || from.length * to.length > MAX_CELLS) {
    return [{ start: head, end: base.length - tail, lines: to }]
  }
  const width = to.length + 1
  const common = new Uint32Array((from.length + 1) * width)
  for (let i = from.length - 1; i >= 0; i--) {
    for (let j = to.length - 1; j >= 0; j--) {
      common[i * width + j] =
        from[i] === to[j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0)
    }
  }
  const found: Hunk[] = []
  let i = 0
  let j = 0
  let open: { start: number; lines: string[] } | null = null
  const close = () => {
    if (open !== null) found.push({ start: head + open.start, end: head + i, lines: open.lines })
    open = null
  }
  while (i < from.length || j < to.length) {
    if (i < from.length && j < to.length && from[i] === to[j]) {
      close()
      i++
      j++
    } else if (
      j < to.length &&
      (i === from.length || (common[i * width + j + 1] ?? 0) >= (common[(i + 1) * width + j] ?? 0))
    ) {
      open ??= { start: i, lines: [] }
      open.lines.push(to[j] ?? '')
      j++
    } else {
      open ??= { start: i, lines: [] }
      i++
    }
  }
  close()
  return found
}

function applied(base: readonly string[], start: number, end: number, changes: readonly Hunk[]) {
  const out: string[] = []
  let at = start
  for (const hunk of changes) {
    out.push(...base.slice(at, hunk.start), ...hunk.lines)
    at = hunk.end
  }
  out.push(...base.slice(at, end))
  return out
}

export type Side = 'mine' | 'theirs'

export interface Merged {
  readonly text: string
  readonly conflicts: number
}

export function mergeText(base: string, mine: string, theirs: string, prefer: Side): Merged {
  const original = base.split('\n')
  const ours = hunks(original, mine.split('\n')).map((hunk) => ({ ...hunk, side: 'mine' as const }))
  const others = hunks(original, theirs.split('\n')).map((hunk) => ({
    ...hunk,
    side: 'theirs' as const,
  }))
  const all = [...ours, ...others].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: string[] = []
  let at = 0
  let conflicts = 0
  let index = 0
  while (index < all.length) {
    const first = all[index]
    if (first === undefined) break
    const group = [first]
    let end = first.end
    index++
    while (index < all.length) {
      const next = all[index]
      if (next === undefined || next.start > end) break
      group.push(next)
      end = Math.max(end, next.end)
      index++
    }
    const start = first.start
    out.push(...original.slice(at, start))
    const mineGroup = group.filter((hunk) => hunk.side === 'mine')
    const theirsGroup = group.filter((hunk) => hunk.side === 'theirs')
    const mineLines = applied(original, start, end, mineGroup)
    const theirsLines = applied(original, start, end, theirsGroup)
    if (mineGroup.length === 0) out.push(...theirsLines)
    else if (theirsGroup.length === 0) out.push(...mineLines)
    else if (mineLines.join('\n') === theirsLines.join('\n')) out.push(...mineLines)
    else {
      conflicts++
      out.push(...(prefer === 'mine' ? mineLines : theirsLines))
    }
    at = end
  }
  out.push(...original.slice(at))
  return { text: out.join('\n'), conflicts }
}
