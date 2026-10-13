// Fails when:
// - "--check lists the pending migrations and exits 1": `--check` stops listing the names,
//   exits 0 with migrations pending, applies them, or changes the arguments of the list call.
// - "--check exits 0 when nothing is pending": the exit code of `--check` is wrong for none.
// - "applies the pending migrations with wrangler and lists them": `migrate` stops calling
//   `wrangler d1 migrations apply`, or applies without listing first, or the output changes.
// - "does nothing when there is nothing to apply": `apply` (or a backup) runs when the list is
//   empty, so a deploy that runs `migrate --remote` every time would lock the database for
//   nothing.
// - "says 1 migration, not 1 migrations": the plural is wrong.
// - "backs up the remote database before it applies anything": the backup before `--remote` is
//   removed, moved after `apply`, or its arguments or file name change.
// - "stops when the backup fails": a failed `wrangler d1 export` does not stop `apply`.
// - "stops when wrangler says it exported but wrote nothing" rows: a missing or empty backup
//   file does not stop `apply`.
// - "takes no backup when nothing is pending" / "takes no backup to only check": the backup is
//   taken before the list says there is something to apply, or in `--check`.
// - "says what is left when applying fails": the failure of `apply` is not reported with its
//   reason, or the backup path is not given for a remote run.
// - "fails when wrangler cannot list the migrations": a failed `list` is taken for "up to date".
// - "does not take an answer it does not know for up to date": an output that says neither
//   "No migrations to apply!" nor lists names is read as nothing pending.
// - "parsePendingMigrations" rows: the table of `wrangler d1 migrations list` is not read with
//   its colors, ASCII borders, CRLF line ends, or skips the header row.
// - "uses --database for every call": `--database` is not given to every wrangler command and
//   the backup name.
// - "rejects --local and --remote together": both flags are accepted.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { parsePendingMigrations } from '../src/commands/migrate.ts'
import { exportsTo, failed, fakeWrangler, ok, type FakeWrangler } from './support/fake-wrangler.ts'
import { run } from './support/io.ts'
import { tempDirs, WRANGLER_JSONC } from './support/project.ts'

const temp = tempDirs()

// What wrangler 4.149.0 printed, captured against the migrations of @hollware/server.
const LIST_ALL_PENDING =
  '\n ⛅️ wrangler 4.149.0\n────────────────────\nResource location: local \n\nUse --remote if you want to access the remote instance.\n\nMigrations to be applied:\n┌──────────────────────┐\n│ Name                 │\n├──────────────────────┤\n│ 0000_init.sql        │\n├──────────────────────┤\n│ 0001_core.sql        │\n├──────────────────────┤\n│ 0002_append_only.sql │\n└──────────────────────┘\n'
const LIST_NONE =
  '\n ⛅️ wrangler 4.149.0\n────────────────────\nResource location: local \n\nUse --remote if you want to access the remote instance.\n\n✅ No migrations to apply!\n'
const LIST_ONE_PENDING =
  '\n ⛅️ wrangler 4.149.0\n────────────────────\nResource location: local \n\nUse --remote if you want to access the remote instance.\n\nMigrations to be applied:\n┌─────────────────┐\n│ Name            │\n├─────────────────┤\n│ 0003_notes.sql  │\n└─────────────────┘\n'
const APPLIED = '🌀 Executing on local database DB ...\n🚣 10 commands executed successfully.\n'

const NAMES = ['0000_init.sql', '0001_core.sql', '0002_append_only.sql']
const BACKUP = '.wrangler/hollware-backups/DB-20261012T120000Z.sql'

function setup(
  wrangler: FakeWrangler,
  files: Record<string, string> = { 'wrangler.jsonc': WRANGLER_JSONC },
) {
  const cwd = temp.make(files)
  return {
    cwd,
    backup: join(cwd, BACKUP),
    run: (argv: string[]) => run(argv, { cwd, wrangler: wrangler.run }),
  }
}

