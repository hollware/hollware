// Reads .bench/run-*.json and prints, per scenario, the run with the lowest median (as asked: three
// runs, lowest median) together with the other two medians, so the spread is visible.
import { readdirSync, readFileSync } from 'node:fs'

const files = readdirSync('.bench')
  .filter((f) => /^run-\d+\.json$/.test(f))
  .sort()
const runs = files.map((f) => JSON.parse(readFileSync(`.bench/${f}`, 'utf8')))
console.log(`${runs.length} runs: ${runs[0].node}, V8 ${runs[0].v8}, ${runs[0].platform}`)
for (const size of Object.keys(runs[0]).filter((k) => k.endsWith('words'))) {
  const first = runs[0][size]
  console.log(
    `\n== ${size}: ${first.words} whitespace words in the Markdown (${first.proseWords} prose words in the AST), ${first.markdownBytes} B Markdown, ${first.documentJsonBytes} B document JSON`,
  )
  console.log(
    'scenario'.padEnd(52),
    'median'.padStart(8),
    'p95'.padStart(8),
    'cpu/it'.padStart(8),
    '  medians of the 3 runs',
  )
  for (const name of Object.keys(first).filter((k) => typeof first[k] === 'object')) {
    const all = runs.map((r) => r[size][name])
    const best = all.reduce((a, b) => (a.medianMs <= b.medianMs ? a : b))
    console.log(
      name.padEnd(52),
      best.medianMs.toFixed(3).padStart(8),
      best.p95Ms.toFixed(3).padStart(8),
      best.meanCpuMs.toFixed(3).padStart(8),
      '  ',
      all.map((s) => s.medianMs.toFixed(3)).join(' / '),
      ` (n=${best.iterations})`,
    )
  }
}
