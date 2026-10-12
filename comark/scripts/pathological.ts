// Hostile or accidental input that makes the default parser expensive, and what removes the cost.
// Prints, per input size, the time of one parse (after one warm-up) in four configurations:
//   default      createMarkdownParser()                  comark's defaults (autoClose on)
//   autoClose:no createMarkdownParser({ autoClose: false })
//   safe         createSafeParser([...])                 src/safe.ts: autoClose off, no html, allow-list
//   exit alone   markdown-exit 1.1.0-beta.2 without Comark's own rules
//
//   node scripts/pathological.ts
import { createMarkdownParser } from 'comark'
import { createSafeParser } from '../src/safe.ts'

// markdown-exit is not a declared dependency of this app (only comark's), so this one-off
// investigation script imports it from the pnpm store by path.
const exitModule = await import(
  new URL(
    '../../../node_modules/.pnpm/markdown-exit@1.1.0-beta.2/node_modules/markdown-exit/dist/index.js',
    import.meta.url,
  ).href
)
const exit = new exitModule.default({ linkify: true })

const configurations: Array<[string, (markdown: string) => unknown]> = [
  ['default', createMarkdownParser()],
  ['autoClose:no', createMarkdownParser({ autoClose: false })],
  ['safe', createSafeParser(['callout', 'badge'])],
  ['exit alone', (markdown) => exit.parse(markdown, {})],
]

async function milliseconds(fn: () => unknown): Promise<string> {
  try {
    await fn() // warm-up
    const start = performance.now()
    await fn()
    return `${(performance.now() - start).toFixed(1)} ms`
  } catch (error) {
    return `THROWS ${error instanceof Error ? error.constructor.name : 'error'}`
  }
}

const families: Array<[string, number[], (n: number) => string]> = [
  [
    'nested blockquote: "> " x n + "x"',
    [500, 2000, 5000, 10000, 20000],
    (n) => '> '.repeat(n) + 'x',
  ],
  ['link references: "[a][b]" x n', [500, 1000, 2500, 5000, 10000], (n) => '[a][b]'.repeat(n)],
  ['open emphasis: "*a " x n', [1000, 5000, 10000, 50000], (n) => '*a '.repeat(n)],
]

for (const [title, sizes, make] of families) {
  console.log(`\n${title}`)
  console.log(
    'n'.padStart(7),
    'bytes'.padStart(8),
    ...configurations.map(([name]) => name.padStart(13)),
  )
  for (const n of sizes) {
    const markdown = make(n)
    const cells: string[] = []
    for (const [, parse] of configurations) {
      cells.push((await milliseconds(() => parse(markdown))).padStart(13))
    }
    console.log(String(n).padStart(7), String(markdown.length).padStart(8), ...cells)
  }
}