describe('hollware migrate --check', () => {
  it('lists the pending migrations and exits 1', async () => {
    const wrangler = fakeWrangler(ok(LIST_ALL_PENDING))
    const project = setup(wrangler)

    expect(await project.run(['migrate', '--check'])).toEqual({
      code: 1,
      out: [
        '3 migrations pending on the local database "DB":\n  0000_init.sql\n  0001_core.sql\n  0002_append_only.sql',
      ],
      err: [
        'hollware migrate: 3 migrations pending. Run "hollware migrate --local" to apply them.',
      ],
    })
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['d1', 'migrations', 'list', 'DB', '--local'],
    ])
  })

  it('exits 0 when nothing is pending', async () => {
    const wrangler = fakeWrangler(ok(LIST_NONE))
    const project = setup(wrangler)

    expect(await project.run(['migrate', '--check'])).toEqual({
      code: 0,
      out: ['No pending migrations on the local database "DB".'],
      err: [],
    })
  })

  it('takes no backup to only check, even for the remote database', async () => {
    const wrangler = fakeWrangler(ok(LIST_ALL_PENDING))
    const project = setup(wrangler)

    const { code, err } = await project.run(['migrate', '--check', '--remote'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware migrate: 3 migrations pending. Run "hollware migrate --remote" to apply them.',
    ])
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['d1', 'migrations', 'list', 'DB', '--remote'],
    ])
    expect(existsSync(join(project.cwd, '.wrangler'))).toBe(false)
  })
})

