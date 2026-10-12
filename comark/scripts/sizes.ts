// Raw, gzip (level 9) and brotli (quality 11) bytes of every built Worker module under dist/.
//   node scripts/sizes.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

for (const variant of readdirSync('dist').sort()) {
  const directory = join('dist', variant)
  for (const worker of readdirSync(directory)) {
    const file = join(directory, worker, 'index.js')
    if (!statSync(join(directory, worker)).isDirectory()) continue
    const source = readFileSync(file)
    const brotli = brotliCompressSync(source, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length
    console.log(
      `${file.padEnd(62)} raw ${String(source.length).padStart(7)} B  gzip ${String(gzipSync(source, { level: 9 }).length).padStart(7)} B  brotli ${String(brotli).padStart(7)} B`,
    )
  }
}
