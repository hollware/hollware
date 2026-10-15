/**
 * The search evaluation of v0.5 (AC-0.5-2): how well `search` finds what it should, by mode.
 *
 *   node scripts/eval-search.ts --hollware <url> --token-file <file> [--seed] [--gate hybrid]
 *
 * With `--seed` it first writes the corpus of tests/fixtures/eval/corpus to the site of the token
 * (the playground's blog) over MCP (both locales of a group as drafts, then each published; an entry already there is
 * left as it is) and waits until semantic search finds each entry by its title. Then it asks every
 * labelled query of tests/fixtures/eval/queries.json in each mode, over the read API, with a limit
 * of five, and prints recall@5 by kind of query and the p95 of the time each answer took on the
 * server (its Server-Timing), and with the network. It exits
 * 1 when the gated mode is under 0.85 within a language, under 0.70 across languages, or over
 * 400 ms at p95.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const EVAL = join(import.meta.dirname, '../tests/fixtures/eval')
const LIMIT = 5
const MODES = ['fulltext', 'semantic', 'hybrid'] as const
type Mode = (typeof MODES)[number]

export const GATES = { sameLanguage: 0.85, crossLanguage: 0.7, p95Ms: 400 } as const

export interface Query {
  readonly query: string
  readonly locale: string
  readonly expect: string
  readonly kind: 'same-language' | 'cross-language'
}

/** One query asked in one mode: where its expected entry came, or `null`, and how long it took. */
export interface Run {
  readonly kind: Query['kind']
  readonly place: number | null
  readonly ms: number
}

/** The 95th percentile of a list of times, nearest rank. */
export function p95(times: readonly number[]): number {
  if (times.length === 0) return 0
  const sorted = [...times].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0
}

/** The share of runs of a kind whose expected entry is among the first `within` (five by default). */
export function recall(runs: readonly Run[], kind: Query['kind'], within: number = LIMIT): number {
  const ofKind = runs.filter((run) => run.kind === kind)
  if (ofKind.length === 0) return 0
  return ofKind.filter((run) => run.place !== null && run.place < within).length / ofKind.length
}