describe('hollware migrate', () => {
  it('applies the pending migrations with wrangler and lists them', async () => {
    const wrangler = fakeWrangler(ok(LIST_ALL_PENDING), ok(APPLIED))
    const project = setup(wrangler)

    expect(await project.run(['migrate'])).toEqual({
      code: 0,
      out: [
        'Applied 3 migrations to the local database "DB":\n  0000_init.sql\n  0001_core.sql\n  0002_append_only.sql',
      ],
      err: [],
    })
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['d1', 'migrations', 'list', 'DB', '--local'],
      ['d1', 'migrations', 'apply', 'DB', '--local'],
    ])
  })

  it('says 1 migration, not 1 migrations', async () => {
    const wrangler = fakeWrangler(ok(LIST_ONE_PENDING), ok(APPLIED))
    const project = setup(wrangler)

    const { out } = await project.run(['migrate'])

    expect(out).toEqual(['Applied 1 migration to the local database "DB":\n  0003_notes.sql'])
  })

  it.each(['--local', '--remote'])(
    'does nothing when there is nothing to apply (%s)',
    async (flag) => {
      const wrangler = fakeWrangler(ok(LIST_NONE))
      const project = setup(wrangler)

      const { code, out, err } = await project.run(['migrate', flag])

      expect(code).toBe(0)
      expect(out).toEqual([`No pending migrations on the ${flag.slice(2)} database "DB".`])
      expect(err).toEqual([])
      expect(wrangler.calls.map((call) => call.args)).toEqual([
        ['d1', 'migrations', 'list', 'DB', flag],
      ])
      expect(existsSync(join(project.cwd, '.wrangler'))).toBe(false)
    },
  )

  it('backs up the remote database before it applies anything', async () => {
    const wrangler = fakeWrangler(
      ok(LIST_ALL_PENDING),
      exportsTo('-- the database --\n'),
      ok(APPLIED),
    )
    const project = setup(wrangler)

    const { code, out, err } = await project.run(['migrate', '--remote'])

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['d1', 'migrations', 'list', 'DB', '--remote'],
      ['d1', 'export', 'DB', '--remote', '--output', project.backup, '--skip-confirmation'],
      ['d1', 'migrations', 'apply', 'DB', '--remote'],
    ])
    expect(out).toEqual([
      `Backing up the remote database "DB" to ${project.backup} ...`,
      `Applied 3 migrations to the remote database "DB":\n  0000_init.sql\n  0001_core.sql\n  0002_append_only.sql\nBackup taken before: ${project.backup}`,
    ])
    expect(readFileSync(project.backup, 'utf8')).toBe('-- the database --\n')
  })

  it('stops when the backup fails, and applies nothing', async () => {
    const wrangler = fakeWrangler(
      ok(LIST_ALL_PENDING),
      failed(
        '\u001B[31m✘ \u001B[41;31m[\u001B[41;97mERROR\u001B[41;31m]\u001B[0m \u001B[1mD1 reset before export completed!\u001B[0m\n',
      ),
    )
    const project = setup(wrangler)

    const { code, err } = await project.run(['migrate', '--remote'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware migrate: the backup of the remote database "DB" failed, so no migration was applied: D1 reset before export completed!',
    ])
    expect(wrangler.calls.map((call) => call.args[1])).toEqual(['migrations', 'export'])
  })

  it.each([
    ['nothing', undefined],
    ['an empty file', ''],
  ])('stops when wrangler says it exported but wrote %s', async (_what, content) => {
    const wrangler = fakeWrangler(
      ok(LIST_ALL_PENDING),
      content === undefined ? ok('Not exporting.') : exportsTo(content),
    )
    const project = setup(wrangler)

    const { code, err } = await project.run(['migrate', '--remote'])

    expect(code).toBe(1)
    expect(err).toEqual([
      `hollware migrate: wrangler reported success but wrote no backup to ${project.backup}, so no migration was applied. Check "wrangler d1 export DB --remote --output <file>" by hand.`,
    ])
    expect(wrangler.calls.map((call) => call.args[1])).toEqual(['migrations', 'export'])
  })

  it('says what is left when applying fails, and where the backup is for a remote run', async () => {
    const local = fakeWrangler(
      ok(LIST_ALL_PENDING),
      failed('✘ [ERROR] near "CREATE": syntax error\n'),
    )
    const localProject = setup(local)
    expect((await localProject.run(['migrate'])).err).toEqual([
      'hollware migrate: wrangler stopped while applying the migrations: near "CREATE": syntax error. The migrations before the failing one stay applied; "hollware migrate --check" shows what is left.',
    ])

    const remote = fakeWrangler(
      ok(LIST_ALL_PENDING),
      exportsTo('-- backup --'),
      failed('✘ [ERROR] near "CREATE": syntax error\n'),
    )
    const remoteProject = setup(remote)
    const { code, out, err } = await remoteProject.run(['migrate', '--remote'])
    expect(code).toBe(1)
    expect(out).toEqual([`Backing up the remote database "DB" to ${remoteProject.backup} ...`])
    expect(err).toEqual([
      `hollware migrate: wrangler stopped while applying the migrations: near "CREATE": syntax error. The migrations before the failing one stay applied; "hollware migrate --check" shows what is left. The backup taken before is in ${remoteProject.backup}.`,
    ])
  })

  it('fails when wrangler cannot list the migrations', async () => {
    const wrangler = fakeWrangler(
      failed('✘ [ERROR] No migrations present at /project/migrations.\n'),
    )
    const project = setup(wrangler)

    expect(await project.run(['migrate'])).toEqual({
      code: 1,
      out: [],
      err: [
        'hollware migrate: wrangler could not list the migrations: No migrations present at /project/migrations.',
      ],
    })
  })

  it('does not take an answer it does not know for up to date', async () => {
    const wrangler = fakeWrangler(ok('\n ⛅️ wrangler 9.0.0\nEverything is fine.\n'))
    const project = setup(wrangler)

    const { code, out, err } = await project.run(['migrate'])

    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([
      'hollware migrate: could not read the answer of "wrangler d1 migrations list": it neither says that there is nothing to apply nor lists the pending migrations. Is the wrangler of this project a version hollware does not know?',
    ])
    expect(wrangler.calls).toHaveLength(1)
  })

  it('uses --database for every call and for the name of the backup', async () => {
    const wrangler = fakeWrangler(ok(LIST_ALL_PENDING), exportsTo('-- backup --'), ok(APPLIED))
    const project = setup(wrangler, {})

    const { code } = await project.run(['migrate', '--remote', '--database', 'blog-db'])

    const backup = join(project.cwd, '.wrangler/hollware-backups/blog-db-20261012T120000Z.sql')
    expect(code).toBe(0)
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['d1', 'migrations', 'list', 'blog-db', '--remote'],
      ['d1', 'export', 'blog-db', '--remote', '--output', backup, '--skip-confirmation'],
      ['d1', 'migrations', 'apply', 'blog-db', '--remote'],
    ])
  })

  it('rejects --local and --remote together', async () => {
    const wrangler = fakeWrangler()
    const project = setup(wrangler)

    const { code, err } = await project.run(['migrate', '--local', '--remote'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware migrate: --local and --remote cannot be used together: choose one. Run "hollware migrate --help" for the options.',
    ])
    expect(wrangler.calls).toEqual([])
  })
})

describe('parsePendingMigrations', () => {
  it('reads the names in the table and skips its header', () => {
    expect(parsePendingMigrations(LIST_ALL_PENDING)).toEqual(NAMES)
  })

  it('reads nothing pending', () => {
    expect(parsePendingMigrations(LIST_NONE)).toEqual([])
  })

  it('reads a table with colors, ASCII borders and CRLF line ends', () => {
    const text = [
      '\u001B[1mMigrations to be applied:\u001B[0m',
      '+---------------+',
      '| Name          |',
      '+---------------+',
      '| 0001_core.sql |',
      '+---------------+',
      '',
    ].join('\r\n')
    expect(parsePendingMigrations(text)).toEqual(['0001_core.sql'])
  })

  it.each([
    ['an answer of another kind', 'Everything is fine.'],
    ['a table with no row', 'Migrations to be applied:\n┌────┐\n│ Name │\n└────┘\n'],
    ['nothing at all', ''],
  ])('refuses %s', (_what, text) => {
    expect(() => parsePendingMigrations(text)).toThrow(
      'could not read the answer of "wrangler d1 migrations list"',
    )
  })
})
