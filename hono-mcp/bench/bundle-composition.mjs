// Attributes the bytes of a built (unminified) Worker bundle to the package each //#region belongs to.
import { readFileSync } from 'node:fs'

const file = process.argv[2]
const text = readFileSync(file, 'utf8')
const parts = text.split(/^\/\/#region /m).slice(1)
const totals = new Map()
for (const part of parts) {
  const end = part.indexOf('\n')
  const header = part.slice(0, end)
  const bytes = Buffer.byteLength(part, 'utf8')
  let owner = 'app (src)'
  const pnpm = header.match(/\.pnpm\/([^/]+)\/node_modules\/(@[^/]+\/[^/]+|[^/]+)/)
  if (pnpm) owner = pnpm[2]
  else if (header.includes('../../node_modules/')) owner = header
  else if (header.includes('virtual') || header.startsWith('\0')) owner = 'virtual'
  totals.set(owner, (totals.get(owner) ?? 0) + bytes)
}
const rows = [...totals.entries()].sort((a, b) => b[1] - a[1])
const total = rows.reduce((sum, [, bytes]) => sum + bytes, 0)
console.log(`${file}: ${total} B across ${parts.length} regions`)
for (const [owner, bytes] of rows) {
  console.log(
    `  ${String(bytes).padStart(8)} B  ${((bytes / total) * 100).toFixed(1).padStart(5)}%  ${owner}`,
  )
}
