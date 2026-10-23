import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { newId } from '../packages/core/src/ids.ts'
import { generatePersonalToken, hashPersonalToken } from '../packages/core/src/tokens.ts'

const KIB = 1024

export interface Ceiling {
  readonly gzipKiB: number
  readonly reason: string
}

export interface Budgets {
  readonly main: Ceiling
  readonly total: Ceiling
  readonly lazyPackages: { readonly packages: readonly string[]; readonly reason: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readCeiling(value: unknown, name: string): Ceiling {
  if (
    !isRecord(value) ||
    typeof value.gzipKiB !== 'number' ||
    !Number.isFinite(value.gzipKiB) ||
    value.gzipKiB <= 0 ||
    typeof value.reason !== 'string' ||
    value.reason.trim() === ''
  ) {
    throw new Error(
      `budgets.json: "${name}" must be { "gzipKiB": <a positive number>, "reason": "<why>" }`,
    )
  }
  return { gzipKiB: value.gzipKiB, reason: value.reason }
}

export function parseBudgets(text: string): Budgets {
  const json: unknown = JSON.parse(text)
  if (!isRecord(json)) throw new Error('budgets.json must hold an object')
  const lazy = json.lazyPackages
  if (
    !isRecord(lazy) ||
    !Array.isArray(lazy.packages) ||
    lazy.packages.length === 0 ||
    !lazy.packages.every((name): name is string => typeof name === 'string' && name !== '') ||
    typeof lazy.reason !== 'string' ||
    lazy.reason.trim() === ''
  ) {
    throw new Error(
      'budgets.json: "lazyPackages" must be { "packages": [<names>], "reason": "<why>" } with at least one name',
    )
  }
  const main = readCeiling(json.main, 'main')
  const total = readCeiling(json.total, 'total')
  return {
    main,
    total,
    lazyPackages: { packages: lazy.packages, reason: lazy.reason },
  }
}

export interface ModuleSize {
  readonly file: string
  readonly bytes: number
  readonly gzipBytes: number
  readonly startup: boolean
  readonly packages: readonly string[]
}

export interface Measurement {
  readonly main: string
  readonly modules: readonly ModuleSize[]
  readonly startupGzipBytes: number
  readonly totalGzipBytes: number
}

export function gzipBytes(content: Uint8Array): number {
  return gzipSync(content).length
}

export function packageOfSource(source: string): string | null {
  const marker = 'node_modules/'
  const at = source.lastIndexOf(marker)
  if (at === -1) return null
  const [first, second] = source.slice(at + marker.length).split('/')
  if (first === undefined || first === '') return null
  return first.startsWith('@') && second !== undefined ? `${first}/${second}` : first
}

function moduleFiles(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : moduleFiles(path, base)
    return /\.m?js$/.test(entry.name) ? [relative(base, path).split('\\').join('/')] : []
  })
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function packagesIn(path: string): string[] {
  if (!existsSync(`${path}.map`)) return []
  const map = readJson(`${path}.map`)
  const sources = isRecord(map) && Array.isArray(map.sources) ? map.sources : []
  const names = new Set<string>()
  for (const source of sources) {
    const name = typeof source === 'string' ? packageOfSource(source) : null
    if (name !== null) names.add(name)
  }
  return [...names].sort()
}

function startupFiles(directory: string, main: string): Set<string> {
  const manifestPath = join(directory, '.vite', 'manifest.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} does not exist: the build must write its Vite manifest`)
  }
  const manifest = readJson(manifestPath)
  const chunks = isRecord(manifest) ? Object.values(manifest).filter(isRecord) : []
  const byKey = new Map(Object.entries(isRecord(manifest) ? manifest : {}))
  const entry = chunks.find((chunk) => chunk.file === main)
  if (entry === undefined) throw new Error(`the Vite manifest has no chunk for ${main}`)
  const files = new Set<string>()
  const pending: unknown[] = [entry]
  for (let chunk = pending.pop(); chunk !== undefined; chunk = pending.pop()) {
    if (!isRecord(chunk) || typeof chunk.file !== 'string' || files.has(chunk.file)) continue
    files.add(chunk.file)
    if (Array.isArray(chunk.imports)) {
      for (const key of chunk.imports) pending.push(byKey.get(String(key)))
    }
  }
  return files
}

export function measureBuild(directory: string): Measurement {
  const config = readJson(join(directory, 'wrangler.json'))
  const main = isRecord(config) && typeof config.main === 'string' ? config.main : undefined
  if (main === undefined) throw new Error(`${directory}/wrangler.json has no "main"`)
  const startup = startupFiles(directory, main)
  const modules = moduleFiles(directory)
    .sort()
    .map((file): ModuleSize => {
      const content = readFileSync(join(directory, file))
      return {
        file,
        bytes: content.length,
        gzipBytes: gzipBytes(content),
        startup: startup.has(file),
        packages: packagesIn(join(directory, file)),
      }
    })
  if (!modules.some((module) => module.file === main)) {
    throw new Error(`the main module ${main} is not among the files of ${directory}`)
  }
  const sum = (selected: readonly ModuleSize[]) =>
    selected.reduce((total, module) => total + module.gzipBytes, 0)
  return {
    main,
    modules,
    startupGzipBytes: sum(modules.filter((module) => module.startup)),
    totalGzipBytes: sum(modules),
  }
}

export interface Violation {
  readonly rule:
    | 'main-ceiling'
    | 'total-ceiling'
    | 'not-lazy'
    | 'no-lazy-chunk'
    | 'warm-write-ceiling'
  readonly message: string
}

function kib(bytes: number): string {
  return `${(bytes / KIB).toFixed(2)} KiB`
}

export function checkBudgets(measurement: Measurement, budgets: Budgets): Violation[] {
  const violations: Violation[] = []
  const check = (rule: Violation['rule'], what: string, bytes: number, ceiling: Ceiling) => {
    if (bytes > ceiling.gzipKiB * KIB) {
      violations.push({
        rule,
        message: `${what} is ${kib(bytes)} gzipped, over the ceiling of ${ceiling.gzipKiB} KiB in budgets.json. ${ceiling.reason} Make the build smaller; raising a ceiling says why in its reason.`,
      })
    }
  }
  check(
    'main-ceiling',
    `the main module and what it imports at startup`,
    measurement.startupGzipBytes,
    budgets.main,
  )
  check('total-ceiling', 'all the modules together', measurement.totalGzipBytes, budgets.total)

  const withMaps = measurement.modules.some((module) => module.packages.length > 0)
  for (const name of budgets.lazyPackages.packages) {
    const inStartup = measurement.modules.filter(
      (module) => module.startup && module.packages.includes(name),
    )
    if (inStartup.length > 0) {
      violations.push({
        rule: 'not-lazy',
        message: `${name} is in the startup modules (${inStartup.map((module) => module.file).join(', ')}), so every cold start evaluates it. ${budgets.lazyPackages.reason}`,
      })
    } else if (!measurement.modules.some((module) => module.packages.includes(name))) {
      violations.push({
        rule: 'no-lazy-chunk',
        message: withMaps
          ? `${name} is in no module of the build, so nothing shows that it stays lazy: if it left the Worker, remove it from lazyPackages in budgets.json`
          : `the build has no source maps, so ${name} cannot be placed: build with --sourcemap hidden`,
      })
    }
  }
  return violations
}

export function median(samples: readonly number[]): number {
  if (samples.length === 0) throw new RangeError('the median of nothing')
  const sorted = [...samples].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const high = sorted[middle]
  const low = sorted[middle - 1]
  if (high === undefined) throw new RangeError('the median of nothing')
  return sorted.length % 2 === 1 || low === undefined ? high : (low + high) / 2
}

export function parseStartupActive(output: string): number {
  const match = /Active:\s+([\d.]+) ms/.exec(output)
  const active = match?.[1] === undefined ? Number.NaN : Number(match[1])
  if (!Number.isFinite(active)) {
    throw new Error(`wrangler check startup printed no "Active: <n> ms" line:\n${output}`)
  }
  return active
}

const RUNS = 5

function measureStartup(root: string, workerDirectory: string, env: NodeJS.ProcessEnv): number[] {
  const samples: number[] = []
  for (let run = 0; run < RUNS; run++) {
    const result = spawnSync(
      join(root, 'node_modules/.bin/wrangler'),
      ['check', 'startup', '-c', 'wrangler.json', '--outfile', `startup-${run}.cpuprofile`],
      { cwd: workerDirectory, env, encoding: 'utf8', timeout: 120_000 },
    )
    if (result.status !== 0) {
      throw new Error(
        `wrangler check startup failed (${result.status ?? result.signal}):\n${result.stdout}${result.stderr}`,
      )
    }
    samples.push(parseStartupActive(result.stdout))
  }
  return samples
}

const COLD_RUNS = 3
const WARM_WRITES = 10
const FLOOR_REQUESTS = 5

export interface WriteCost {
  readonly fixture: string
  readonly cold: number
  readonly warm: number
  readonly warmMax: number
  readonly floor: number
}

const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'mcp-protocol-version': '2026-07-28',
  'mcp-method': 'tools/call',
  'mcp-name': 'create_draft',
}

