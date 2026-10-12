// CPU benchmark of the pipeline in Node 24 (same V8 family as workerd). Timings taken inside workerd
// are meaningless: Date.now() and performance.now() do not advance during synchronous work there.
//
//   node scripts/bench.ts                 all scenarios, 2,000 and 10,000 words, JSON on stdout
//   node scripts/bench.ts --size 2000     one size
//
// Per scenario: warm-up iterations first, then N timed iterations; reports median and p95 of the
// wall time per iteration (performance.now) and the mean CPU time per iteration
// (process.cpuUsage, user + system) of the whole timed loop.
import { createMarkdownParser, parseMarkdown } from 'comark'
import { createHtmlRenderer, renderHtml, renderHtmlFromDocument } from '@comark/html'
import type { MarkdownDocument } from 'comark'
import { countWords, generatePost } from '../src/fixtures.ts'
import { extract } from '../src/pipeline.ts'
import { createSafeParser } from '../src/safe.ts'

interface Stats {
  medianMs: number
  p95Ms: number
  minMs: number
  meanCpuMs: number
  iterations: number
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, index)] ?? Number.NaN
}

async function measure(fn: () => unknown, warmup: number, iterations: number): Promise<Stats> {
  for (let i = 0; i < warmup; i++) await fn()
  const samples: number[] = []
  const cpuStart = process.cpuUsage()
  for (let i = 0; i < iterations; i++) {
    const start = performance.now()
    await fn()
    samples.push(performance.now() - start)
  }
  const cpu = process.cpuUsage(cpuStart)
  samples.sort((a, b) => a - b)
  return {
    medianMs: percentile(samples, 50),
    p95Ms: percentile(samples, 95),
    minMs: samples[0] ?? Number.NaN,
    meanCpuMs: (cpu.user + cpu.system) / 1000 / iterations,
    iterations,
  }
}

const args = process.argv.slice(2)
const sizeFlag = args.indexOf('--size')
const sizes = sizeFlag >= 0 ? [Number(args[sizeFlag + 1])] : [2000, 10000]

const parser = createMarkdownParser()
const renderer = createHtmlRenderer()
const parserNoAutoClose = createMarkdownParser({ autoClose: false })
const safeParser = createSafeParser(['callout', 'badge'])
const results: Record<string, unknown> = {
  node: process.version,
  v8: process.versions.v8,
  platform: `${process.platform}-${process.arch}`,
}

for (const target of sizes) {
  const markdown = generatePost(target)
  const document: MarkdownDocument = await parser(markdown)
  const json = JSON.stringify(document)
  const warmup = target >= 10000 ? 150 : 400
  const iterations = target >= 10000 ? 300 : 1000

  const scenarios: Array<[string, () => unknown]> = [
    ['parse, new parser per call (parseMarkdown)', () => parseMarkdown(markdown)],
    ['parse, parser reused', () => parser(markdown)],
    ['parse, parser reused, autoClose: false', () => parserNoAutoClose(markdown)],
    ['parse, safe config (no html, allow-list, autoClose: false)', () => safeParser(markdown)],
    ['parse + render, safe config', async () => renderHtmlFromDocument(await safeParser(markdown))],
    ['render only (renderHtmlFromDocument)', () => renderHtmlFromDocument(document)],
    ['parse + render, parser reused', async () => renderHtmlFromDocument(await parser(markdown))],
    ['parse + render, new parser per call (renderHtml)', () => renderHtml(markdown)],
    ['parse + render, createHtmlRenderer reused', () => renderer(markdown)],
    ['extract (headings, links, images, components)', () => extract(document)],
    ['JSON.stringify(document)', () => JSON.stringify(document)],
    ['JSON.parse(stored document)', () => JSON.parse(json)],
    [
      'render from stored JSON (parse JSON + render)',
      () => renderHtmlFromDocument(JSON.parse(json)),
    ],
    [
      'write path: parse + extract + stringify',
      async () => {
        const parsed = await parser(markdown)
        extract(parsed)
        return JSON.stringify(parsed)
      },
    ],
    [
      'write path + render HTML',
      async () => {
        const parsed = await parser(markdown)
        extract(parsed)
        JSON.stringify(parsed)
        return renderHtmlFromDocument(parsed)
      },
    ],
  ]

  const bySize: Record<string, unknown> = {
    words: countWords(markdown),
    proseWords: extract(document).words,
    markdownBytes: Buffer.byteLength(markdown),
    documentJsonBytes: Buffer.byteLength(json),
  }
  for (const [name, fn] of scenarios) {
    bySize[name] = await measure(fn, warmup, iterations)
  }
  results[`${target} words`] = bySize
}

console.log(JSON.stringify(results, null, 2))
