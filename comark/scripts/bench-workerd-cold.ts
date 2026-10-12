// Wall time, seen from Node, of the first requests to a FRESH workerd isolate versus later ones.
// Timings inside workerd are frozen during synchronous work, so this is the only way to see the cold
// penalty there. It includes the harness proxy hop (a constant of about 1 ms), so read the DIFFERENCE
// between request #1 and the later requests, not the absolute numbers.
//
//   node scripts/bench-workerd-cold.ts [--size 2000] [--instances 10] [--config dist/default/hollware_spike_comark/wrangler.json]
import { fileURLToPath } from 'node:url'
import { createTestHarness } from 'wrangler'
import { generatePost } from '../src/fixtures.ts'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const index = args.indexOf(name)
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback
}
const size = Number(flag('--size', '2000'))
const instances = Number(flag('--instances', '10'))
const config = flag('--config', 'dist/default/hollware_spike_comark/wrangler.json')
const root = fileURLToPath(new URL('../', import.meta.url))
const body = generatePost(size)
const checkpoints = [1, 2, 3, 5, 10, 30, 100]

const perCheckpoint = new Map<number, number[]>(checkpoints.map((n) => [n, []]))
for (let i = 0; i < instances; i++) {
  const server = createTestHarness({ root, workers: [{ configPath: `${root}${config}` }] })
  await server.listen()
  try {
    for (let n = 1; n <= 100; n++) {
      const start = performance.now()
      const response = await server.fetch('/process', { method: 'POST', body })
      await response.arrayBuffer()
      const elapsed = performance.now() - start
      if (response.status !== 200) throw new Error(`status ${response.status}`)
      perCheckpoint.get(n)?.push(elapsed)
    }
  } finally {
    await server.close()
  }
}
const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}
console.log(`${size} words, ${instances} fresh workerd instances, ${config}`)
for (const n of checkpoints) {
  const values = perCheckpoint.get(n) ?? []
  console.log(
    `request #${String(n).padEnd(3)} median ${median(values).toFixed(2).padStart(7)} ms   min ${Math.min(
      ...values,
    )
      .toFixed(2)
      .padStart(7)}   max ${Math.max(...values)
      .toFixed(2)
      .padStart(7)}`,
  )
}
