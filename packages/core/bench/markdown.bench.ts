import { expect, test } from 'vite-plus/test'

import { contentFixture } from '../../../tests/fixtures/content.ts'
import { processMarkdown } from '../src/markdown/process.ts'

/**
 * The cost of one write, as far as the Markdown pipeline is concerned: `processMarkdown` on the
 * post of the benchmark, which has 2,027 words, headings, lists, links, code and a component, once
 * Comark is loaded and the engine has warmed up. The plan's budget is a p95 of 3 ms per write in
 * CI; Cloudflare's Free plan gives a Worker 10 ms of CPU, and the write has the rest to do.
 *
 * The budget is of CPU time, which is what a Worker is limited by, and it is read from the
 * process (`process.cpuUsage`), so that a machine that is busy with something else does not
 * decide it: the wall clock of a call on a busy machine includes the time the call waited. The
 * wall clock is printed too, for whoever wants it.
 *
 * It runs in Node only: workerd gives a script a clock that moves in steps of a millisecond.
 *
 *   vp test bench --project '@hollware/core (bench)' packages/core/bench/markdown.bench.ts
 *
 * Vitest prints its own table (wall clock: mean, p75, p99), and the test prints the p50, p95 and
 * p99 of the CPU time of each call, and fails when the p95 is over the budget.
 */
const BUDGET_P95_MS = 3

const OPTIONS = {
  components: ['callout', 'youtube'],
  maxMarkdownBytes: 512 * 1024,
  routes: { blog: { es: '/blog/:slug/', en: '/en/blog/:slug/' } },
}

function quantile(samples: readonly number[], q: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.ceil(q * sorted.length) - 1] ?? Number.NaN
}

test('processMarkdown writes the 2,027-word post within the budget, warm', async ({ bench }) => {
  if (navigator.userAgent === 'Cloudflare-Workers') {
    console.log('skipped: workerd has no clock to measure a millisecond with')
    return
  }
  const post = contentFixture('bench/long-post.md')
  // The first call loads Comark: that is the cold start, which this does not measure.
  const first = await processMarkdown(post, OPTIONS)
  expect(first.ok ? first.value.extracted.words : -1).toBe(2027)

  const cpu: number[] = []
  const wall: number[] = []
  let measuring = false
  await bench(
    'processMarkdown(long-post.md)',
    {
      // The hooks run for the warm-up and for the measured run: only the second counts.
      beforeAll: (mode) => {
        measuring = mode === 'run'
        if (measuring) {
          cpu.length = 0
          wall.length = 0
        }
      },
    },
    async () => {
      const usage = process.cpuUsage()
      const start = performance.now()
      await processMarkdown(post, OPTIONS)
      const elapsed = performance.now() - start
      const used = process.cpuUsage(usage)
      if (measuring) {
        wall.push(elapsed)
        cpu.push((used.user + used.system) / 1000)
      }
    },
  ).run({ warmupTime: 500, warmupIterations: 300, time: 3000, iterations: 2000 })

  const ms = (samples: readonly number[], q: number) => quantile(samples, q).toFixed(3)
  console.log(
    `processMarkdown(long-post.md), ${cpu.length} calls\n` +
      `  CPU time   p50 ${ms(cpu, 0.5)} ms, p95 ${ms(cpu, 0.95)} ms, p99 ${ms(cpu, 0.99)} ms (budget: p95 <= ${BUDGET_P95_MS} ms)\n` +
      `  wall clock p50 ${ms(wall, 0.5)} ms, p95 ${ms(wall, 0.95)} ms, p99 ${ms(wall, 0.99)} ms`,
  )
  expect(cpu.length).toBeGreaterThanOrEqual(2000)
  expect(quantile(cpu, 0.95)).toBeLessThanOrEqual(BUDGET_P95_MS)
})
