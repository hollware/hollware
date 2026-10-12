// What the first request of a new isolate pays: parse and render in a FRESH Node process, before V8
// has warmed anything up. The warm medians of scripts/bench.ts are what a hot isolate pays.
//
//   node scripts/bench-cold.ts [--size 2000] [--processes 15]     driver: prints a summary
//   node scripts/bench-cold.ts --child --size 2000                one fresh process: prints JSON
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const index = args.indexOf(name)
  return index >= 0 ? (args[index + 1] ?? fallback) : fallback
}
const size = Number(flag('--size', '2000'))

if (args.includes('--child') && args.includes('--write-path')) {
  // The whole write path of one request, every stage cold: parse, extract, JSON.stringify, render.
  const { createMarkdownParser } = await import('comark')
  const { renderHtmlFromDocument } = await import('@comark/html')
  const { generatePost } = await import('../src/fixtures.ts')
  const { extract } = await import('../src/pipeline.ts')
  const { createSafeParser } = await import('../src/safe.ts')
  const markdown = generatePost(size)
  // --safe: the configuration proposed in src/safe.ts (no html plugin, allow-list, autoClose off).
  const parser = args.includes('--safe')
    ? createSafeParser(['callout', 'badge'])
    : createMarkdownParser()
  const stage = async <T>(fn: () => Promise<T> | T): Promise<[T, number]> => {
    const start = performance.now()
    const value = await fn()
    return [value, performance.now() - start]
  }
  const total = performance.now()
  const [document, parseMs] = await stage(() => parser(markdown))
  const [, extractMs] = await stage(() => extract(document))
  const [, stringifyMs] = await stage(() => JSON.stringify(document))
  const [, renderMs] = await stage(() => renderHtmlFromDocument(document))
  console.log(
    JSON.stringify({
      parseMs,
      extractMs,
      stringifyMs,
      renderMs,
      totalMs: performance.now() - total,
    }),
  )
} else if (args.includes('--child')) {
  const t0 = performance.now()
  const { createMarkdownParser } = await import('comark')
  const { renderHtmlFromDocument } = await import('@comark/html')
  const { generatePost } = await import('../src/fixtures.ts')
  const { extract } = await import('../src/pipeline.ts')
  const markdown = generatePost(size)
  const importMs = performance.now() - t0

  const timeIt = async <T>(fn: () => Promise<T> | T): Promise<[T, number, number]> => {
    const cpu = process.cpuUsage()
    const start = performance.now()
    const value = await fn()
    const wall = performance.now() - start
    const used = process.cpuUsage(cpu)
    return [value, wall, (used.user + used.system) / 1000]
  }

  const [parser, createMs] = await timeIt(() => createMarkdownParser())
  const parses: number[] = []
  const renders: number[] = []
  let first: { wall: number; cpu: number } | undefined
  let firstRender: { wall: number; cpu: number } | undefined
  let document = await parser('# warm\n') // not counted: tiny, but it pays some one-time costs
  for (let i = 0; i < 12; i++) {
    const [parsed, wall, cpu] = await timeIt(() => parser(markdown))
    document = parsed
    parses.push(wall)
    first ??= { wall, cpu }
  }
  for (let i = 0; i < 6; i++) {
    const [, wall, cpu] = await timeIt(() => renderHtmlFromDocument(document))
    renders.push(wall)
    firstRender ??= { wall, cpu }
  }
  const [, extractMs] = await timeIt(() => extract(document))
  console.log(
    JSON.stringify({ importMs, createMs, parses, renders, first, firstRender, extractMs }),
  )
} else if (args.includes('--write-path')) {
  const processes = Number(flag('--processes', '15'))
  const self = fileURLToPath(import.meta.url)
  const runs: Array<Record<string, number>> = []
  for (let i = 0; i < processes; i++) {
    const result = spawnSync(
      process.execPath,
      [
        self,
        '--child',
        '--write-path',
        '--size',
        String(size),
        ...(args.includes('--safe') ? ['--safe'] : []),
      ],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) throw new Error(result.stderr)
    runs.push(JSON.parse(result.stdout))
  }
  const stat = (key: string): string => {
    const sorted = runs.map((r) => r[key] ?? 0).sort((a, b) => a - b)
    return `median ${(sorted[Math.floor(sorted.length / 2)] ?? 0).toFixed(2).padStart(6)} ms   min ${(sorted[0] ?? 0).toFixed(2).padStart(6)}   max ${(sorted[sorted.length - 1] ?? 0).toFixed(2).padStart(6)}`
  }
  console.log(
    `${size} words, write path with every stage cold${args.includes('--safe') ? ' (safe config)' : ' (comark defaults)'}, ${processes} fresh processes (${process.version})`,
  )
  for (const key of ['parseMs', 'extractMs', 'stringifyMs', 'renderMs', 'totalMs']) {
    console.log(`${key.padEnd(14)} ${stat(key)}`)
  }
} else {
  const processes = Number(flag('--processes', '15'))
  const self = fileURLToPath(import.meta.url)
  const runs: Array<{
    importMs: number
    createMs: number
    parses: number[]
    renders: number[]
    first: { wall: number; cpu: number }
    firstRender: { wall: number; cpu: number }
    extractMs: number
  }> = []
  for (let i = 0; i < processes; i++) {
    const result = spawnSync(process.execPath, [self, '--child', '--size', String(size)], {
      encoding: 'utf8',
    })
    if (result.status !== 0) throw new Error(result.stderr)
    runs.push(JSON.parse(result.stdout))
  }
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
  }
  const row = (label: string, values: number[]): void => {
    const sorted = [...values].sort((a, b) => a - b)
    console.log(
      `${label.padEnd(44)} median ${median(values).toFixed(2).padStart(6)} ms   min ${(sorted[0] ?? 0).toFixed(2).padStart(6)}   max ${(sorted[sorted.length - 1] ?? 0).toFixed(2).padStart(6)}`,
    )
  }
  console.log(`${size} words, ${processes} fresh processes (${process.version})`)
  row(
    'import comark + @comark/html + fixtures',
    runs.map((r) => r.importMs),
  )
  row(
    'createMarkdownParser()',
    runs.map((r) => r.createMs),
  )
  row(
    'parse #1 (first call, cold JIT) wall',
    runs.map((r) => r.parses[0] ?? 0),
  )
  row(
    'parse #1 process CPU (user+sys)',
    runs.map((r) => r.first.cpu),
  )
  row(
    'parse #2',
    runs.map((r) => r.parses[1] ?? 0),
  )
  row(
    'parse #3',
    runs.map((r) => r.parses[2] ?? 0),
  )
  row(
    'parse #5',
    runs.map((r) => r.parses[4] ?? 0),
  )
  row(
    'parse #12',
    runs.map((r) => r.parses[11] ?? 0),
  )
  row(
    'render #1 (first call) wall',
    runs.map((r) => r.renders[0] ?? 0),
  )
  row(
    'render #1 process CPU (user+sys)',
    runs.map((r) => r.firstRender.cpu),
  )
  row(
    'render #6',
    runs.map((r) => r.renders[5] ?? 0),
  )
  row(
    'parse #1 + render #1 (first request)',
    runs.map((r) => (r.parses[0] ?? 0) + (r.renders[0] ?? 0)),
  )
  row(
    'extract (after parses and renders)',
    runs.map((r) => r.extractMs),
  )
}
