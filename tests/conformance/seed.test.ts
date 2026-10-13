import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { cliCommand, localState, readToken, resetLocalState } from './seed.ts'

// Fails when: the token stops being read from the line of the output of `hollware init` that holds
// only a token (the CLI prints it once, among the ids of the owner and of the token, which have
// other prefixes), or an output with no token or with two is accepted; the run stops starting the
// bin that packages/cli/package.json names, or accepts a manifest without one; or a run stops
// clearing the local state of the Worker, which makes `hollware init` refuse the second run, and
// clears more than that state.

/** The output of `hollware init --local --site conformance`, as the CLI of this repository prints it. */
const INIT_OUTPUT = [
  'Hollware is ready on the local database "DB".',
  '',
  'Site     conformance',
  'Owner    usr_01M4T3W9NKFZ0FFJ7MQ8P1N7YY',
  'Token    tok_01M4T3W9NMP7N5NX51STBQ7KM4',
  'Scopes   content:read content:write content:publish schema:admin',
  'Expires  2027-01-11T07:50:50.802Z (in 90 days)',
  '',
  'Your personal token. It is shown only once: Hollware keeps just its hash.',
  '',
  'hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk',
  '',
  'Next:',
  '  Save the token in a file only you can read, then import content:',
  '    hollware import <directory> --url <your Hollware URL> --token-file <file>',
  '  An MCP client sends it as the header "Authorization: Bearer <token>" to <your Hollware URL>/mcp.',
  '  More tokens: hollware token create --label <text>',
].join('\n')

describe('readToken', () => {
  it('takes the line that holds only the personal token', () => {
    expect(readToken(INIT_OUTPUT)).toBe(
      'hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk',
    )
  })

  it('refuses an output with no token, and one with two', () => {
    expect(() => readToken(INIT_OUTPUT.replace(/^hw_pat_.*$/m, ''))).toThrow(
      'the output of "hollware init" does not hold exactly one personal token',
    )
    const second = 'hw_pat_0000000000000000000000000000000000000000000000000000'
    expect(() => readToken(`${INIT_OUTPUT}\n${second}`)).toThrow(
      'the output of "hollware init" does not hold exactly one personal token',
    )
  })

  it('does not take a token that is part of a longer line', () => {
    expect(() =>
      readToken('Token hw_pat_0123456789abcdefghjkmnpqrstvwxyz0123456789abcdefghjk'),
    ).toThrow('does not hold exactly one personal token')
  })
})

describe('the bin of the CLI', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true })
  })
  const repositoryWith = (manifest: unknown) => {
    const root = mkdtempSync(join(tmpdir(), 'hollware-conformance-test-'))
    directories.push(root)
    mkdirSync(join(root, 'packages', 'cli'), { recursive: true })
    writeFileSync(join(root, 'packages', 'cli', 'package.json'), JSON.stringify(manifest))
    return root
  }

  it('is run by Node from the path that the manifest of packages/cli gives', () => {
    const root = repositoryWith({ bin: { hollware: './src/main.ts' } })
    expect(cliCommand(root)).toEqual({
      command: process.execPath,
      args: [join(root, 'packages', 'cli', 'src', 'main.ts')],
    })
  })

  it('is the source of the real CLI in this repository', () => {
    const repository = join(import.meta.dirname, '..', '..')
    expect(cliCommand(repository).args).toEqual([
      join(repository, 'packages', 'cli', 'src', 'index.ts'),
    ])
  })

  it('refuses a manifest that names no bin called hollware', () => {
    for (const manifest of [{}, { bin: './src/index.ts' }, { bin: { other: './x.ts' } }]) {
      expect(() => cliCommand(repositoryWith(manifest))).toThrow(
        'packages/cli/package.json names no bin "hollware"',
      )
    }
  })
})

describe('the local state of the Worker', () => {
  it('is cleared whole and nothing else of .wrangler', () => {
    const worker = mkdtempSync(join(tmpdir(), 'hollware-conformance-test-'))
    try {
      mkdirSync(join(localState(worker), 'v3', 'd1'), { recursive: true })
      writeFileSync(join(localState(worker), 'v3', 'd1', 'db.sqlite'), 'rows')
      mkdirSync(join(worker, '.wrangler', 'logs'), { recursive: true })
      resetLocalState(worker)
      expect(existsSync(localState(worker))).toBe(false)
      expect(existsSync(join(worker, '.wrangler', 'logs'))).toBe(true)
      expect(() => {
        resetLocalState(worker)
      }).not.toThrow()
    } finally {
      rmSync(worker, { recursive: true, force: true })
    }
  })

  it('lives under .wrangler/state of the Worker, where wrangler dev and the CLI both keep it', () => {
    expect(localState('/the/worker')).toBe('/the/worker/.wrangler/state')
  })
})
