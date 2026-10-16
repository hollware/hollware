// Fails when:
// - "hollware --help prints the usage …" / "does the same with no arguments": the usage of
//   `src/index.ts` stops being printed on out with exit code 0 (or is printed on err).
// - "lists every command with what it does": a command is dropped from COMMANDS, or `export`
//   stops saying it is not implemented yet.
// - "--help of each command …" / "shows the usage of token when it gets no subcommand": a
//   command stops handling `--help` before it looks at anything else (a missing option,
//   wrangler, the network), or `token` alone stops printing its usage.
// - "the usage of each command names its options": an option disappears from a command's usage.
// - "hollware --version …": `readVersion` (src/version.ts) stops reading the package.json next
//   to the module, or the output loses the name; the throw test: it stops throwing without a
//   version.
// - "an unknown argument …": `main` stops answering an unknown first argument with the usage on
//   err and exit code 1, or stops cleaning control characters out of what it repeats.
// - "does not take a name of Object.prototype for a command": the commands are looked up in an
//   object, so `constructor` or `toString` runs.
// - "export says it is not implemented yet": `export` starts doing something else.
// - "names the command, and the subcommand, in front of an error …": `main` stops prefixing
//   errors with the command words, or stops pointing at `--help` after a mistake in the arguments.
// - "names only the command when the subcommand is not one": an unknown subcommand is named as
//   if it were one.
// - "adds no pointer to the help to an error that is not a mistake …": the pointer is added to
//   every CliError.
// - "lets an error that is not a CliError escape": `main` catches everything.
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import type { main } from '../src/index.ts'
import { createIo, run, type Outcome } from './support/io.ts'
import { install, type Install } from './support/install.ts'
import { tempDirs } from './support/project.ts'

const temp = tempDirs()
const installs: Install[] = []

afterEach(() => {
  for (const installed of installs.splice(0)) installed.remove()
})

// Loads a copy of the module that sits next to a package.json the test controls.
async function loadFrom(manifest: object): Promise<typeof main> {
  const installed = install(manifest)
  installs.push(installed)
  const loaded: typeof import('../src/index.ts') = await import(
    pathToFileURL(installed.module).href
  )
  return loaded.main
}

async function runWith(cli: typeof main, argv: string[]): Promise<Outcome> {
  const { io, out, err } = createIo()
  const code = await cli(argv, io)
  return { code, out, err }
}

const COMMANDS_HELP = [
  ['init', ['--site', '--local', '--remote', '--owner-name', '--url', '--database']],
  ['migrate', ['--local', '--remote', '--check', '--database']],
  ['deploy', ['--url']],
  ['doctor', ['--local', '--remote']],
  ['token', ['create', 'list', 'revoke']],
  [
    'token create',
    [
      '--label',
      '--scopes',
      '--read',
      '--expires-in-days',
      '--site',
      '--local',
      '--remote',
      '--database',
    ],
  ],
  ['token list', ['--site', '--local', '--remote', '--database']],
  ['token revoke', ['<id>', '--site', '--local', '--remote', '--database']],
  [
    'invite',
    ['--role', '--owner', '--days', '--url', '--site', '--local', '--remote', '--database'],
  ],
  ['import', ['<directory>', '--url', '--token-file', '--publish', '--dry-run']],
] as const

describe('hollware --help', () => {
  it('prints the usage on out and exits 0', async () => {
    const { code, out, err } = await run(['--help'])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([expect.stringContaining('Usage: hollware <command>')])
  })

  it('does the same with no arguments', async () => {
    const { code, out, err } = await run([])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([expect.stringContaining('Usage: hollware <command>')])
  })

  it('lists every command with what it does', async () => {
    const [usage] = (await run(['--help'])).out
    expect(usage?.split('\n').slice(2, 11)).toEqual([
      'Commands:',
      "  init     Set up a site, its owner and a first token in the project's D1 database",
      '  migrate  Apply D1 migrations',
      '  deploy   Deploy to Cloudflare and migrate the remote database',
      '  doctor   Check the project, its bindings, its database and its owner',
      '  token    Create, list and revoke personal tokens',
      '  invite   Invite a person to the admin, as an editor or an author',
      '  import   Import Markdown files over MCP',
      '  export   Export entries as Markdown files (planned for v0.2, not implemented yet)',
    ])
  })
})