interface SeedStatement {
  bind(...values: unknown[]): SeedStatement
}
interface SeedDatabase {
  prepare(sql: string): SeedStatement
  batch(statements: SeedStatement[]): Promise<unknown>
}

async function measureWrites(root: string, workerDirectory: string): Promise<WriteCost> {
  const { createTestHarness } = await import('wrangler')
  const origin = 'http://localhost'
  const fixturePath = join(root, 'tests/fixtures/content/bench/long-post.md')
  const post = readFileSync(fixturePath, 'utf8')
  const cold: number[] = []
  const warm: number[] = []
  const floor: number[] = []
  for (let run = 0; run < COLD_RUNS; run++) {
    const server = createTestHarness({
      workers: [
        {
          configPath: join(workerDirectory, 'wrangler.json'),
          vars: { HOLLWARE_PUBLIC_URL: origin },
        },
      ],
    })
    try {
      await server.listen()
      const worker = server.getWorker<{ DB: SeedDatabase }>()
      await worker.applyD1Migrations('DB')
      const { DB } = await worker.getEnv()
      const now = new Date().toISOString()
      const owner = newId('usr')
      const token = generatePersonalToken()
      await DB.batch([
        DB.prepare('INSERT INTO sites (id, created_at, updated_at) VALUES (?1, ?2, ?2)').bind(
          'playground',
          now,
        ),
        DB.prepare(
          "INSERT INTO users (id, name, role, created_at, updated_at) VALUES (?1, 'Owner', 'owner', ?2, ?2)",
        ).bind(owner, now),
        DB.prepare(
          "INSERT INTO members (id, site_id, user_id, role, created_at, updated_at) VALUES (?1, 'playground', ?2, 'owner', ?3, ?3)",
        ).bind(newId('mbr'), owner, now),
        DB.prepare(
          "INSERT INTO tokens (id, site_id, user_id, label, hash, scopes, created_at, updated_at) VALUES (?1, 'playground', ?2, 'budget', ?3, ?4, ?5, ?5)",
        ).bind(
          newId('tok'),
          owner,
          await hashPersonalToken(token),
          JSON.stringify(['content:read', 'content:write', 'content:publish', 'schema:admin']),
          now,
        ),
      ])

      const write = async (n: number): Promise<number> => {
        const markdown = post.replace(
          'translationGroup: long-post\n',
          `translationGroup: long-post-${n}\n`,
        )
        if (markdown === post) {
          throw new Error('the fixture has no "translationGroup: long-post" line')
        }
        const started = performance.now()
        const response = await server.fetch(`${origin}/mcp`, {
          method: 'POST',
          headers: { ...MCP_HEADERS, authorization: `Bearer ${token}` },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name: 'create_draft',
              arguments: { collection: 'blog', locale: 'en', slug: `long-post-${n}`, markdown },
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientInfo': { name: 'check-budgets', version: '0.0.0' },
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        })
        const text = await response.text()
        const elapsed = performance.now() - started
        if (response.status !== 200 || !text.includes('"outcome":"saved"')) {
          throw new Error(`create_draft was not saved (${response.status}): ${text.slice(0, 300)}`)
        }
        return elapsed
      }

      cold.push(await write(0))
      for (let n = 1; n <= WARM_WRITES; n++) warm.push(await write(n))
      for (let n = 0; n < FLOOR_REQUESTS; n++) {
        const started = performance.now()
        const response = await server.fetch(`${origin}/health`)
        await response.text()
        floor.push(performance.now() - started)
      }
    } finally {
      await server.close()
    }
  }
  return {
    fixture: relative(root, fixturePath),
    cold: median(cold),
    warm: median(warm),
    warmMax: Math.max(...warm),
    floor: median(floor),
  }
}

