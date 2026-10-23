import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { exec } from './support/exec.ts'
import { install, type Install } from './support/install.ts'
import { startStub } from './support/stub-hollware.ts'

const SLOW = { timeout: 60_000 }

let installed: Install

beforeEach(() => {
  installed = install({ name: 'hollware', version: '7.8.9' })
})

afterEach(() => {
  installed.remove()
})

describe('the hollware bin, run as a process', () => {
  it('runs through the symlink npm creates and prints the version on stdout', SLOW, async () => {
    const { code, stdout, stderr } = await exec([installed.bin, '--version'])
    expect(stdout).toBe('hollware 7.8.9\n')
    expect(stderr).toBe('')
    expect(code).toBe(0)
  })

  it('sends errors to stderr and exits with the code main returns', SLOW, async () => {
    const { code, stdout, stderr } = await exec([installed.bin, 'export'])
    expect(stdout).toBe('')
    expect(stderr).toBe(
      'hollware export: export takes one directory: hollware export <directory> --url <url>. Run "hollware export --help" for the options.\n',
    )
    expect(code).toBe(1)
  })

  it('loads a command in a real process', SLOW, async () => {
    const { code, stdout, stderr } = await exec([installed.bin, 'init'])
    expect(stdout).toBe('')
    expect(stderr).toBe(
      'hollware init: --site is required: name the site, such as --site my-site. Run "hollware init --help" for the options.\n',
    )
    expect(code).toBe(1)
  })

  it('does not run when imported, even if argv[1] is not a file', SLOW, async () => {
    const url = JSON.stringify(pathToFileURL(installed.module).href)
    const { code, stdout, stderr } = await exec([
      '--input-type=module',
      '--eval',
      `const { main } = await import(${url}); console.log(typeof main)`,
      'not-a-file',
    ])
    expect(stdout).toBe('function\n')
    expect(stderr).toBe('')
    expect(code).toBe(0)
  })
})

describe('hollware import, run as a process', () => {
  const token = `hw_pat_${'a'.repeat(52)}`
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'hollware-cli-bin-'))
    mkdirSync(join(directory, 'blog', 'en'), { recursive: true })
    writeFileSync(join(directory, 'blog', 'en', 'hello.md'), '---\ntitle: Hello\n---\n\n# Hello\n')
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('imports with the token on stdin and keeps the token out of the output', SLOW, async () => {
    const stub = await startStub({ token })
    try {
      const { code, stdout, stderr } = await exec(
        [installed.bin, 'import', directory, '--url', stub.url],
        { input: `${token}\n` },
      )
      expect(stderr).toBe('')
      expect(stdout).toContain('created    blog/en/hello  ent_00000000000000000000000001  v1\n')
      expect(stdout.endsWith('Drafts: 1 created, 0 updated, 0 unchanged.\n')).toBe(true)
      expect(code).toBe(0)
      expect(stdout + stderr).not.toContain(token)
      expect(new Set(stub.authorizations)).toEqual(new Set([`Bearer ${token}`]))
    } finally {
      await stub.close()
    }
  })
})
