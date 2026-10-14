// Fails when:
// - "chooseTarget …": the default stops being the local database, `--remote` stops choosing the
//   remote one, or both flags together are accepted.
// - "resolveDatabase reads the binding DB …" (config rows): the CLI stops reading `wrangler.jsonc`
//   or `wrangler.json` as JSON with comments, takes another binding than `DB`, or an error
//   stops saying what to do (no file, `wrangler.toml`, no D1 database, another binding, a file
//   that is not JSON, a shape that is not wrangler's).
// - "resolveDatabase takes --database as it is and reads no file": `--database` stops winning
//   over the config, or the config is read anyway.
// - "resolveDatabase refuses a --database that wrangler would take for an option": the name is
//   no longer validated.
// - "query runs wrangler d1 execute with --json and returns the rows of each statement": the
//   arguments given to wrangler change (the order, `--json`, `--command`), or the rows are not
//   returned statement by statement.
// - "query names the target in the arguments": `--remote` is not passed, or the database is not.
// - "runFile runs a SQL file in one execute": the arguments of the file run change.
// - "a failed query …" rows: the reason of a failure stops reaching the message, a missing
//   table stops being reported with `hollware migrate`, or an answer that is not JSON, has
//   another shape or says a statement did not succeed is accepted.
// - "names the target and the database in the command that creates the tables": the hint to
//   migrate forgets `--remote` or `--database`.
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { chooseTarget, query, resolveDatabase, runFile } from '../src/d1.ts'
import { CliError, UsageError } from '../src/errors.ts'
import { d1, d1Failed, failed, fakeWrangler, ok } from './support/fake-wrangler.ts'
import { tempDirs, WRANGLER_JSONC } from './support/project.ts'

const temp = tempDirs()

describe('chooseTarget', () => {
  it('chooses the local database unless told otherwise', () => {
    expect(chooseTarget({})).toBe('local')
    expect(chooseTarget({ local: true })).toBe('local')
    expect(chooseTarget({ remote: true })).toBe('remote')
  })

  it('refuses both flags together', () => {
    expect(() => chooseTarget({ local: true, remote: true })).toThrow(UsageError)
    expect(() => chooseTarget({ local: true, remote: true })).toThrow(
      '--local and --remote cannot be used together: choose one.',
    )
  })
})

describe('resolveDatabase reads the binding DB of the wrangler config', () => {
  it.each(['wrangler.jsonc', 'wrangler.json'])('from %s, with its comments', (file) => {
    const cwd = temp.make({ [file]: WRANGLER_JSONC })
    expect(resolveDatabase(cwd, undefined)).toBe('DB')
  })

  it('finds DB among several bindings', () => {
    const cwd = temp.make({
      'wrangler.jsonc': '{ "d1_databases": [ { "binding": "CONTENT" }, { "binding": "DB" } ] }',
    })
    expect(resolveDatabase(cwd, undefined)).toBe('DB')
  })

  it.each([
    [
      'there is no file',
      {},
      (cwd: string) =>
        `there is no wrangler.jsonc in ${cwd}. Run hollware from the project directory, or name the D1 database with --database <name>.`,
    ],
    [
      'there is only a wrangler.toml',
      { 'wrangler.toml': 'name = "x"' },
      (cwd: string) =>
        `there is no wrangler.jsonc in ${cwd} (wrangler.toml is not read). Run hollware from the project directory, or name the D1 database with --database <name>.`,
    ],
    [
      'the config has no D1 database',
      { 'wrangler.jsonc': '{ "name": "x" }' },
      (cwd: string) =>
        `${cwd}/wrangler.jsonc has no D1 database. Add a D1 binding named "DB" (the starter has one), or name the database with --database <name>.`,
    ],
    [
      'the only binding has another name',
      { 'wrangler.jsonc': '{ "d1_databases": [{ "binding": "CONTENT" }, { "binding": "LOGS" }] }' },
      (cwd: string) =>
        `${cwd}/wrangler.jsonc has no D1 binding named "DB" (it has CONTENT, LOGS). Rename the binding, or choose one with --database <name or binding>.`,
    ],
    [
      'the file is not JSON',
      { 'wrangler.jsonc': '{ "name": ' },
      (cwd: string) =>
        `${cwd}/wrangler.jsonc is not valid JSON with comments: Unexpected end of JSON input`,
    ],
    [
      'the bindings are not a list',
      { 'wrangler.jsonc': '{ "d1_databases": "DB" }' },
      (cwd: string) =>
        `${cwd}/wrangler.jsonc has an unexpected shape at "d1_databases": Invalid input: expected array, received string`,
    ],
  ])('says what to do when %s', (_when, files, message) => {
    const cwd = temp.make(files)
    expect(() => resolveDatabase(cwd, undefined)).toThrow(new CliError(message(cwd)))
  })

  it('takes --database as it is and reads no file', () => {
    const cwd = temp.make()
    expect(resolveDatabase(cwd, 'my-other-db')).toBe('my-other-db')
    const withConfig = temp.make({ 'wrangler.jsonc': WRANGLER_JSONC })
    expect(resolveDatabase(withConfig, 'my-other-db')).toBe('my-other-db')
  })

  it('refuses a --database that wrangler would take for an option', () => {
    expect(() => resolveDatabase(temp.make(), '--local')).toThrow(UsageError)
  })
})