describe('--help of each command', () => {
  it.each(COMMANDS_HELP)('prints the usage of %s and touches nothing', async (command) => {
    const { code, out, err } = await run([...command.split(' '), '--help'])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([expect.stringMatching(new RegExp(`^Usage: hollware ${command}\\b`))])
  })

  it('shows the usage of token when it gets no subcommand', async () => {
    const { code, out } = await run(['token'])
    expect(code).toBe(0)
    expect(out).toEqual([expect.stringMatching(/^Usage: hollware token <command>/)])
  })

  it.each(COMMANDS_HELP)('the usage of %s names its options', async (command, options) => {
    const [usage] = (await run([...command.split(' '), '--help'])).out
    for (const option of options) expect(usage).toContain(option)
  })
})

describe('hollware --version', () => {
  it('prints the name and the version in the package.json next to the module', async () => {
    const cli = await loadFrom({ name: 'hollware', version: '7.8.9' })
    expect(await runWith(cli, ['--version'])).toEqual({
      code: 0,
      out: ['hollware 7.8.9'],
      err: [],
    })
  })

  it('throws when that package.json has no version', async () => {
    const cli = await loadFrom({ name: 'hollware' })
    await expect(runWith(cli, ['--version'])).rejects.toThrow('package.json has no version')
  })
})

describe('hollware with an unknown argument', () => {
  it.each(['--bogus', 'frobnicate'])(
    'rejects %s with the usage on err and exit code 1',
    async (arg) => {
      const { code, out, err } = await run([arg])
      expect(code).toBe(1)
      expect(out).toEqual([])
      expect(err).toEqual([expect.stringContaining(`hollware: unknown command or flag "${arg}"`)])
      expect(err[0]).toContain('Usage: hollware <command>')
    },
  )

  it('does not let a control character through when it repeats the argument', async () => {
    const { err } = await run(['\u001B[31mred'])
    expect(err[0]?.split('\n')[0]).toBe('hollware: unknown command or flag "?[31mred"')
  })

  it('does not take a name of Object.prototype for a command', async () => {
    const { code, err } = await run(['constructor'])
    expect(code).toBe(1)
    expect(err[0]).toContain('unknown command or flag "constructor"')
  })
})

describe('hollware export', () => {
  it('says it is not implemented yet and exits 1', async () => {
    expect(await run(['export'])).toEqual({
      code: 1,
      out: [],
      err: ['hollware export: not implemented yet (planned for v0.2)'],
    })
  })
})

describe('an error of a command', () => {
  it('names the command, and the subcommand, in front of it, and points at the help after a mistake in the arguments', async () => {
    expect(await run(['token', 'create'])).toEqual({
      code: 1,
      out: [],
      err: [
        'hollware token create: --label is required: say what the token is for, such as "ci" or "claude-code". Run "hollware token create --help" for the options.',
      ],
    })
    expect((await run(['init'])).err).toEqual([
      'hollware init: --site is required: name the site, such as --site my-site. Run "hollware init --help" for the options.',
    ])
  })

  it('names only the command when the subcommand is not one', async () => {
    expect((await run(['token', 'frob'])).err).toEqual([
      'hollware token: unknown command "frob": use create, list or revoke. Run "hollware token --help" for the options.',
    ])
  })

  it('adds no pointer to the help to an error that is not a mistake in the arguments', async () => {
    const cwd = temp.make()
    expect((await run(['init', '--site', 'blog'], { cwd })).err).toEqual([
      `hollware init: there is no wrangler.jsonc in ${cwd}. Run hollware from the project directory, or name the D1 database with --database <name>.`,
    ])
  })

  it('lets an error that is not a CliError escape', async () => {
    await expect(
      run(['init', '--site', 'blog', '--database', 'DB'], {
        wrangler: () => Promise.reject(new Error('boom')),
      }),
    ).rejects.toThrow('boom')
  })
})
