import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { stringify } from 'yaml'
import { findWrangler } from '../../packages/cli/src/wrangler.ts'
import {
  CONFORMANCE_REVISIONS,
  parseBaseline,
  parseProfile,
  type Baseline,
  type ProfileEntry,
} from '../guards/conformance-baselines.ts'
import { describeViolations, type Violation } from '../guards/types.ts'
import { CLAIMS_SCENARIO, probeClaims, type Era, type ProbeResult } from './claims.ts'
import { freePort, startProcess, stopAll, waitForWorker, type ManagedProcess } from './processes.ts'
import { startProxy, type Proxy } from './proxy.ts'
import {
  evaluateBaseline,
  evaluateProfile,
  readScenarioResults,
  readScoredScenarios,
  summarize,
  type Summary,
} from './results.ts'
import { resetLocalState, seed } from './seed.ts'

const HERE = import.meta.dirname
const REPOSITORY = join(HERE, '..', '..')
const WORKER = join(HERE, 'worker')
const RESULTS = join(HERE, 'results')

const WORKER_START_TIMEOUT_MS = 120_000
const SUITE_TIMEOUT_MS = 300_000

const REVISIONS: readonly string[] = CONFORMANCE_REVISIONS

const SHOWN_PROBLEMS = 20

function read(path: string): string {
  return readFileSync(join(HERE, path), 'utf8')
}

function seconds(from: number): string {
  return `${((performance.now() - from) / 1000).toFixed(1)} s`
}

function say(line: string): void {
  process.stdout.write(`${line}\n`)
}

function loadData(revisions: readonly string[]): {
  profile: readonly ProfileEntry[]
  baselines: ReadonlyMap<string, Baseline>
} {
  const violations: Violation[] = []
  const profile = parseProfile({
    path: 'tests/conformance/must-pass.yaml',
    text: read('must-pass.yaml'),
  })
  violations.push(...profile.violations)
  const baselines = new Map<string, Baseline>()
  for (const revision of revisions) {
    const path = `baselines/${revision}.yaml`
    const parsed = parseBaseline({ path: `tests/conformance/${path}`, text: read(path) })
    violations.push(...parsed.violations)
    if (parsed.baseline !== undefined) baselines.set(revision, parsed.baseline)
  }
  if (violations.length > 0) {
    throw new Error(
      `the baselines or the must-pass profile break the guard conformance-baselines:\n${describeViolations(violations).join('\n')}`,
    )
  }
  return { profile: profile.entries, baselines }
}

function rootBin(name: string): string {
  const bin = join(REPOSITORY, 'node_modules', '.bin', name)
  if (!existsSync(bin)) throw new Error(`${bin} does not exist: run pnpm install`)
  return bin
}

function expectedFailures(baseline: Baseline): string {
  return stringify({ server: baseline.entries.map((entry) => entry.check) })
}

function requirementsFile(revision: string): string {
  const manifest = createRequire(import.meta.url).resolve(
    '@modelcontextprotocol/conformance/package.json',
  )
  return join(dirname(manifest), 'requirements', `${revision}.yaml`)
}

interface RevisionReport {
  readonly revision: string
  readonly ok: boolean
  readonly problems: readonly string[]
  readonly summary: Summary
  readonly profile: { readonly passed: number; readonly failed: number }
  readonly suiteTotals: string | undefined
  readonly seconds: number
}

function suiteTotals(output: string): string | undefined {
  return /^Total: \d+ passed, \d+ failed$/m.exec(output)?.[0]
}

function saveClaims(directory: string, results: readonly ProbeResult[]): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const folder = join(directory, `server-${CLAIMS_SCENARIO}-${stamp}`)
  mkdirSync(folder, { recursive: true })
  const timestamp = new Date().toISOString()
  const checks = results.map((result) => ({ ...result, timestamp }))
  writeFileSync(join(folder, 'checks.json'), `${JSON.stringify(checks, null, 2)}\n`)
}

