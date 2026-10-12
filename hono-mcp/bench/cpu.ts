// S2e: CPU cost, in Node 24 (same V8 family as workerd), of what a per-request MCP server does.
//
// Why Node and not a workerd test: inside workerd Date.now() and performance.now() do not advance
// during synchronous work (Spectre mitigation), so timings taken there are meaningless.
//
// Run:  node --conditions=workerd bench/cpu.ts [label]
//   --conditions=workerd makes `@modelcontextprotocol/server/_shims` resolve to the workerd shim, the
//   one the Worker bundle gets: the @cfworker/json-schema validator as default (Ajv is the Node
//   default and its constructor is far heavier) plus preloadSchemas() at import.
//   z.config({ jitless: true }) reproduces workerd for Zod: Zod 4 skips its `new Function` fast path
//   there (allowsEval() is false when navigator.userAgent contains "Cloudflare").
//
// Without --conditions=workerd the numbers describe Node's defaults, not the Worker. Both are printed
// by `bench/run-cpu.sh`.
import { McpServer, createMcpHandler, fromJsonSchema } from '@modelcontextprotocol/server'
import type {
  JsonSchemaType,
  McpServerFactory,
  StandardSchemaWithJSON,
} from '@modelcontextprotocol/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as z from 'zod'
import { buildPrecomputedServer, createPrecomputedWrappers } from '../src/mcp/server-precomputed.ts'
import { memoizeSchemas } from '../src/mcp/memoize.ts'
import { buildMemoizedServer } from '../src/mcp/server-memoized.ts'
import { SERVER_INFO, buildServer } from '../src/mcp/server.ts'
import { SCHEMAS, createSchemas } from '../src/mcp/schemas.ts'

z.config({ jitless: true })

const label = process.argv[2] ?? 'run'
const ENVELOPE = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'bench', version: '0.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
}

function modernRequest(method: string, params: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2026-07-28',
      'mcp-method': method,
      ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: { ...params, _meta: ENVELOPE } }),
  })
}

function legacyRequest(method: string, params: Record<string, unknown> = {}): Request {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
}

type Stats = {
  name: string
  iterations: number
  medianUs: number
  p95Us: number
  meanUs: number
  minUs: number
  cpuPerIterationUs: number
}

const results: Stats[] = []

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[index] ?? Number.NaN
}

async function measure(
  name: string,
  iterations: number,
  prepare: () => unknown,
  run: (prepared: never) => unknown,
): Promise<void> {
  const warmup = Math.max(200, Math.floor(iterations / 5))
  for (let i = 0; i < warmup; i++) await run(prepare() as never)
  globalThis.gc?.()

  const timings: number[] = []
  const cpuBefore = process.cpuUsage()
  for (let i = 0; i < iterations; i++) {
    const prepared = prepare()
    const start = process.hrtime.bigint()
    await run(prepared as never)
    timings.push(Number(process.hrtime.bigint() - start) / 1000)
  }
  const cpu = process.cpuUsage(cpuBefore)
  timings.sort((a, b) => a - b)
  const sum = timings.reduce((a, b) => a + b, 0)
  results.push({
    name,
    iterations,
    medianUs: percentile(timings, 50),
    p95Us: percentile(timings, 95),
    meanUs: sum / timings.length,
    minUs: timings[0] ?? Number.NaN,
    cpuPerIterationUs: (cpu.user + cpu.system) / iterations,
  })
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`sanity check failed: ${message}`)
}

// Sanity: every scenario must serve a successful answer, or the numbers measure an error path.
async function expectOk(
  handler: { fetch: (request: Request) => Promise<Response> },
  request: () => Request,
  needle: string,
) {
  const response = await handler.fetch(request())
  const text = await response.text()
  assert(
    response.status === 200 && text.includes(needle),
    `${needle} not in ${response.status} ${text.slice(0, 120)}`,
  )
}

const N_FAST = 20_000
const N_E2E = 6_000

const zodHandler = createMcpHandler(buildServer)
const memoizedHandler = createMcpHandler(buildMemoizedServer)
const precomputedHandler = createMcpHandler(buildPrecomputedServer)
const precomputedPerRequestWrappers = createMcpHandler((context) =>
  buildPrecomputedServer(context, createPrecomputedWrappers()),
)
const freshSchemasHandler = createMcpHandler((context) => buildServer(context, createSchemas()))

await expectOk(zodHandler, () => modernRequest('tools/list'), '"echo"')
await expectOk(
  zodHandler,
  () => modernRequest('tools/call', { name: 'echo', arguments: { message: 'hi' } }),
  'echoed',
)
await expectOk(memoizedHandler, () => modernRequest('tools/list'), '"echo"')
await expectOk(
  memoizedHandler,
  () => modernRequest('tools/call', { name: 'echo', arguments: { message: 'hi' } }),
  'echoed',
)
await expectOk(precomputedHandler, () => modernRequest('tools/list'), '"echo"')
await expectOk(
  precomputedHandler,
  () => modernRequest('tools/call', { name: 'echo', arguments: { message: 'hi' } }),
  'echoed',
)

