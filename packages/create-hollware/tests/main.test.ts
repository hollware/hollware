import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { main } from '../src/index.ts'
import { install, type Install } from './support/install.ts'

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

describe('create-hollware --help', () => {
  it('prints the usage on out and exits 0', () => {
    const { code, out, err } = run(['--help'])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([expect.stringContaining('Usage: npm create hollware <dir>')])
  })

  it('does the same with no arguments', () => {
    const { code, out, err } = run([])
    expect(code).toBe(0)
    expect(err).toEqual([])
    expect(out).toEqual([expect.stringContaining('Usage: npm create hollware <dir>')])
  })

  it('says that creating a project is not implemented yet', () => {
    const [usage] = run(['--help']).out
    expect(usage).toContain('Create a new Hollware project in <dir> (not implemented yet).')
  })
})

describe('create-hollware --version', () => {
  it('prints the name and the version in the package.json next to the module', async () => {
    const cli = await loadFrom({ name: 'create-hollware', version: '7.8.9' })
    expect(run(['--version'], cli)).toEqual({ code: 0, out: ['create-hollware 7.8.9'], err: [] })
  })

  it('throws when that package.json has no version', async () => {
    const cli = await loadFrom({ name: 'create-hollware' })
    expect(() => run(['--version'], cli)).toThrow('package.json has no version')
  })
})

describe('create-hollware with an unknown flag', () => {
  it.each(['--bogus', '-h'])('rejects %s with the usage on err and exit code 1', (flag) => {
    const { code, out, err } = run([flag])
    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([expect.stringContaining(`create-hollware: unknown flag "${flag}"`)])
    expect(err[0]).toContain('Usage: npm create hollware <dir>')
  })
})

describe('create-hollware <dir>', () => {
  it('says it is not implemented yet and exits 1', () => {
    expect(run(['my-site'])).toEqual({
      code: 1,
      out: [],
      err: ['create-hollware: not implemented yet'],
    })
  })
})