async function runRevision(options: {
  readonly revision: string
  readonly url: string
  readonly workerPort: number
  readonly readOnlyToken: string
  readonly baseline: Baseline
  readonly profile: readonly ProfileEntry[]
  readonly env: NodeJS.ProcessEnv
}): Promise<RevisionReport> {
  const { revision, baseline } = options
  const started = performance.now()
  const directory = join(RESULTS, revision)
  mkdirSync(directory, { recursive: true })
  const expectedFile = join(directory, 'expected-failures.yml')
  writeFileSync(expectedFile, expectedFailures(baseline))
  const outputFile = join(directory, 'output.txt')

  const suite = startProcess({
    command: rootBin('conformance'),
    args: [
      'server',
      '--url',
      `${options.url}/mcp`,
      '--requirements',
      revision,
      '--expected-failures',
      expectedFile,
      '--output-dir',
      directory,
    ],
    cwd: REPOSITORY,
    env: options.env,
    logFile: outputFile,
  })
  let timer: NodeJS.Timeout | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout')
    }, SUITE_TIMEOUT_MS)
  })
  const code = await Promise.race([suite.exited, timedOut]).finally(() => {
    clearTimeout(timer)
  })
  await suite.stop()

  const problems: string[] = []
  if (code === 'timeout')
    problems.push(`the suite did not finish within ${SUITE_TIMEOUT_MS / 1000} s`)
  else if (code !== 0)
    problems.push(`the suite exited with ${code}: see its verdict in ${outputFile}`)

  const era: Era = revision === '2026-07-28' ? 'modern' : 'legacy'
  saveClaims(
    directory,
    await probeClaims({
      workerPort: options.workerPort,
      publicUrl: options.url,
      era,
      readOnlyToken: options.readOnlyToken,
    }),
  )

  const scored = readScoredScenarios(requirementsFile(revision))
  const scenarios = readScenarioResults(directory)
  const suiteScenarios = scenarios.filter((result) => result.scenario !== CLAIMS_SCENARIO)
  const ran = new Set(scenarios.map((result) => result.scenario))
  for (const scenario of scored) {
    if (!ran.has(scenario)) problems.push(`the scored scenario ${scenario} left no result`)
  }
  const entries = options.profile.filter((entry) => entry.revisions.includes(revision))
  const held = evaluateProfile(entries, scenarios)
  problems.push(...held.problems)
  const judged = evaluateBaseline(baseline, suiteScenarios, scored)
  problems.push(...judged.unexpected.map((line) => `outside the baseline: ${line}`))
  problems.push(...judged.excusesNothing.map((line) => `baseline entry ${line}`))

  const summary = summarize(baseline, suiteScenarios, scored)
  const report: RevisionReport = {
    revision,
    ok: problems.length === 0,
    problems,
    summary,
    profile: { passed: held.passed, failed: held.problems.length },
    suiteTotals: suiteTotals(readFileSync(outputFile, 'utf8')),
    seconds: (performance.now() - started) / 1000,
  }
  writeFileSync(join(directory, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`)
  return report
}

function describeSummary(report: RevisionReport): string[] {
  const { scored, baselined, notScored } = report.summary
  const classes = Object.entries(baselined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ')
  return [
    `conformance ${report.revision}: ${scored.scenarios} scenarios scored: ${scored.passed} checks pass, ${scored.failing} fail and are baselined (${classes === '' ? 'none' : classes})`,
    `conformance ${report.revision}: ${notScored.scenarios} more scenarios run but are not scored, so not judged: ${notScored.passed} checks pass, ${notScored.failing} fail`,
    `conformance ${report.revision}: must-pass profile: ${report.profile.passed} checks pass, ${report.profile.failed} do not`,
    `conformance ${report.revision}: the suite's own count of every occurrence of a check, scored or not: ${report.suiteTotals ?? 'none'}`,
  ]
}

