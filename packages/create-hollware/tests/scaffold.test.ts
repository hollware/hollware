import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vite-plus/test'

import { starterTemplate } from '../../../scripts/sync-starter.ts'
import { create, type Io, type RunResult } from '../src/scaffold.ts'

// Fails when: create-hollware stops making the project its own (the name of the Worker, its
// database and its queues, the key of the site, Hollware's exact version for every Hollware
// dependency, a .gitignore), writes into a directory that is not empty, stops running git init,
// pnpm's allowed build scripts when pnpm installs, the install, the migrations and init in that order and in the project, stops printing init's
// answer and the `claude mcp add` line, stops handing --preset, --locales, --ip-addresses and --audit-retention-days to init, with the token, or goes on after a step failed. The
// the `claude mcp add` line stops having the JSON block (.mcp.json, naming HOLLWARE_TOKEN) beside it, or the passkey stops reading as optional for an agent, or --token-file is not handed to init as an absolute path, or an existing token file is not refused before anything is made, or one inside the project is not ignored by git, or --json prints anything but one object. The
// programs it runs are not ours, so they are the one thing faked; the template is the real one,
// made from templates/starter.

const REPO = resolve(import.meta.dirname, '../../..')
const TOKEN = `hw_pat_${'a'.repeat(52)}`
const INIT_ANSWER = `Hollware is ready on the local database "DB".\n\n${TOKEN}\n`

let template: string
const scratch: string[] = []

beforeAll(() => {
  template = mkdtempSync(join(tmpdir(), 'create-hollware-template-'))
  scratch.push(template)
  for (const [path, content] of starterTemplate(REPO)) {
    mkdirSync(dirname(join(template, path)), { recursive: true })
    writeFileSync(join(template, path), content)
  }
})

afterEach(() => {
  for (const directory of scratch.splice(1)) rmSync(directory, { recursive: true, force: true })
})

interface Call {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

function world(answers: Partial<Record<string, RunResult>> = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'create-hollware-'))
  scratch.push(cwd)
  const calls: Call[] = []
  const out: string[] = []
  const io: Io = {
    out: (message) => out.push(message),
    err: () => undefined,
    cwd,
    templateDir: template,
    version: '0.4.0',
    run: async (command, args, at) => {
      calls.push({ command, args, cwd: at })
      const key = `${command.split('/').at(-1)} ${args[0]}`
      return (
        answers[key] ?? { code: 0, stdout: key === 'hollware init' ? INIT_ANSWER : '', stderr: '' }
      )
    },
  }
  const read = (path: string) => readFileSync(join(cwd, 'blog-cms', path), 'utf8')
  return { cwd, calls, out, io, read }
}

