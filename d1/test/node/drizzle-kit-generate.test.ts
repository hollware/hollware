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

// Fails when: src/schema.ts changes without a regenerated migration (the first test then finds a
// new file), the trigger migration stops being a custom migration that drizzle-kit chains through
// its snapshots (the second test then finds DROP statements or a different diff), or the
// drizzle-kit CLI changes what it prints when there is nothing to migrate.

const projectDir = join(import.meta.dirname, '../..')
const drizzleKit = join(projectDir, 'node_modules/.bin/drizzle-kit')

// Under the project so the schema's `drizzle-orm` import resolves; `.vitest/` is git-ignored.
mkdirSync(join(projectDir, '.vitest'), { recursive: true })
const scratch = mkdtempSync(join(projectDir, '.vitest', 'drizzle-kit-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

function listFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name)
      return statSync(path).isDirectory() ? listFiles(path) : [relative(scratch, path)]
    })
    .sort()
}

/** Runs `drizzle-kit generate` on a copy of migrations/, so the committed folder is never touched. */
function generateOnCopy(name: string, schemaPath: string, extraArgs: string[] = []) {
  const workdir = join(scratch, name)
  const out = join(workdir, 'migrations')
  mkdirSync(workdir)
  cpSync(join(projectDir, 'migrations'), out, { recursive: true })
  const config = join(workdir, 'drizzle.config.ts')
  // drizzle-kit prefixes `out` with './' (an absolute path would read ".//abs/..."), so `out`
  // is relative to the directory the CLI runs in.
  writeFileSync(
    config,
    `import { defineConfig } from 'drizzle-kit'\n` +
      `export default defineConfig({ dialect: 'sqlite', schema: ${JSON.stringify(schemaPath)}, out: ${JSON.stringify(relative(projectDir, out))} })\n`,
  )
  const before = listFiles(out)
  const stdout = execFileSync(drizzleKit, ['generate', '--config', config, ...extraArgs], {
    cwd: projectDir,
    encoding: 'utf8',
  })
  return { out, before, after: listFiles(out), stdout }
}

describe('drizzle-kit generate over the committed migrations', () => {
  it('finds nothing to migrate, even with the hand-written trigger migration in the chain', () => {
    const run = generateOnCopy('no-change', join(projectDir, 'src/schema.ts'))

    expect(
      run.before.map((path) => path.slice(path.indexOf('migrations/') + 'migrations/'.length)),
    ).toEqual([
      '0000_init.sql',
      '0001_triggers.sql',
      'meta/0000_snapshot.json',
      'meta/0001_snapshot.json',
      'meta/_journal.json',
    ])
    expect(run.stdout).toContain('No schema changes, nothing to migrate')
    expect(run.after).toEqual(run.before)
  })

  it('writes exactly one ALTER TABLE ADD for a new nullable column, and no DROP TRIGGER', () => {
    const original = readFileSync(join(projectDir, 'src/schema.ts'), 'utf8')
    const changed = original.replace(
      "createdAt: text('created_at').notNull(),",
      "createdAt: text('created_at').notNull(),\n  wordCount: integer('word_count'),",
    )
    expect(changed).not.toBe(original)
    const schemaPath = join(scratch, 'schema-with-word-count.ts')
    writeFileSync(schemaPath, changed)

    const run = generateOnCopy('drift', schemaPath, ['--name', 'drift'])

    expect(
      run.after
        .filter((path) => !run.before.includes(path))
        .map((path) => path.split('/').slice(-2).join('/')),
    ).toEqual(['migrations/0002_drift.sql', 'meta/0002_snapshot.json'])
    expect(readFileSync(join(run.out, '0002_drift.sql'), 'utf8')).toBe(
      'ALTER TABLE `revisions` ADD `word_count` integer;',
    )
  })
})