const conversionTargets = [
  ['echoInput', 'input'],
  ['echoOutput', 'output'],
  ['createNoteInput', 'input'],
  ['createNoteOutput', 'output'],
  ['alwaysFailsInput', 'input'],
  ['alwaysFailsOutput', 'output'],
] as const

// --- building a server -------------------------------------------------------------------------
await measure(
  'build McpServer + 3 tools (Zod schemas at module scope)',
  N_FAST,
  () => 0,
  () => buildServer(),
)
await measure(
  'build McpServer + 3 tools (Zod schemas rebuilt per request)',
  N_FAST,
  () => 0,
  () => buildServer(undefined, createSchemas()),
)
await measure(
  'build McpServer + 3 tools (precomputed, wrappers at module scope)',
  N_FAST,
  () => 0,
  () => buildPrecomputedServer(),
)
await measure(
  'build McpServer + 3 tools (precomputed, fromJsonSchema per request)',
  N_FAST,
  () => 0,
  () => buildPrecomputedServer(undefined, createPrecomputedWrappers()),
)
await measure(
  'McpServer constructor alone (no tools)',
  N_FAST,
  () => 0,
  () => new McpServer(SERVER_INFO),
)
await measure(
  'createSchemas() alone (6 Zod objects)',
  N_FAST,
  () => 0,
  () => createSchemas(),
)
await measure(
  'createPrecomputedWrappers() alone (6 fromJsonSchema)',
  N_FAST,
  () => 0,
  () => createPrecomputedWrappers(),
)

