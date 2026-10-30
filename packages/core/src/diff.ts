type Line = readonly [' ' | '-' | '+', string]

const MAX_CELLS = 1_000_000

function linesOf(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function middle(before: readonly string[], after: readonly string[]): Line[] {
  const rows = before.length
  const columns = after.length
  if (rows * columns > MAX_CELLS) {
    return [...before.map((line): Line => ['-', line]), ...after.map((line): Line => ['+', line])]
  }
  const width = columns + 1
  const common = new Uint32Array((rows + 1) * width)
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      common[i * width + j] =
        before[i] === after[j]
          ? (common[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(common[(i + 1) * width + j] ?? 0, common[i * width + j + 1] ?? 0)
    }
  }
  const lines: Line[] = []
  let i = 0
  let j = 0
  while (i < rows || j < columns) {
    const old = before[i]
    const next = after[j]
    if (old !== undefined && old === next) {
      lines.push([' ', old])
      i += 1
      j += 1
    } else if (
      next === undefined ||
      (old !== undefined && (common[(i + 1) * width + j] ?? 0) >= (common[i * width + j + 1] ?? 0))
    ) {
      lines.push(['-', old ?? ''])
      i += 1
    } else {
      lines.push(['+', next])
      j += 1
    }
  }
  return lines
}

function compare(before: readonly string[], after: readonly string[]): Line[] {
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start += 1
  }
  let end = 0
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1
  }
  return [
    ...before.slice(0, start).map((line): Line => [' ', line]),
    ...middle(before.slice(start, before.length - end), after.slice(start, after.length - end)),
    ...before.slice(before.length - end).map((line): Line => [' ', line]),
  ]
}

function range(start: number, count: number): string {
  const first = count === 0 ? start - 1 : start
  return count === 1 ? `${first}` : `${first},${count}`
}

/**
 * The unified diff of two texts, line by line: `@@` hunks with three lines of context, and no
 * file headers. Two equal texts give the empty string.
 */
export function unifiedDiff(before: string, after: string, context = 3): string {
  const lines = compare(linesOf(before), linesOf(after))
  const changed = lines.flatMap(([kind], index) => (kind === ' ' ? [] : [index]))
  const hunks: [number, number][] = []
  for (const index of changed) {
    const last = hunks.at(-1)
    if (last !== undefined && index - last[1] <= 2 * context + 1) last[1] = index
    else hunks.push([index, index])
  }
  const out: string[] = []
  let oldLine = 1
  let newLine = 1
  let at = 0
  for (const [first, last] of hunks) {
    const from = Math.max(0, first - context)
    const to = Math.min(lines.length - 1, last + context)
    for (; at < from; at += 1) {
      oldLine += 1
      newLine += 1
    }
    const body = lines.slice(from, to + 1)
    const removed = body.filter(([kind]) => kind !== '+').length
    const added = body.filter(([kind]) => kind !== '-').length
    out.push(`@@ -${range(oldLine, removed)} +${range(newLine, added)} @@`)
    for (const [kind, text] of body) out.push(`${kind}${text}`)
    oldLine += removed
    newLine += added
    at = to + 1
  }
  return out.length === 0 ? '' : `${out.join('\n')}\n`
}