describe('create-hollware <dir>', () => {
  it('makes the project its own: names, site, exact versions and a .gitignore', async () => {
    const { io, read, cwd } = world()

    await create(['blog-cms', '--site', 'blog', '--no-install', '--no-git'], io)

    const manifest: unknown = JSON.parse(read('package.json'))
    expect(manifest).toMatchObject({
      name: 'blog-cms',
      dependencies: { '@hollware/server': '0.4.0', '@hollware/core': '0.4.0' },
      devDependencies: { hollware: '0.4.0', '@hollware/admin': '0.4.0' },
    })
    expect(read('package.json')).not.toContain('HOLLWARE_VERSION')
    expect(read('wrangler.jsonc')).toContain('"name": "blog-cms"')
    expect(read('wrangler.jsonc')).toContain('"database_name": "blog-cms"')
    expect(read('wrangler.jsonc')).toContain('"dead_letter_queue": "blog-cms-events-dlq"')
    expect(read('wrangler.jsonc')).not.toContain('my-hollware')
    // No config: the structure lives in the database (ADR-033); the README names the site.
    expect(existsSync(join(cwd, 'blog-cms', 'hollware.config.ts'))).toBe(false)
    expect(read('README.md')).toContain('hollware init --site blog --local')
    expect(read('README.md')).not.toContain('my-site')
    expect(existsSync(join(cwd, 'blog-cms', '.gitignore'))).toBe(true)
    expect(existsSync(join(cwd, 'blog-cms', 'gitignore'))).toBe(false)
    // npm needs no pnpm settings.
    expect(existsSync(join(cwd, 'blog-cms', 'pnpm-workspace.yaml'))).toBe(false)
  })

  it('tells pnpm which build scripts to run, when pnpm installs', async () => {
    const { io, cwd } = world()

    await create(['blog-cms', '--pm', 'pnpm', '--no-install', '--no-git'], io)

    expect(readFileSync(join(cwd, 'blog-cms', 'pnpm-workspace.yaml'), 'utf8')).toBe(
      'allowBuilds:\n  esbuild: true\n  workerd: false\n',
    )
  })

  it('runs git init, the install, the migrations and init, in the project', async () => {
    const { io, calls, out, cwd } = world()

    const code = await create(['blog-cms', '--site', 'blog', '--pm', 'pnpm'], io)

    const project = join(cwd, 'blog-cms')
    const hollware = join(project, 'node_modules', '.bin', 'hollware')
    expect(code).toBe(0)
    expect(calls).toEqual([
      { command: 'git', args: ['init', '--quiet'], cwd: project },
      { command: 'pnpm', args: ['install'], cwd: project },
      { command: join(project, 'node_modules', '.bin', 'vp'), args: ['fmt'], cwd: project },
      { command: hollware, args: ['migrate', '--local'], cwd: project },
      { command: hollware, args: ['init', '--site', 'blog', '--local'], cwd: project },
    ])
    expect(out).toContain(INIT_ANSWER.trim())
    // How to start and deploy it; how to connect an agent is init's to say, once.
    expect(out.at(-1)).toBe(
      [
        '',
        'Start it:',
        '  cd blog-cms',
        '  pnpm exec hollware dev',
        '',
        'The admin is at http://localhost:5199/admin/. To deploy, log in to Cloudflare and run:',
        '  pnpm exec wrangler login',
        '  pnpm run deploy',
        'The README says the rest.',
      ].join('\n'),
    )
    // The token is init's to print, once: nothing here repeats it.
    expect(out.join('\n').split(TOKEN)).toHaveLength(2)
  })

  it('hands --preset, --locales and what the activity log keeps to init, as given', async () => {
    const { io, calls, cwd } = world()

    await create(
      [
        'blog-cms',
        '--preset',
        'docs',
        '--locales',
        'es,en',
        '--ip-addresses',
        'hashed',
        '--audit-retention-days',
        '365',
        '--no-git',
      ],
      io,
    )

    const project = join(cwd, 'blog-cms')
    expect(calls.at(-1)).toEqual({
      command: join(project, 'node_modules', '.bin', 'hollware'),
      args: [
        'init',
        '--site',
        'my-site',
        '--preset',
        'docs',
        '--locales',
        'es,en',
        '--ip-addresses',
        'hashed',
        '--audit-retention-days',
        '365',
        '--local',
      ],
      cwd: project,
    })
  })

  it('refuses a directory that is not empty, and writes nothing', async () => {
    const { io, cwd, calls } = world()
    mkdirSync(join(cwd, 'blog-cms'))
    writeFileSync(join(cwd, 'blog-cms', 'notes.txt'), 'mine')

    await expect(create(['blog-cms'], io)).rejects.toThrow(
      `${join(cwd, 'blog-cms')} is not empty: choose a new directory.`,
    )
    expect(existsSync(join(cwd, 'blog-cms', 'package.json'))).toBe(false)
    expect(calls).toEqual([])
  })

  it('stops at the step that failed, with what it said', async () => {
    const { io, calls } = world({
      'npm install': {
        code: 1,
        stdout: '',
        stderr: 'npm ERR! 404 Not Found: @hollware/server@0.4.0',
      },
    })

    await expect(create(['blog-cms', '--no-git'], io)).rejects.toThrow(
      'The install failed (npm install):\nnpm ERR! 404 Not Found: @hollware/server@0.4.0',
    )
    expect(calls.map((call) => call.command)).toEqual(['npm'])
  })
})

