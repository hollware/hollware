// Summarizes a conformance results directory (one sub-directory per scenario, each with checks.json),
// marking each scenario as required / not scored by the requirement set it ran under.
//   node conformance/summarize.mjs <results-dir> <2026-07-28|2025-11-25> [--failures]
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const [dir, revision, ...flags] = process.argv.slice(2)
const showFailures = flags.includes('--failures')
const asBaseline = flags.includes('--baseline')

// The requirement files are simple enough to read line by line (no YAML dependency in this spike).
const requirementsFile = resolve(
  import.meta.dirname,
  `../../../node_modules/.pnpm/@modelcontextprotocol+conformance@0.2.0-alpha.12_supports-color@10.2.2/node_modules/@modelcontextprotocol/conformance/requirements/${revision}.yaml`,
)
const required = new Set()
const notScored = new Map()
let section = ''
let pending
for (const line of readFileSync(requirementsFile, 'utf8').split('\n')) {
  if (/^(server|client|not_scored):/.test(line)) section = line.split(':')[0]
  else if (section === 'server' && /^\s+- \S/.test(line))
    required.add(line.replace(/^\s+- /, '').trim())
  else if (section === 'not_scored') {
    const scenario = line.match(/^\s+- scenario: (\S+)/)
    const reason = line.match(/^\s+reason: (\S+)/)
    const leg = line.match(/^\s+leg: (\S+)/)
    if (scenario) pending = { scenario: scenario[1] }
    else if (pending && leg) pending.leg = leg[1]
    else if (pending && reason) {
      if (pending.leg === 'server') notScored.set(pending.scenario, reason[1])
      pending = undefined
    }
  }
}

const rows = []
for (const entry of readdirSync(dir).sort()) {
  const match = entry.match(/^server-(.+)-\d{4}-\d{2}-\d{2}T/)
  if (!match) continue
  const scenario = match[1]
  const checks = JSON.parse(readFileSync(resolve(dir, entry, 'checks.json'), 'utf8'))
  const count = (status) => checks.filter((check) => check.status === status).length
  rows.push({
    scenario,
    kind: required.has(scenario)
      ? 'required'
      : notScored.has(scenario)
        ? `not scored (${notScored.get(scenario)})`
        : 'other',
    pass: count('SUCCESS'),
    fail: count('FAILURE'),
    // The runner counts a WARNING as a failure when it judges a scenario against a baseline.
    warn: count('WARNING'),
    skip: count('SKIPPED') + count('INFO'),
    failures: checks.filter((check) => check.status === 'FAILURE'),
  })
}

if (asBaseline) {
  // The expected-failures file for `conformance server --expected-failures`: every required scenario
  // that has a failing check or a WARNING (the runner treats both as failing against a baseline).
  // Scenarios that pass must not be listed (a stale entry exits 1).
  console.log(`# Expected failures of the stub Worker against the ${revision} requirement set.`)
  console.log('server:')
  for (const row of rows.filter((r) => r.kind === 'required' && (r.fail > 0 || r.warn > 0)))
    console.log(`  - ${row.scenario}`)
  process.exit(0)
}

console.log(`${'scenario'.padEnd(52)} ${'kind'.padEnd(26)} pass fail warn skip`)
for (const row of rows) {
  console.log(
    `${row.scenario.padEnd(52)} ${row.kind.padEnd(26)} ${String(row.pass).padStart(4)} ${String(row.fail).padStart(4)} ${String(row.warn).padStart(4)} ${String(row.skip).padStart(4)}${row.fail > 0 ? '  FAIL' : row.warn > 0 ? '  warn' : '  ok'}`,
  )
  if (showFailures) {
    for (const check of row.failures) {
      console.log(
        `    x ${check.id}: ${(check.errorMessage ?? check.description ?? '').replace(/\s+/g, ' ').slice(0, 220)}`,
      )
    }
  }
}
const requiredRows = rows.filter((row) => row.kind === 'required')
const requiredFailing = requiredRows.filter((row) => row.fail > 0)
const requiredWarnOnly = requiredRows.filter((row) => row.fail === 0 && row.warn > 0)
console.log(
  `\nrequired scenarios: ${requiredRows.length} ran, ${requiredRows.length - requiredFailing.length - requiredWarnOnly.length} clean, ${requiredWarnOnly.length} with warnings only, ${requiredFailing.length} with failing checks`,
)
console.log(
  `checks (all scenarios): ${rows.reduce((a, r) => a + r.pass, 0)} passed, ${rows.reduce((a, r) => a + r.fail, 0)} failed, ${rows.reduce((a, r) => a + r.warn, 0)} warnings, ${rows.reduce((a, r) => a + r.skip, 0)} skipped/info`,
)
const missing = [...required].filter((name) => !rows.some((row) => row.scenario === name))
if (missing.length > 0) console.log(`required but not found in results: ${missing.join(', ')}`)