// --- Zod -> JSON Schema, what tools/list needs ---------------------------------------------------
await measure(
  'Zod -> JSON Schema, 3 inputs + 3 outputs (what tools/list converts)',
  N_FAST,
  () => 0,
  () => {
    for (const [key, io] of conversionTargets) {
      SCHEMAS[key]['~standard'].jsonSchema[io]({ target: 'draft-2020-12' })
    }
  },
)
await measure(
  'Zod -> JSON Schema, echo input only',
  N_FAST,
  () => 0,
  () => SCHEMAS.echoInput['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
)
await measure(
  'Zod -> JSON Schema, create_note input only (largest)',
  N_FAST,
  () => 0,
  () => SCHEMAS.createNoteInput['~standard'].jsonSchema.input({ target: 'draft-2020-12' }),
)

// --- whole requests through createMcpHandler(...).fetch -------------------------------------------
const serve =
  (handler: { fetch: (request: Request) => Promise<Response> }) => async (request: Request) => {
    const response = await handler.fetch(request)
    await response.text()
  }
await measure(
  'request server/discover (2026) [Zod server]',
  N_E2E,
  () => modernRequest('server/discover'),
  serve(zodHandler),
)
await measure(
  'request tools/list (2026) [Zod server]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(zodHandler),
)
await measure(
  'request tools/list (2025, SSE) [Zod server]',
  N_E2E,
  () => legacyRequest('tools/list'),
  serve(zodHandler),
)
await measure(
  'request tools/call echo (2026) [Zod server]',
  N_E2E,
  () => modernRequest('tools/call', { name: 'echo', arguments: { message: 'hello' } }),
  serve(zodHandler),
)
await measure(
  'request tools/call create_note (2026) [Zod server]',
  N_E2E,
  () =>
    modernRequest('tools/call', {
      name: 'create_note',
      arguments: { title: 'Hello', body: 'b', tags: ['a', 'b'] },
    }),
  serve(zodHandler),
)
await measure(
  'request tools/list (2026) [Zod schemas rebuilt per request]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(freshSchemasHandler),
)
await measure(
  'request server/discover (2026) [precomputed server]',
  N_E2E,
  () => modernRequest('server/discover'),
  serve(precomputedHandler),
)
await measure(
  'request tools/list (2026) [precomputed server]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(precomputedHandler),
)
await measure(
  'request tools/list (2025, SSE) [precomputed server]',
  N_E2E,
  () => legacyRequest('tools/list'),
  serve(precomputedHandler),
)
await measure(
  'request tools/call echo (2026) [precomputed server]',
  N_E2E,
  () => modernRequest('tools/call', { name: 'echo', arguments: { message: 'hello' } }),
  serve(precomputedHandler),
)
await measure(
  'request tools/call create_note (2026) [precomputed server]',
  N_E2E,
  () =>
    modernRequest('tools/call', {
      name: 'create_note',
      arguments: { title: 'Hello', body: 'b', tags: ['a', 'b'] },
    }),
  serve(precomputedHandler),
)
await measure(
  'request server/discover (2026) [memoized-Zod server]',
  N_E2E,
  () => modernRequest('server/discover'),
  serve(memoizedHandler),
)
await measure(
  'request tools/list (2026) [memoized-Zod server]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(memoizedHandler),
)
await measure(
  'request tools/call echo (2026) [memoized-Zod server]',
  N_E2E,
  () => modernRequest('tools/call', { name: 'echo', arguments: { message: 'hello' } }),
  serve(memoizedHandler),
)
await measure(
  'request tools/call create_note (2026) [memoized-Zod server]',
  N_E2E,
  () =>
    modernRequest('tools/call', {
      name: 'create_note',
      arguments: { title: 'Hello', body: 'b', tags: ['a', 'b'] },
    }),
  serve(memoizedHandler),
)
await measure(
  'request tools/list (2026) [precomputed, wrappers per request]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(precomputedPerRequestWrappers),
)

// --- a registry the size of the plan's: 9 tools with ~12-field inputs and outputs ------------------
function bigField(index: number): z.ZodType {
  switch (index % 6) {
    case 0:
      return z.string().min(1).max(200).describe(`text field ${index}`)
    case 1:
      return z.number().int().min(0).describe(`counter ${index}`)
    case 2:
      return z.boolean().default(false).describe(`flag ${index}`)
    case 3:
      return z
        .enum(['draft', 'review', 'published', 'archived', 'scheduled', 'failed'])
        .describe(`state ${index}`)
    case 4:
      return z.array(z.string().max(40)).max(50).default([]).describe(`list ${index}`)
    default:
      return z
        .object({
          path: z.string(),
          line: z.number().int().optional(),
          severity: z.enum(['error', 'warning']),
          message: z.string(),
        })
        .describe(`nested ${index}`)
  }
}
function bigObject(fields: number): z.ZodObject {
  return z.object(
    Object.fromEntries(Array.from({ length: fields }, (_, i) => [`field_${i}`, bigField(i)])),
  )
}
const BIG_TOOLS = Array.from({ length: 9 }, (_, i) => ({
  name: `operation_${i}`,
  input: bigObject(12),
  output: bigObject(12),
}))
const bigServer: McpServerFactory = () => {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: { listChanged: false } } })
  for (const tool of BIG_TOOLS) {
    server.registerTool(
      tool.name,
      { description: `Operation ${tool.name}`, inputSchema: tool.input, outputSchema: tool.output },
      () => ({ content: [] }),
    )
  }
  return server
}
const bigJson = (schema: z.ZodType, io: 'input' | 'output'): JsonSchemaType => {
  const converted = schema['~standard'].jsonSchema[io]({ target: 'draft-2020-12' })
  return converted.type === undefined ? { type: 'object', ...converted } : converted
}
const BIG_WRAPPERS = BIG_TOOLS.map((tool) => ({
  name: tool.name,
  input: fromJsonSchema<unknown>(bigJson(tool.input, 'input')),
  output: fromJsonSchema<unknown>(bigJson(tool.output, 'output')),
}))
const bigPrecomputedServer: McpServerFactory = () => {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: { listChanged: false } } })
  for (const tool of BIG_WRAPPERS) {
    server.registerTool(
      tool.name,
      { description: `Operation ${tool.name}`, inputSchema: tool.input, outputSchema: tool.output },
      () => ({ content: [] }),
    )
  }
  return server
}
// A tool that can be called: operation_0 answers with a value valid for its own output schema.
function bigSample(index: number): unknown {
  switch (index % 6) {
    case 0:
      return 'some text'
    case 1:
      return 7
    case 2:
      return true
    case 3:
      return 'review'
    case 4:
      return ['a', 'b']
    default:
      return { path: 'content/a.md', line: 3, severity: 'error', message: 'broken' }
  }
}
const bigSampleObject = Object.fromEntries(
  Array.from({ length: 12 }, (_, i) => [`field_${i}`, bigSample(i)]),
)
function withCallableTool(
  server: McpServer,
  input: StandardSchemaWithJSON,
  output: StandardSchemaWithJSON,
): McpServer {
  server.registerTool(
    'callable',
    { description: 'callable', inputSchema: input, outputSchema: output },
    () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: bigSampleObject,
    }),
  )
  return server
}
const BIG_CALLABLE_INPUT = bigObject(12)
const BIG_CALLABLE_OUTPUT = bigObject(12)
const BIG_MEMOIZED = memoizeSchemas({ input: BIG_CALLABLE_INPUT, output: BIG_CALLABLE_OUTPUT })
const BIG_MEMOIZED_TOOLS = BIG_TOOLS.map((tool) => ({
  name: tool.name,
  ...memoizeSchemas({ input: tool.input, output: tool.output }),
}))
const bigZodCallHandler = createMcpHandler(() => {
  const server = bigServer({ era: 'modern' }) as McpServer
  return withCallableTool(server, BIG_CALLABLE_INPUT, BIG_CALLABLE_OUTPUT)
})
const bigMemoizedHandler = createMcpHandler(() => {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: { listChanged: false } } })
  for (const tool of BIG_MEMOIZED_TOOLS) {
    server.registerTool(
      tool.name,
      { description: `Operation ${tool.name}`, inputSchema: tool.input, outputSchema: tool.output },
      () => ({ content: [] }),
    )
  }
  return withCallableTool(server, BIG_MEMOIZED.input, BIG_MEMOIZED.output)
})
const bigZodHandler = createMcpHandler(bigServer)
const bigPrecomputedHandler = createMcpHandler(bigPrecomputedServer)
await expectOk(bigZodHandler, () => modernRequest('tools/list'), 'operation_8')
await expectOk(
  bigZodCallHandler,
  () => modernRequest('tools/call', { name: 'callable', arguments: bigSampleObject }),
  'structuredContent',
)
await expectOk(
  bigMemoizedHandler,
  () => modernRequest('tools/call', { name: 'callable', arguments: bigSampleObject }),
  'structuredContent',
)
await expectOk(bigPrecomputedHandler, () => modernRequest('tools/list'), 'operation_8')
{
  const text = await (await bigZodHandler.fetch(modernRequest('tools/list'))).text()
  const twin = await (await bigPrecomputedHandler.fetch(modernRequest('tools/list'))).text()
  assert(
    text === twin,
    'the precomputed twin of the big registry must answer tools/list byte-identically',
  )
  console.log(
    `plan-sized registry: tools/list answer is ${text.length} bytes, identical for Zod and precomputed`,
  )
}
await measure(
  'PLAN-SIZED (9 tools x 12-field schemas): build server [Zod, module-scope schemas]',
  N_FAST,
  () => 0,
  () => bigServer({ era: 'modern' }),
)
await measure(
  'PLAN-SIZED: Zod -> JSON Schema for all 9 inputs + 9 outputs',
  N_FAST / 4,
  () => 0,
  () => {
    for (const tool of BIG_TOOLS) {
      tool.input['~standard'].jsonSchema.input({ target: 'draft-2020-12' })
      tool.output['~standard'].jsonSchema.output({ target: 'draft-2020-12' })
    }
  },
)
await measure(
  'PLAN-SIZED: request tools/list (2026) [Zod server]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(bigZodHandler),
)
await measure(
  'PLAN-SIZED: request tools/list (2026) [precomputed server]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(bigPrecomputedHandler),
)
await measure(
  'PLAN-SIZED: request tools/list (2026) [memoized-Zod server]',
  N_E2E,
  () => modernRequest('tools/list'),
  serve(bigMemoizedHandler),
)
await measure(
  'PLAN-SIZED: request tools/call, 12-field in/out (2026) [Zod server, 10 tools registered]',
  N_E2E,
  () => modernRequest('tools/call', { name: 'callable', arguments: bigSampleObject }),
  serve(bigZodCallHandler),
)
await measure(
  'PLAN-SIZED: request tools/call, 12-field in/out (2026) [memoized-Zod server]',
  N_E2E,
  () => modernRequest('tools/call', { name: 'callable', arguments: bigSampleObject }),
  serve(bigMemoizedHandler),
)
await measure(
  'PLAN-SIZED: request server/discover (2026) [Zod server, 9 tools]',
  N_E2E,
  () => modernRequest('server/discover'),
  serve(bigZodHandler),
)

const header = `node ${process.version}, jitless=${String(z.core.globalConfig.jitless)}, conditions=${process.execArgv.join(' ') || '(none)'}, label=${label}`
console.log(header)
console.log(
  `${'scenario'.padEnd(72)} ${'median'.padStart(9)} ${'p95'.padStart(9)} ${'mean'.padStart(9)} ${'cpu/iter'.padStart(9)}   (µs)`,
)
for (const row of results) {
  console.log(
    `${row.name.padEnd(72)} ${row.medianUs.toFixed(1).padStart(9)} ${row.p95Us.toFixed(1).padStart(9)} ${row.meanUs.toFixed(1).padStart(9)} ${row.cpuPerIterationUs.toFixed(1).padStart(9)}`,
  )
}

const outDir = resolve(import.meta.dirname, 'results')
mkdirSync(outDir, { recursive: true })
writeFileSync(
  resolve(outDir, `cpu-${label}.json`),
  JSON.stringify(
    { header, nodeVersion: process.version, execArgv: process.execArgv, results },
    null,
    2,
  ),
)
