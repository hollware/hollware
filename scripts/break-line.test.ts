import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vite-plus/test'
import { breakLine } from './break-line.ts'

// A stand-in for a test command: it passes only while `file` still contains `needle`.
function guard(file: string, needle: string): string[] {
  return [
    '-e',
    `process.exit(require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8').includes(${JSON.stringify(needle)}) ? 0 : 1)`,
  ]
}

let dir: string
let file: string
const source = Buffer.from('// add two numbers\r\nexport const sum = (a, b) => a + b', 'utf8')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'break-line-'))
  file = join(dir, 'sum.js')
  writeFileSync(file, source)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('breakLine', () => {
  test('reports CAUGHT when the command fails with the mutation in place', () => {
    const result = breakLine({
      file,
      find: 'a + b',
      replace: 'a - b',
      command: process.execPath,
      args: guard(file, 'a + b'),
    })
    expect(result.verdict).toBe('CAUGHT')
    expect(result.reason).toBe('the command failed (exit 1)')
  })

  test('reports NOT CAUGHT when the command still passes', () => {
    const result = breakLine({
      file,
      find: 'add two numbers',
      replace: 'subtract two numbers',
      command: process.execPath,
      args: guard(file, 'a + b'),
    })
    expect(result.verdict).toBe('NOT CAUGHT')
  })

  test('restores the file byte for byte, CRLF and missing final newline included', () => {
    breakLine({
      file,
      find: 'a + b',
      replace: 'a - b',
      command: process.execPath,
      args: guard(file, 'a + b'),
    })
    expect(readFileSync(file).equals(source)).toBe(true)
  })

  test('the command sees the mutated file', () => {
    const result = breakLine({
      file,
      find: 'a + b',
      replace: 'a * b',
      command: process.execPath,
      args: guard(file, 'a * b'),
    })
    expect(result.verdict).toBe('NOT CAUGHT')
  })

  test('reports ERROR when the snippet is missing', () => {
    const result = breakLine({
      file,
      find: 'a / b',
      replace: 'a % b',
      command: process.execPath,
      args: guard(file, 'a + b'),
    })
    expect(result).toEqual({ verdict: 'ERROR', reason: 'snippet not found' })
  })

  test('reports ERROR when the snippet is ambiguous', () => {
    writeFileSync(file, 'a + b\na + b\n')
    const result = breakLine({
      file,
      find: 'a + b',
      replace: 'a - b',
      command: process.execPath,
      args: guard(file, 'a + b'),
    })
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'snippet appears more than once; make it unique',
    })
  })

  test('reports ERROR and restores the file when the command cannot start', () => {
    const result = breakLine({
      file,
      find: 'a + b',
      replace: 'a - b',
      command: join(dir, 'missing-binary'),
      args: [],
    })
    expect(result.verdict).toBe('ERROR')
    expect(readFileSync(file).equals(source)).toBe(true)
  })
})

describe('CLI', () => {
  const script = join(import.meta.dirname, 'break-line.ts')

  function cli(find: string, needle: string): number | null {
    const run = spawnSync(
      process.execPath,
      [
        script,
        '--file',
        file,
        '--find',
        find,
        '--replace',
        'MUTATED',
        '--',
        process.execPath,
        ...guard(file, needle),
      ],
      { stdio: 'pipe' },
    )
    return run.status
  }

  test('exits 0 for CAUGHT, 1 for NOT CAUGHT and 2 for ERROR', () => {
    expect(cli('a + b', 'a + b')).toBe(0)
    expect(cli('add two', 'a + b')).toBe(1)
    expect(cli('not in the file', 'a + b')).toBe(2)
    expect(readFileSync(file).equals(source)).toBe(true)
  })
})
