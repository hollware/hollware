const OPENING = /^(\uFEFF?---\r?\n)/
const KEY = /^[A-Za-z_][\w-]*$/

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value === 'boolean') return String(value)
  return null
}

export function withFrontmatterValues(
  markdown: string,
  values: Readonly<Record<string, unknown>>,
  written: Readonly<Record<string, unknown>>,
): string {
  const opening = OPENING.exec(markdown)?.[1]
  if (opening === undefined) return markdown
  const end = markdown.slice(opening.length).search(/^---\r?$/m)
  if (end === -1) return markdown
  const newline = opening.endsWith('\r\n') ? '\r\n' : '\n'
  const body = markdown.slice(opening.length, opening.length + end)
  const rest = markdown.slice(opening.length + end)
  let lines = body === '' ? [] : body.replace(/\r?\n$/, '').split(/\r?\n/)
  let changed = false
  for (const [key, value] of Object.entries(values)) {
    const text = scalar(value)
    if (!KEY.test(key) || text === null || written[key] === value) continue
    const line = `${key}: ${text}`
    const at = lines.findIndex((one) => one.startsWith(`${key}:`))
    if (at === -1) {
      lines = [...lines, line]
    } else {
      let next = at + 1
      while (next < lines.length && /^(\s|-\s)/.test(lines[next] ?? '')) next += 1
      lines = [...lines.slice(0, at), line, ...lines.slice(next)]
    }
    changed = true
  }
  if (!changed) return markdown
  return `${opening}${lines.join(newline)}${newline}${rest}`
}
