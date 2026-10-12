// Lowest median across three runs per scenario (other processes load this machine), with the p95 of
// that same run. Reads bench/results/cpu-<set>-run{1,2,3}.json.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const set of ['workerd', 'nodedefault']) {
  const runs = [1, 2, 3].map((n) =>
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, `results/cpu-${set}-run${n}.json`), 'utf8'),
    ),
  )
  console.log(`\n## ${set}: ${runs[0].header}`)
  console.log(
    `${'scenario'.padEnd(88)} ${'median'.padStart(9)} ${'p95'.padStart(9)}   (µs, lowest median of 3 runs; all medians)`,
  )
  for (const row of runs[0].results) {
    const candidates = runs.map((run) => run.results.find((r) => r.name === row.name))
    const best = candidates.reduce((a, b) => (b.medianUs < a.medianUs ? b : a))
    const medians = candidates.map((c) => c.medianUs.toFixed(1)).join(' / ')
    console.log(
      `${row.name.padEnd(88)} ${best.medianUs.toFixed(1).padStart(9)} ${best.p95Us.toFixed(1).padStart(9)}   (${medians})`,
    )
  }
}
