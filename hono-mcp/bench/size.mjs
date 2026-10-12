// Prints the raw and gzip size of the files given as arguments.
import { readFileSync } from 'node:fs'
import { gzipSync, brotliCompressSync } from 'node:zlib'

for (const file of process.argv.slice(2)) {
  const raw = readFileSync(file)
  const gzip6 = gzipSync(raw, { level: 6 }).length
  const gzip9 = gzipSync(raw, { level: 9 }).length
  const brotli = brotliCompressSync(raw).length
  console.log(
    `${file}\n  raw=${raw.length} B (${(raw.length / 1024).toFixed(2)} KiB)  gzip-6=${gzip6} B (${(gzip6 / 1024).toFixed(2)} KiB)  gzip-9=${gzip9} B  brotli=${brotli} B`,
  )
}