describe('query', () => {
  it('runs wrangler d1 execute with --json and returns the rows of each statement', async () => {
    const wrangler = fakeWrangler(d1([{ id: 'blog' }], [], [{ id: 'a' }, { id: 'b' }]))
    const rows = await query(wrangler.run, 'DB', 'local', 'SELECT 1; SELECT 2; SELECT 3;')
    expect(rows).toEqual([[{ id: 'blog' }], [], [{ id: 'a' }, { id: 'b' }]])
    expect(wrangler.calls.map((call) => call.args)).toEqual([
      ['d1', 'execute', 'DB', '--local', '--json', '--command', 'SELECT 1; SELECT 2; SELECT 3;'],
    ])
  })

  it('names the target in the arguments', async () => {
    const wrangler = fakeWrangler(d1([]))
    await query(wrangler.run, 'my-db', 'remote', 'SELECT 1')
    expect(wrangler.calls[0]?.args).toEqual([
      'd1',
      'execute',
      'my-db',
      '--remote',
      '--json',
      '--command',
      'SELECT 1',
    ])
  })
})

describe('runFile', () => {
  it('runs a SQL file in one execute', async () => {
    const directory = temp.make({ 'init.sql': 'SELECT 1;\nSELECT 2;\n' })
    const file = join(directory, 'init.sql')
    const wrangler = fakeWrangler(d1([], []))
    await runFile(wrangler.run, 'DB', 'remote', file)
    expect(wrangler.calls.map(({ args, sql }) => ({ args, sql }))).toEqual([
      {
        args: ['d1', 'execute', 'DB', '--remote', '--json', '--file', file],
        sql: 'SELECT 1;\nSELECT 2;\n',
      },
    ])
  })
})

describe('an answer after a warning of wrangler', () => {
  it('is read from the line that opens its JSON', async () => {
    const wrangler = fakeWrangler(
      ok(
        '▲ [WARNING] Please add "services" to "env.demo".\n\n[{"results":[{"n":1}],"success":true}]',
      ),
    )

    expect(await query(wrangler.run, 'DB', 'remote', 'SELECT 1 AS n')).toEqual([[{ n: 1 }]])
  })
})

describe('a failed query', () => {
  it.each([
    [
      'says why, from the JSON error of wrangler',
      d1Failed('UNIQUE constraint failed: sites.id: SQLITE_CONSTRAINT'),
      'wrangler could not run the SQL: UNIQUE constraint failed: sites.id: SQLITE_CONSTRAINT',
    ],
    [
      'says why, from the [ERROR] of wrangler, without its colors',
      failed(
        '\u001B[31m✘ \u001B[41;31m[\u001B[41;97mERROR\u001B[41;31m]\u001B[0m \u001B[1mNo config\u001B[0m\n',
      ),
      'wrangler could not run the SQL: No config',
    ],
    [
      'tells how to create the tables when they are missing',
      d1Failed('no such table: users: SQLITE_ERROR'),
      'the database has no Hollware tables yet. Run "hollware migrate --local" first.',
    ],
    [
      'rejects an answer that is not JSON',
      ok('Executed 1 command'),
      'wrangler did not answer with JSON: Executed 1 command',
    ],
    [
      'rejects an answer with another shape',
      ok('{"results":[]}'),
      'wrangler answered with JSON that has an unexpected shape.',
    ],
    [
      'rejects a statement that did not succeed',
      ok('[{"results":[],"success":false}]'),
      'wrangler reported that a statement did not succeed.',
    ],
  ])('%s', async (_what, answer, message) => {
    const wrangler = fakeWrangler(answer)
    await expect(query(wrangler.run, 'DB', 'local', 'SELECT 1')).rejects.toThrow(
      new CliError(message),
    )
  })

  it('names the target and the database in the command that creates the tables', async () => {
    const wrangler = fakeWrangler(d1Failed('no such table: tokens: SQLITE_ERROR'))
    await expect(query(wrangler.run, 'blog-db', 'remote', 'SELECT 1')).rejects.toThrow(
      new CliError(
        'the database has no Hollware tables yet. Run "hollware migrate --remote --database blog-db" first.',
      ),
    )
  })
})
