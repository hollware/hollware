// S3f: every import of a Node.js built-in anywhere in the installed dependency closure of
// comark + @comark/html, and whether that file ended up in the Worker bundle.
//   node scripts/scan-node-usage.ts [bundle.js]
import { readFileSync } from 'node:fs'
import { closureOf, findNodeImports } from '../test/node/support/closure.ts'

const bundle = readFileSync(
  process.argv[2] ?? 'dist/default/hollware_spike_comark/index.js',
  'utf8',
)
// rolldown writes one `//#region <path>` marker per bundled module.
const regions = [...bundle.matchAll(/^\/\/#region (.+)$/gm)].map((match) => match[1] ?? '')
const closure = closureOf(new URL('../', import.meta.url).pathname, ['comark', '@comark/html'])
console.log(`closure (${closure.size} packages): ${[...closure.keys()].sort().join(', ')}`)

const hits = findNodeImports(closure)
for (const hit of hits) {
  const [id = '', path = ''] = hit.file.split(':')
  const name = id.slice(0, id.lastIndexOf('@'))
  const inBundle = regions.some((region) => region.endsWith(`${name}/${path}`))
  console.log(
    `${hit.file}  imports ${hit.builtins.join(', ')}  -> in the Worker bundle: ${inBundle ? 'YES' : 'no'}`,
  )
}
console.log(`${regions.length} modules in the bundle`)
console.log(
  hits.length === 0
    ? 'no file imports a Node.js built-in'
    : `${hits.length} file(s) import a Node.js built-in`,
)