export async function main(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { revision: { type: 'string', multiple: true }, help: { type: 'boolean' } },
    allowPositionals: false,
  })
  if (values.help === true) {
    say('Usage: node tests/conformance/run.ts [--revision <revision>]...')
    say(`Revisions: ${REVISIONS.join(', ')} (all of them by default)`)
    return 0
  }
  const revisions = values.revision ?? [...REVISIONS]
  for (const revision of revisions) {
    if (!REVISIONS.includes(revision)) {
      throw new Error(`unknown revision ${revision}: use ${REVISIONS.join(' or ')}`)
    }
  }
  const { profile, baselines } = loadData(revisions)

  const total = performance.now()
  rmSync(RESULTS, { recursive: true, force: true })
  mkdirSync(RESULTS, { recursive: true })
  const env: NodeJS.ProcessEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' }

  let proxy: Proxy | undefined
  let wrangler: ManagedProcess | undefined
  const reports: RevisionReport[] = []
  try {
    const phase = performance.now()
    resetLocalState(WORKER)
    const { token, readOnlyToken } = await seed({
      repository: REPOSITORY,
      workerDirectory: WORKER,
      env,
    })
    say(
      `conformance: database migrated and initialized with the CLI of Hollware in ${seconds(phase)}`,
    )

    const workerPort = await freePort()
    const inspectorPort = await freePort()
    const proxyLog = join(RESULTS, 'proxy.log')
    proxy = await startProxy({
      upstream: `http://127.0.0.1:${workerPort}`,
      token,
      port: 0,
      log: (line) => {
        appendFileSync(proxyLog, `${line}\n`)
      },
    })

    const started = performance.now()
    const wranglerBin = findWrangler(WORKER)
    if (wranglerBin === undefined)
      throw new Error(`no wrangler is installed in ${WORKER} or above it`)
    wrangler = startProcess({
      command: wranglerBin,
      args: [
        'dev',
        '--local',
        '--ip',
        '127.0.0.1',
        '--port',
        String(workerPort),
        '--inspector-port',
        String(inspectorPort),
        '--show-interactive-dev-session=false',
        '--var',
        `HOLLWARE_PUBLIC_URL:${proxy.url}`,
      ],
      cwd: WORKER,
      env,
      logFile: join(RESULTS, 'wrangler.log'),
    })
    await waitForWorker({
      port: workerPort,
      host: new URL(proxy.url).host,
      process: wrangler,
      timeoutMs: WORKER_START_TIMEOUT_MS,
    })
    say(
      `conformance: wrangler dev answers at ${proxy.url} through the proxy (ready in ${seconds(started)})`,
    )

    for (const revision of revisions) {
      const baseline = baselines.get(revision)
      if (baseline === undefined) throw new Error(`no baseline was read for ${revision}`)
      const report = await runRevision({
        revision,
        url: proxy.url,
        workerPort,
        readOnlyToken,
        baseline,
        profile,
        env,
      })
      reports.push(report)
      for (const line of describeSummary(report)) say(line)
      for (const problem of report.problems.slice(0, SHOWN_PROBLEMS)) {
        say(`  FAILED ${revision}: ${problem}`)
      }
      if (report.problems.length > SHOWN_PROBLEMS) {
        say(
          `  ... and ${report.problems.length - SHOWN_PROBLEMS} more problems, all in tests/conformance/results/${revision}/summary.json`,
        )
      }
      say(
        `conformance ${revision}: ${report.ok ? 'ok' : 'FAILED'} in ${report.seconds.toFixed(1)} s`,
      )
    }
  } finally {
    await stopAll()
    await proxy?.close()
  }
  const ok = reports.length === revisions.length && reports.every((report) => report.ok)
  say(
    `conformance: ${ok ? 'OK' : 'FAILED'} in ${seconds(total)} (results in tests/conformance/results)`,
  )
  return ok ? 0 : 1
}

function isEntryPoint(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  for (const [signal, number] of [
    ['SIGINT', 2],
    ['SIGTERM', 15],
    ['SIGHUP', 1],
  ] as const) {
    process.once(signal, () => {
      void stopAll().finally(() => process.exit(128 + number))
    })
  }
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      process.stderr.write(
        `conformance: ${error instanceof Error ? error.message : String(error)}\n`,
      )
      void stopAll().finally(() => process.exit(2))
    },
  )
}