describe('create-hollware, for an agent', () => {
  it('hands --token-file to init as an absolute path, and ignores it in git when it is in the project', async () => {
    const { io, calls, cwd, read, out } = world({
      'hollware init': { code: 0, stdout: 'Hollware is ready.\n', stderr: '' },
    })

    await create(['blog-cms', '--token-file', 'blog-cms/owner.token', '--no-git'], io)

    const file = join(cwd, 'blog-cms', 'owner.token')
    expect(calls.at(-1)?.args).toEqual([
      'init',
      '--site',
      'my-site',
      '--token-file',
      file,
      '--local',
    ])
    expect(read('.gitignore')).toMatch(
      /\n# The token of "hollware init": never commit it\.\n\/owner\.token\n$/,
    )
    expect(out.join('\n')).not.toMatch(/hw_pat_/)
  })

  it('refuses a token file that exists before it makes anything', async () => {
    const { io, calls, cwd } = world()
    writeFileSync(join(cwd, 'owner.token'), 'keep\n')

    await expect(create(['blog-cms', '--token-file', 'owner.token'], io)).rejects.toThrow(
      `${join(cwd, 'owner.token')} exists already, and a token is never written over a file: choose another --token-file.`,
    )

    expect(calls).toEqual([])
    expect(existsSync(join(cwd, 'blog-cms'))).toBe(false)
  })

  it('prints one JSON object with --json: init, the commands and the MCP configuration', async () => {
    const init = {
      site: 'my-site',
      ownerId: 'usr_1',
      tokenId: 'tok_1',
      tokenFile: '/x/owner.token',
      expiresAt: '2027-01-10T12:00:00.000Z',
      setupUrl: 'http://localhost:5199/setup#invitation=hw_inv_x',
      mcpUrl: 'http://localhost:5199/mcp',
      readApiUrl: 'http://localhost:5199/v1',
    }
    const { io, calls, out, cwd } = world({
      'hollware init': { code: 0, stdout: `${JSON.stringify(init)}\n`, stderr: '' },
    })

    const code = await create(['blog-cms', '--json', '--pm', 'pnpm'], io)

    expect(code).toBe(0)
    expect(calls.at(-1)?.args).toEqual(['init', '--site', 'my-site', '--local', '--json'])
    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0] ?? '')).toEqual({
      dir: join(cwd, 'blog-cms'),
      installed: true,
      ...init,
      devCommand: 'pnpm exec hollware dev',
      adminUrl: 'http://localhost:5199/admin/',
      mcpConfig: {
        variable: 'HOLLWARE_TOKEN',
        claudeCode:
          "claude mcp add --transport http hollware http://localhost:5199/mcp --header 'Authorization: Bearer ${HOLLWARE_TOKEN}'",
        json: {
          mcpServers: {
            hollware: {
              type: 'http',
              url: 'http://localhost:5199/mcp',
              headers: { Authorization: 'Bearer ${HOLLWARE_TOKEN}' },
            },
          },
        },
      },
    })
  })

  it('prints one JSON object with --json and --no-install too', async () => {
    const { io, out, cwd } = world()

    await create(['blog-cms', '--json', '--no-install', '--no-git'], io)

    expect(out.map((line) => JSON.parse(line))).toEqual([
      {
        dir: join(cwd, 'blog-cms'),
        installed: false,
        next: [
          'cd blog-cms',
          'npm install',
          'npm exec vp fmt',
          'npm exec hollware migrate --local',
          'npm exec hollware init --site my-site --local',
        ],
      },
    ])
  })
})
