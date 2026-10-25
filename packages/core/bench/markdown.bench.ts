import { expect, test } from 'vite-plus/test'

import { contentFixture } from '../../../tests/fixtures/content.ts'
import { canonicalMarkdown, formatMarkdown } from '../src/markdown/format.ts'

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

test('formatMarkdown writes the 2,027-word post within the budget, warm, in the style it was not written in', async ({
  bench,
}) => {
  if (navigator.userAgent === 'Cloudflare-Workers') {
    console.log('skipped: workerd has no clock to measure a millisecond with')
    return
  }
  const post = contentFixture('bench/long-post.md')
  const first = await formatMarkdown(post, OPTIONS)
  expect(first.processed.ok ? first.processed.value.extracted.words : -1).toBe(2027)
  expect(first.markdown).not.toBe(post)
  expect(await canonicalMarkdown(first.markdown)).toBe(first.markdown)

  const cpu: number[] = []
  const wall: number[] = []
  let measuring = false
  await bench(
    'formatMarkdown(long-post.md)',
    {
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
      await formatMarkdown(post, OPTIONS)
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
    `formatMarkdown(long-post.md), ${cpu.length} calls\n` +
      `  CPU time   p50 ${ms(cpu, 0.5)} ms, p95 ${ms(cpu, 0.95)} ms, p99 ${ms(cpu, 0.99)} ms (budget: p95 <= ${BUDGET_P95_MS} ms)\n` +
      `  wall clock p50 ${ms(wall, 0.5)} ms, p95 ${ms(wall, 0.95)} ms, p99 ${ms(wall, 0.99)} ms`,
  )
  expect(cpu.length).toBeGreaterThanOrEqual(2000)
  expect(quantile(cpu, 0.95)).toBeLessThanOrEqual(BUDGET_P95_MS)
})