/** Whether a mode's runs meet the gates, and the line that says so. */
export function judge(mode: string, runs: readonly Run[]): { ok: boolean; line: string } {
  const same = recall(runs, 'same-language')
  const cross = recall(runs, 'cross-language')
  const slow = p95(runs.map((run) => run.ms))
  const ok = same >= GATES.sameLanguage && cross >= GATES.crossLanguage && slow <= GATES.p95Ms
  return {
    ok,
    // recall@1 tells models apart where recall@5 does not; it is no gate.
    line: `${mode.padEnd(8)} recall@5 same ${same.toFixed(2)}  cross ${cross.toFixed(2)}  recall@1 same ${recall(runs, 'same-language', 1).toFixed(2)}  cross ${recall(runs, 'cross-language', 1).toFixed(2)}  p95 ${Math.round(slow)} ms`,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function callTool(hollware: string, token: string, tool: string, args: object) {
  const response = await fetch(`${hollware}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': 'tools/call',
      'mcp-name': tool,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: tool,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientInfo': { name: 'eval-search', version: '0.5.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
  const text = await response.text()
  // An SSE answer carries the message on its data line.
  const json = text.startsWith('{') ? text : (/^data: (.*)$/m.exec(text)?.[1] ?? '{}')
  const message: unknown = JSON.parse(json)
  const result = isRecord(message) ? message['result'] : undefined
  const output = isRecord(result) ? result['structuredContent'] : undefined
  if (!isRecord(output))
    throw new Error(`${tool} answered ${response.status}: ${text.slice(0, 300)}`)
  return output
}

interface Post {
  readonly locale: string
  readonly slug: string
  readonly title: string
  readonly markdown: string
}

function corpus(): Post[] {
  return ['en', 'es'].flatMap((locale) =>
    readdirSync(join(EVAL, 'corpus', locale)).map((file) => {
      const markdown = readFileSync(join(EVAL, 'corpus', locale, file), 'utf8')
      const title = /^title: (.*)$/m.exec(markdown)?.[1] ?? file
      return { locale, slug: file.replace(/\.md$/, ''), title, markdown }
    }),
  )
}

async function seed(hollware: string, token: string): Promise<void> {
  const posts = corpus()
  const ids: string[] = []
  for (const post of posts) {
    const found = await callTool(hollware, token, 'get_entry', {
      collection: 'blog',
      locale: post.locale,
      slug: post.slug,
    })
    if (found['outcome'] === 'ok') continue
    const created = await callTool(hollware, token, 'create_draft', {
      collection: 'blog',
      locale: post.locale,
      slug: post.slug,
      markdown: post.markdown,
    })
    const entry = created['entry']
    if (!isRecord(entry) || typeof entry['id'] !== 'string') {
      throw new Error(`${post.slug} was not saved: ${JSON.stringify(created)}`)
    }
    ids.push(entry['id'])
  }
  for (const id of ids) {
    const published = await callTool(hollware, token, 'publish', { id, version: 1 })
    if (published['outcome'] !== 'published') {
      throw new Error(`${id} was not published: ${JSON.stringify(published)}`)
    }
  }
  process.stdout.write(`seeded ${ids.length} entries (${posts.length - ids.length} were there)\n`)
  const deadline = Date.now() + 5 * 60_000
  for (const post of posts) {
    for (;;) {
      const { slugs } = await ask(hollware, token, post.title, post.locale, 'semantic')
      if (slugs.includes(post.slug)) break
      if (Date.now() > deadline) throw new Error(`semantic search never found ${post.slug}`)
      await new Promise((resolve) => setTimeout(resolve, 3000))
    }
  }
  process.stdout.write('every entry is found by meaning\n')
}

async function ask(hollware: string, token: string, q: string, locale: string, mode: Mode) {
  const url = new URL(`${hollware}/v1/search`)
  url.search = new URLSearchParams({ q, locale, mode, limit: String(LIMIT) }).toString()
  const started = performance.now()
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
  const body: unknown = await response.json()
  const total = performance.now() - started
  if (!response.ok || !isRecord(body)) throw new Error(`search answered ${response.status}`)
  // The server's own time, without the network: what the gate is about.
  const timing = /read;dur=(\d+)/.exec(response.headers.get('server-timing') ?? '')?.[1]
  const ms = timing === undefined ? total : Number(timing)
  const results = Array.isArray(body['results']) ? body['results'] : []
  const slugs = results.flatMap((result: unknown) =>
    isRecord(result) && isRecord(result['entry']) && typeof result['entry']['slug'] === 'string'
      ? [result['entry']['slug']]
      : [],
  )
  return { slugs, ms, total, mode: body['mode'] }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      hollware: { type: 'string' },
      'token-file': { type: 'string' },
      seed: { type: 'boolean', default: false },
      gate: { type: 'string', default: 'hybrid' },
    },
  })
  const hollware = values.hollware?.replace(/\/+$/, '')
  if (hollware === undefined || values['token-file'] === undefined) {
    throw new Error('Pass --hollware <url> and --token-file <file>')
  }
  const token = readFileSync(values['token-file'], 'utf8').trim()
  if (values.seed) await seed(hollware, token)
  const queries: Query[] = JSON.parse(readFileSync(join(EVAL, 'queries.json'), 'utf8')).queries
  // The slug that each group has in each locale.
  const slugOf = new Map(
    corpus().map((post) => {
      const group = /^translationGroup: (.*)$/m.exec(post.markdown)?.[1] ?? ''
      return [`${group}/${post.locale}`, post.slug]
    }),
  )
  let gated: { ok: boolean } = { ok: false }
  for (const mode of MODES) {
    const runs: Run[] = []
    const totals: number[] = []
    const misses: string[] = []
    for (const query of queries) {
      const answer = await ask(hollware, token, query.query, query.locale, mode)
      if (answer.mode !== mode)
        throw new Error(`asked ${mode} and the search was ${String(answer.mode)}`)
      const expected = slugOf.get(`${query.expect}/${query.locale}`)
      const place = expected === undefined ? -1 : answer.slugs.indexOf(expected)
      runs.push({ kind: query.kind, place: place < 0 ? null : place, ms: answer.ms })
      totals.push(answer.total)
      if (place < 0) misses.push(`  missed (${query.kind}): ${query.query} → ${expected ?? '?'}`)
    }
    const verdict = judge(mode, runs)
    process.stdout.write(
      `${verdict.line} (server; ${Math.round(p95(totals))} ms with the network)\n${mode === values.gate ? misses.join('\n') + '\n' : ''}`,
    )
    if (mode === values.gate) gated = verdict
  }
  process.stdout.write(
    gated.ok ? `OK: ${values.gate} meets the gates\n` : `FAILED: ${values.gate}\n`,
  )
  if (!gated.ok) process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error: unknown) => {
    process.stderr.write(`eval-search: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