function findWorkerDirectory(outDir: string): string {
  const found = readdirSync(outDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(outDir, entry.name, 'wrangler.json')))
    .map((entry) => join(outDir, entry.name))
  const [only, ...others] = found
  if (only === undefined || others.length > 0) {
    throw new Error(`expected one Worker in the build at ${outDir}, found ${found.length}`)
  }
  return only
}

function buildPlayground(root: string, outDir: string, env: NodeJS.ProcessEnv): string {
  const result = spawnSync(
    join(root, 'node_modules/.bin/vp'),
    ['build', '--sourcemap', 'hidden', '--outDir', outDir],
    { cwd: join(root, 'apps/playground'), env, encoding: 'utf8', timeout: 300_000 },
  )
  if (result.status !== 0) {
    throw new Error(
      `vp build failed (${result.status ?? result.signal}):\n${result.stdout}${result.stderr}`,
    )
  }
  return findWorkerDirectory(outDir)
}

function report(measurement: Measurement, budgets: Budgets): string {
  const width = Math.max(...measurement.modules.map((module) => module.file.length))
  const lines = measurement.modules.map(
    (module) =>
      `  ${module.file.padEnd(width)}  ${String(module.bytes).padStart(9)} B  ${kib(module.gzipBytes).padStart(11)}  ${module.startup ? 'startup' : 'lazy'}`,
  )
  return [
    `Modules of the built Worker (gzipped one by one):`,
    ...lines,
    '',
    `  main module and startup imports  ${kib(measurement.startupGzipBytes)}  (ceiling ${budgets.main.gzipKiB} KiB)`,
    `  all modules together             ${kib(measurement.totalGzipBytes)}  (ceiling ${budgets.total.gzipKiB} KiB)`,
  ].join('\n')
}

