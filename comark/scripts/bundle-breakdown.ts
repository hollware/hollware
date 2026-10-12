// Size of the unminified bundle per package, from the rolldown `//#region <path>` markers.
// Usage: node scripts/bundle-breakdown.ts [bundle.js]
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'

const file = process.argv[2] ?? 'dist/default/hollware_spike_comark/index.js'
const source = readFileSync(file, 'utf8')
const parts = source.split(/^\/\/#region /m).slice(1)
const sizes = new Map<string, { raw: number; gzip: number; modules: number }>()
for (const part of parts) {
  const [header = '', ...rest] = part.split('\n')
  const body = `${rest.join('\n')}`.replace(/\/\/#endregion\s*$/, '')
  const match = header.match(
    /node_modules\/\.pnpm\/([^/]+)\/node_modules\/(.+?)\/(?:dist|lib|build|index)/,
  )
  const key = match
    ? (match[1] ?? header).replace(/_.*$/, '')
    : header.startsWith('src/')
      ? 'src (spike)'
      : header.slice(0, 60)
  const entry = sizes.get(key) ?? { raw: 0, gzip: 0, modules: 0 }
  entry.raw += Buffer.byteLength(body)
  entry.gzip += gzipSync(body, { level: 9 }).length
  entry.modules += 1
  sizes.set(key, entry)
}
const rows = [...sizes.entries()].sort((a, b) => b[1].raw - a[1].raw)
const total = rows.reduce((sum, [, v]) => sum + v.raw, 0)
console.log(`${file}: ${total} bytes in regions, file ${Buffer.byteLength(source)} bytes`)
for (const [key, v] of rows.slice(0, 20)) {
  console.log(
    `${key.padEnd(48)} ${String(v.raw).padStart(8)} B raw  ${String(v.gzip).padStart(7)} B gzip(sum)  ${String(v.modules).padStart(3)} modules`,
  )
}
