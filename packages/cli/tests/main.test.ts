import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { main } from '../src/index.ts'
import { install, type Install } from './support/install.ts'

const PLANNED_COMMANDS = ['init', 'migrate', 'token', 'import', 'export']

function run(argv: string[], cli: typeof main = main) {
  const out: string[] = []
  const err: string[] = []
  const code = cli(argv, { out: (s) => out.push(s), err: (s) => err.push(s) })
  return { code, out, err }
}

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

describe('hollware --help', () => {
  it('prints the usage on out and exits 0', () => {
    const { code, out, err } = run(['--help'])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([expect.stringContaining('Usage: hollware <command>')])
  })

  it('does the same with no arguments', () => {
    const { code, out, err } = run([])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([expect.stringContaining('Usage: hollware <command>')])
  })

  it.each(PLANNED_COMMANDS)('lists %s as not implemented yet', (command) => {
    const [usage] = run(['--help']).out
    expect(usage).toMatch(new RegExp(`^ {2}${command} +\\S.*\\(not implemented yet\\)$`, 'm'))
  })
})

describe('hollware --version', () => {
  it('prints the name and the version in the package.json next to the module', async () => {
    const cli = await loadFrom({ name: 'hollware', version: '7.8.9' })
    expect(run(['--version'], cli)).toEqual({ code: 0, out: ['hollware 7.8.9'], err: [] })
  })

  it('throws when that package.json has no version', async () => {
    const cli = await loadFrom({ name: 'hollware' })
    expect(() => run(['--version'], cli)).toThrow('package.json has no version')
  })
})

describe('hollware with an unknown argument', () => {
  it.each(['--bogus', 'frobnicate'])('rejects %s with the usage on err and exit code 1', (arg) => {
    const { code, out, err } = run([arg])
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([expect.stringContaining(`hollware: unknown command or flag "${arg}"`)])
    expect(err[0]).toContain('Usage: hollware <command>')
  })
})

describe('hollware with a planned command', () => {
  it.each(PLANNED_COMMANDS)('%s says it is not implemented yet and exits 1', (command) => {
    expect(run([command])).toEqual({
      code: 1,
      out: [],
      err: [`hollware ${command}: not implemented yet`],
    })
  })
})