export async function main(root: string, argv: readonly string[]): Promise<number> {
  const sizesOnly = argv.includes('--sizes-only')
  const budgets = parseBudgets(readFileSync(join(root, 'budgets.json'), 'utf8'))
  const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' }
  const outDir = mkdtempSync(join(tmpdir(), 'check-budgets-'))
  try {
    const workerDirectory = buildPlayground(root, outDir, env)
    const measurement = measureBuild(workerDirectory)
    console.log(report(measurement, budgets))
    const violations = [...checkBudgets(measurement, budgets)]
    if (violations.length === 0) {
      const lazy = measurement.modules.filter((module) => !module.startup).length
      console.log(
        `  ${budgets.lazyPackages.packages.join(' and ')} sit in ${lazy} lazy chunks, none in the startup modules`,
      )
    }
    for (const violation of violations)
      console.error(`FAIL ${violation.rule}: ${violation.message}`)

    if (!sizesOnly) {
      const startup = measureStartup(root, workerDirectory, env)
      console.log(
        `\nStartup, active time of \`wrangler check startup\`, ${RUNS} runs: median ${median(startup).toFixed(1)} ms (${startup.map((ms) => ms.toFixed(1)).join(', ')})`,
      )
      const cost = await measureWrites(root, workerDirectory)
      console.log(
        [
          `Write of ${cost.fixture} (2,027 words), create_draft through the built Worker, local D1:`,
          `  cold  ${cost.cold.toFixed(1)} ms  (the first request of a fresh Worker, median of ${COLD_RUNS})`,
          `  warm  ${cost.warm.toFixed(1)} ms  (median of ${COLD_RUNS * WARM_WRITES}, slowest ${cost.warmMax.toFixed(1)} ms)`,
          `  floor ${cost.floor.toFixed(1)} ms  (GET /health, median of ${COLD_RUNS * FLOOR_REQUESTS}: what a request costs through the harness)`,
          '  Request time seen from outside, an upper bound of the CPU time of the write; no ceiling: `vp run bench` holds the CPU of the pipeline.',
        ].join('\n'),
      )
    }
    return violations.length === 0 ? 0 : 1
  } finally {
    rmSync(outDir, { recursive: true, force: true })
  }
}

const invoked = process.argv[1]
if (invoked !== undefined && pathToFileURL(resolve(invoked)).href === import.meta.url) {
  main(resolve(import.meta.dirname, '..'), process.argv.slice(2)).then(
    (code) => {
      process.exit(code)
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    },
  )
}
