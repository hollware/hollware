import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vite-plus/test'

// Fails when: src/db/schema.ts changes and no migration is generated for it (the first test then
// finds a new file); a hand-written migration stops carrying the snapshot drizzle-kit chains
// through, so the next generated migration would start from a stale schema (the second test then
// finds more than the one ALTER TABLE); or drizzle-kit changes what it prints with nothing to do.

const packageDir = join(import.meta.dirname, '..')
const drizzleKit = join(packageDir, 'node_modules/.bin/drizzle-kit')

// Under the package, so the schema's imports resolve; `.vitest/` is ignored by git.
mkdirSync(join(packageDir, '.vitest'), { recursive: true })
const scratch = mkdtempSync(join(packageDir, '.vitest', 'drizzle-kit-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** The files under `root`, as paths relative to it. */
function listFiles(root: string, directory = root): string[] {
  return readdirSync(directory)
    .flatMap((name) => {
      const file = join(directory, name)
      return statSync(file).isDirectory() ? listFiles(root, file) : [relative(root, file)]
    })
    .sort()
}

/**
 * Runs `drizzle-kit generate` over a copy of migrations/, so the committed folder is never touched,
 * and returns the files of the copy before and after.
 */
function generateOnCopy(name: string, schemaFile: string, extraArgs: string[] = []) {
  const workdir = join(scratch, name)
  const out = join(workdir, 'migrations')
  mkdirSync(workdir)
  cpSync(join(packageDir, 'migrations'), out, { recursive: true })
  const config = join(workdir, 'drizzle.config.ts')
  // drizzle-kit prefixes `out` with './' (an absolute path would read ".//abs/..."), so `out` is
  // relative to the directory the CLI runs in.
  writeFileSync(
    config,
    `import { defineConfig } from 'drizzle-kit'\n` +
      `export default defineConfig({ dialect: 'sqlite', schema: ${JSON.stringify(schemaFile)}, out: ${JSON.stringify(relative(packageDir, out))} })\n`,
  )
  const before = listFiles(out)
  const stdout = execFileSync(drizzleKit, ['generate', '--config', config, ...extraArgs], {
    cwd: packageDir,
    encoding: 'utf8',
  })
  return { out, before, after: listFiles(out), stdout }
}

// Each test starts drizzle-kit, a CLI that takes seconds on a busy machine: the default 5 s
// timeout failed under load (2026-10-12) while the test itself passed.
describe('migrations/ and src/db/schema.ts', { timeout: 60_000 }, () => {
  it('describe the same schema: drizzle-kit finds nothing to migrate', () => {
    const run = generateOnCopy('no-change', join(packageDir, 'src/db/schema.ts'))

    expect(run.before).toEqual([
      '0000_init.sql',
      '0001_core.sql',
      '0002_append_only.sql',
      '0003_events_and_schedules.sql',
      '0004_identity.sql',
      'meta/0000_snapshot.json',
      'meta/0001_snapshot.json',
      'meta/0002_snapshot.json',
      'meta/0003_snapshot.json',
      'meta/0004_snapshot.json',
      'meta/_journal.json',
    ])
    expect(run.stdout).toContain('No schema changes, nothing to migrate')
    expect(run.after).toEqual(run.before)
  })

  it('chain the snapshots: a new nullable column of revisions is one ALTER TABLE, with no rebuild', () => {
    const db = join(scratch, 'db')
    cpSync(join(packageDir, 'src/db'), db, { recursive: true })
    const schemaFile = join(db, 'schema.ts')
    const original = readFileSync(schemaFile, 'utf8')
    const changed = original.replace(
      "markdown: text('markdown').notNull(),",
      "markdown: text('markdown').notNull(),\n    summary: text('summary'),",
    )
    expect(changed).not.toBe(original)
    writeFileSync(schemaFile, changed)

    const run = generateOnCopy('drift', schemaFile, ['--name', 'drift'])

    expect(run.after.filter((file) => !run.before.includes(file))).toEqual([
      '0005_drift.sql',
      'meta/0005_snapshot.json',
    ])
    expect(readFileSync(join(run.out, '0005_drift.sql'), 'utf8')).toBe(
      'ALTER TABLE `revisions` ADD `summary` text;',
    )
  })
})
