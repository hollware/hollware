// What is in a built Worker, and does it need Node.js? Run with Node 24 on the output of `vp build`.
//
//   node scripts/bundle-report.ts dist/hollware_spike_auth/index.js [--packages]
//
// It prints the size (raw, gzip, brotli) and scans the bundle for what only Node.js has: `node:`
// specifiers, `require(`, `process`, `Buffer`, and code generation from strings (`eval`,
// `new Function`), which workerd refuses. The package table works on an UNMINIFIED bundle, where
// Rolldown leaves a `//#region <path>` marker around every module.

import { readFileSync } from 'node:fs'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const [file, ...flags] = process.argv.slice(2)
if (file === undefined)
  throw new Error('Usage: node scripts/bundle-report.ts <index.js> [--packages]')

const source = readFileSync(file, 'utf8')
const bytes = Buffer.from(source)
const gzip = (data: Buffer) => gzipSync(data).length
const brotli = (data: Buffer) =>
  brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length

console.log(`file:   ${file}`)
console.log(`raw:    ${bytes.length} bytes (${(bytes.length / 1024).toFixed(2)} KiB)`)
console.log(`gzip:   ${gzip(bytes)} bytes (${(gzip(bytes) / 1024).toFixed(2)} KiB)`)
console.log(`brotli: ${brotli(bytes)} bytes (${(brotli(bytes) / 1024).toFixed(2)} KiB)`)

// Which module (region) a character offset belongs to.
const regions: { name: string; start: number; end: number }[] = []
for (const match of source.matchAll(/^\/\/#region (.+)$/gm)) {
  const start = match.index ?? 0
  const end = source.indexOf('//#endregion', start)
  regions.push({ name: match[1] ?? '?', start, end: end === -1 ? source.length : end })
}
const regionAt = (offset: number) =>
  regions.find((region) => offset >= region.start && offset < region.end)?.name ?? '(bundle glue)'

const packageOf = (name: string): string => {
  const parts = [...name.matchAll(/node_modules\/((?:@[^/]+\/)?[^/]+)\//g)]
  return parts.at(-1)?.[1] ?? '(application code)'
}

if (flags.includes('--packages')) {
  const byPackage = new Map<string, string[]>()
  for (const region of regions) {
    const key = packageOf(region.name)
    byPackage.set(key, [...(byPackage.get(key) ?? []), source.slice(region.start, region.end)])
  }
  const rows = [...byPackage.entries()]
    .map(([name, parts]) => {
      const text = Buffer.from(parts.join('\n'))
      return { name, modules: parts.length, raw: text.length, gzip: gzip(text) }
    })
    .sort((a, b) => b.raw - a.raw)
  console.log(
    '\npackage'.padEnd(45) + 'modules'.padStart(8) + 'raw'.padStart(10) + 'gzip*'.padStart(10),
  )
  for (const row of rows) {
    console.log(
      row.name.padEnd(44) +
        String(row.modules).padStart(8) +
        String(row.raw).padStart(10) +
        String(row.gzip).padStart(10),
    )
  }
  console.log(
    '(gzip* is each package compressed on its own: the rows do not add up to the file gzip)',
  )
}

// What only Node.js has. Each pattern prints where it matched: the module that holds it.
const patterns: [label: string, pattern: RegExp][] = [
  ['node: specifier', /["'`]node:[a-z_/]+["'`]/g],
  ['require() call', /\brequire\s*\(/g],
  ['process global', /\bprocess\.(?:env|versions|platform|nextTick|cwd|argv|binding)/g],
  ['Buffer global', /\bBuffer\.(?:from|alloc|isBuffer|concat)|\bnew Buffer\b/g],
  ['eval()', /\beval\s*\(/g],
  ['indirect eval', /\(0,\s*eval\)\s*\(/g],
  ['new Function', /\bnew Function\s*\(|\bFunction\s*\(\s*["'`]/g],
  ['__dirname/__filename', /\b__(?:dirname|filename)\b/g],
]
console.log('\nscan for Node.js-only constructs:')
for (const [label, pattern] of patterns) {
  const hits = [...source.matchAll(pattern)]
  console.log(`- ${label}: ${hits.length}`)
  const seen = new Set<string>()
  for (const hit of hits) {
    const where = `${packageOf(regionAt(hit.index ?? 0))} :: ${regionAt(hit.index ?? 0).replace(/^.*node_modules\//, '')}`
    const line = source.slice(0, hit.index).split('\n').length
    const context = (source.split('\n')[line - 1] ?? '').trim().slice(0, 110)
    const key = `${where}|${context}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`    ${where}  (line ${line}) ${context}`)
  }
}
