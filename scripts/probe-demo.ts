import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const LIMIT_MS = 60_000
const POLL_MS = 500

export function verdict(times: readonly (number | null)[]): { ok: boolean; lines: string[] } {
  const lines = times.map((time, index) =>
    time === null
      ? `run ${index + 1}: not live within ${LIMIT_MS / 1000} s`
      : `run ${index + 1}: live in ${(time / 1000).toFixed(1)} s`,
  )
  const ok = times.length > 0 && times.every((time) => time !== null && time < LIMIT_MS)
  lines.push(ok ? `OK: every run was live in under ${LIMIT_MS / 1000} s` : 'FAILED')
  return { ok, lines }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function call(
  hollware: string,
  token: string,
  tool: string,
  args: object,
): Promise<Record<string, unknown>> {
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
          'io.modelcontextprotocol/clientInfo': { name: 'probe-demo', version: '0.2.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  })
  const message: unknown = await response.json()
  const result = isRecord(message) ? message['result'] : undefined
  const structured = isRecord(result) ? result['structuredContent'] : undefined
  const content = isRecord(result) ? result['content'] : undefined
  const text = Array.isArray(content) && isRecord(content[0]) ? content[0]['text'] : undefined
  const output: unknown = isRecord(structured)
    ? structured
    : typeof text === 'string'
      ? JSON.parse(text)
      : undefined
  if (!isRecord(output))
    throw new Error(`${tool} answered ${response.status}: ${JSON.stringify(message)}`)
  return output
}

async function run(hollware: string, site: string, token: string): Promise<number | null> {
  const slug = `probe-${Date.now().toString(36)}`
  const markdown = `---\ntitle: Probe ${slug}\ndescription: A post the v0.2 probe publishes and takes down.\ndate: 2026-10-14\ntags:\n  - probe\ntranslationGroup: ${slug}\n---\n\nPublished by scripts/probe-demo.ts.\n`
  const created = await call(hollware, token, 'create_draft', {
    collection: 'blog',
    locale: 'en',
    slug,
    markdown,
  })
  const entry = created['entry']
  if (!isRecord(entry) || typeof entry['id'] !== 'string') throw new Error(JSON.stringify(created))
  const id = entry['id']
  const published = await call(hollware, token, 'publish', {
    id,
    version: entry['version'],
    acknowledgeWarnings: [{ contract: 'translation-pair', path: '/frontmatter/translationGroup' }],
  })
  if (published['outcome'] !== 'published') throw new Error(JSON.stringify(published))
  const started = performance.now()
  let live: number | null = null
  while (performance.now() - started < LIMIT_MS) {
    const page = await fetch(`${site}/en/blog/${slug}/`, {
      headers: { 'cache-control': 'no-cache' },
    })
    if (page.status === 200) {
      live = performance.now() - started
      break
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  await call(hollware, token, 'unpublish', { id })
  return live
}

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      hollware: { type: 'string' },
      site: { type: 'string' },
      'token-file': { type: 'string' },
      runs: { type: 'string', default: '5' },
    },
  })
  const hollware = values.hollware?.replace(/\/+$/, '')
  const site = values.site?.replace(/\/+$/, '')
  const tokenFile = values['token-file']
  if (hollware === undefined || site === undefined || tokenFile === undefined) {
    console.error(
      'Usage: node scripts/probe-demo.ts --hollware <url> --site <url> --token-file <file> [--runs 5]',
    )
    return 2
  }
  const token = readFileSync(tokenFile, 'utf8').trim()
  const times: (number | null)[] = []
  for (let index = 0; index < Number(values.runs); index++)
    times.push(await run(hollware, site, token))
  const { ok, lines } = verdict(times)
  for (const line of lines) console.log(line)
  return ok ? 0 : 1
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(invoked).href === import.meta.url) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
