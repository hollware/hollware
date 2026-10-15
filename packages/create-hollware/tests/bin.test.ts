import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test'

import { install, type Install } from './support/install.ts'

let installed: Install

beforeEach(() => {
  installed = install({ name: 'create-hollware', version: '7.8.9' })
})

afterEach(() => {
  installed.remove()
})

// `--no-warnings` keeps Node's own notices out of the streams under test.
function node(args: string[]) {
  return spawnSync(process.execPath, ['--no-warnings', ...args], { encoding: 'utf8' })
}

describe('the create-hollware bin, run as a process', () => {
  it('runs through the symlink npm creates and prints the version on stdout', () => {
    const { status, stdout, stderr } = node([installed.bin, '--version'])
    expect(stdout).toBe('create-hollware 7.8.9\n')
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })

  it('sends errors to stderr and exits with the code main returns', () => {
    const { status, stdout, stderr } = node([installed.bin, '--pm', 'yarn', 'x'])
    expect(stdout).toBe('')
    expect(stderr).toMatch(/^create-hollware: --pm is npm or pnpm, not "yarn"\n/)
    expect(status).toBe(1)
  })

  it('does not run when imported, even if argv[1] is not a file', () => {
    const url = JSON.stringify(pathToFileURL(installed.module).href)
    const { status, stdout, stderr } = node([
      '--input-type=module',
      '--eval',
      `const { main } = await import(${url}); console.log(typeof main)`,
      'not-a-file',
    ])
    expect(stdout).toBe('function\n')
    expect(stderr).toBe('')
    expect(status).toBe(0)
  })
})
