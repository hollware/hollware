import { type ChildProcess, spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'
import {
  breakLine,
  type BreakLineOptions,
  type BreakLineResult,
  main,
  parseTimeout,
} from './break-line.ts'

function guard(file: string, needle: string): string[] {
  return [
    '-e',
    `process.exit(require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8').includes(${JSON.stringify(needle)}) ? 0 : 1)`,
  ]
}

const script = (code: string): string[] => ['-e', code]

let dir: string
let file: string
let pidsFile: string
const source = Buffer.from('// add two numbers\r\nexport const sum = (a, b) => a + b', 'utf8')
const PAST = new Date('2001-01-01T00:00:00Z')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'break-line-'))
  file = join(dir, 'sum.js')
  pidsFile = join(dir, 'pids.json')
  writeFileSync(file, source)
  utimesSync(file, PAST, PAST)
})

afterEach(() => {
  const pids = readPids()
  if (pids !== undefined) {
    for (const pid of [pids.child, pids.grandchild]) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {}
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH')
  }
}

interface Pids {
  child: number
  grandchild: number
}

function readPids(): Pids | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(pidsFile, 'utf8'))
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'child' in parsed &&
      typeof parsed.child === 'number' &&
      'grandchild' in parsed &&
      typeof parsed.grandchild === 'number'
    ) {
      return { child: parsed.child, grandchild: parsed.grandchild }
    }
  } catch {}
  return undefined
}

async function until<T>(read: () => T | undefined, what: string): Promise<T> {
  const deadline = Date.now() + 10_000
  for (;;) {
    const found = read()
    if (found !== undefined) return found
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(20)
  }
}

const IDLE = 'setTimeout(() => {}, 60000)'

function hang(grandchildSource = IDLE): string {
  return `
    const { spawn } = require('node:child_process')
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' })
    require('node:fs').writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ child: process.pid, grandchild: grandchild.pid }))
    ${IDLE}
  `
}

function hangsOnMutation(): string[] {
  return script(`
    if (require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8').includes('a - b')) {
      ${hang()}
    }
  `)
}

function expectDead(pids: Pids): void {
  expect({ child: isAlive(pids.child), grandchild: isAlive(pids.grandchild) }).toEqual({
    child: false,
    grandchild: false,
  })
}

function expectUntouched(): void {
  expect(readFileSync(file).equals(source)).toBe(true)
  expect(statSync(file).mtimeMs).toBe(PAST.getTime())
}

function probe(
  args: string[],
  overrides: Partial<BreakLineOptions> = {},
): Promise<BreakLineResult> {
  return breakLine({
    file,
    find: 'a + b',
    replace: 'a - b',
    command: process.execPath,
    args,
    timeoutSeconds: 30,
    ...overrides,
  })
}

describe('breakLine', () => {
  test('reports CAUGHT when the command passes without the mutation and fails with it', async () => {
    const result = await probe(guard(file, 'a + b'))
    expect(result).toEqual({
      verdict: 'CAUGHT',
      reason: 'the command passes without the mutation and fails with it (exit 1)',
    })
  })

  test('reports NOT CAUGHT when the command passes with the mutation too', async () => {
    const result = await probe(guard(file, 'add two numbers'), { find: 'a + b', replace: 'a * b' })
    expect(result).toEqual({
      verdict: 'NOT CAUGHT',
      reason: 'the command passes without the mutation and with it',
    })
  })

  test('restores the file byte for byte, CRLF and missing final newline included', async () => {
    await probe(guard(file, 'a + b'))
    expect(readFileSync(file).equals(source)).toBe(true)
  })

  test('runs the command on the file as it is, then on the mutated file, and no more', async () => {
    const log = join(dir, 'log.txt')
    const record = `
      const fs = require('node:fs')
      fs.appendFileSync(${JSON.stringify(log)}, fs.readFileSync(${JSON.stringify(file)}, 'utf8') + '|')
    `
    const result = await probe(script(record), { find: 'two', replace: 'three' })
    expect(result.verdict).toBe('NOT CAUGHT')
    expect(readFileSync(log, 'utf8')).toBe(
      '// add two numbers\r\nexport const sum = (a, b) => a + b|' +
        '// add three numbers\r\nexport const sum = (a, b) => a + b|',
    )
  })

  test('reports ERROR, and never touches the file, when the command fails without the mutation', async () => {
    const result = await probe(script('process.exit(1)'))
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'the command fails without the mutation (exit 1)',
    })
    expectUntouched()
  })

  test('reports ERROR when the command is killed by a signal without the mutation', async () => {
    const result = await probe(script("process.kill(process.pid, 'SIGKILL')"))
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'the command fails without the mutation (signal SIGKILL)',
    })
    expectUntouched()
  })

  test('reports ERROR, not CAUGHT, when the mutated run is killed by a signal', async () => {
    const result = await probe(
      script(`
        if (require('node:fs').readFileSync(${JSON.stringify(file)}, 'utf8').includes('a - b')) {
          process.kill(process.pid, 'SIGKILL')
        }
      `),
    )
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'the command was killed by SIGKILL (mutated run), which is not a test failing',
    })
    expect(readFileSync(file).equals(source)).toBe(true)
  })

  test('reports ERROR when the snippet is missing', async () => {
    const result = await probe(guard(file, 'a + b'), { find: 'a / b', replace: 'a % b' })
    expect(result).toEqual({ verdict: 'ERROR', reason: 'snippet not found' })
  })

  test('reports ERROR when the snippet is empty', async () => {
    const result = await probe(guard(file, 'a + b'), { find: '', replace: 'x' })
    expect(result).toEqual({ verdict: 'ERROR', reason: 'snippet not found' })
  })

  test('reports ERROR when the snippet is ambiguous', async () => {
    writeFileSync(file, 'a + b\na + b\n')
    const result = await probe(guard(file, 'a + b'))
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'snippet appears more than once; make it unique',
    })
  })

  test('reports ERROR when the replacement equals the snippet', async () => {
    const result = await probe(guard(file, 'a + b'), { find: 'a + b', replace: 'a + b' })
    expect(result).toEqual({ verdict: 'ERROR', reason: 'the replacement equals the snippet' })
  })

  test('reports ERROR, and never touches the file, when the command cannot start', async () => {
    const result = await probe([], { command: join(dir, 'missing-binary') })
    expect(result.verdict).toBe('ERROR')
    expect(result.reason).toMatch(/^the command could not start: .*ENOENT/)
    expectUntouched()
  })

  test('reports ERROR, and never touches the file, when the command is not a valid file name', async () => {
    const result = await probe([], { command: 'a\0b' })
    expect(result.verdict).toBe('ERROR')
    expect(result.reason).toMatch(/^the command could not start: .*null bytes/)
    expectUntouched()
  })

  test('runs the command in the given directory', async () => {
    const where = join(dir, 'cwd.txt')
    const result = await probe(
      script(`require('node:fs').writeFileSync(${JSON.stringify(where)}, process.cwd())`),
      { cwd: dir },
    )
    expect(result.verdict).toBe('NOT CAUGHT')
    expect(readFileSync(where, 'utf8')).toBe(realpathSync(dir))
  })

  test('reports ERROR, not CAUGHT, when the file cannot be restored', async () => {
    const result = await probe(
      script(`
        const fs = require('node:fs')
        const file = ${JSON.stringify(file)}
        if (fs.readFileSync(file, 'utf8').includes('a - b')) {
          fs.rmSync(file)
          fs.mkdirSync(file)
          process.exit(1)
        }
      `),
    )
    expect(result.verdict).toBe('ERROR')
    expect(result.reason).toMatch(
      /^could not restore the file, which may still hold the mutation: EISDIR/,
    )
  })

  test('reports ERROR, naming both failures, when the mutation cannot be written', async () => {
    const result = await probe(
      script(`
        const fs = require('node:fs')
        const file = ${JSON.stringify(file)}
        fs.rmSync(file)
        fs.mkdirSync(file)
      `),
    )
    expect(result.verdict).toBe('ERROR')
    expect(result.reason).toMatch(
      /^EISDIR: illegal operation on a directory, open '.*sum\.js'; could not restore the file, which may still hold the mutation: EISDIR/,
    )
  })

  describe('timeout', () => {
    test('kills a hung baseline and its process group, and never touches the file', async () => {
      const result = await probe(script(hang()), { timeoutSeconds: 1 })
      expect(result).toEqual({ verdict: 'ERROR', reason: 'timed out after 1 s (baseline run)' })
      expectUntouched()
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)

    test('kills a hung mutated run and its process group, and restores the file', async () => {
      const result = await probe(hangsOnMutation(), { timeoutSeconds: 1 })
      expect(result).toEqual({ verdict: 'ERROR', reason: 'timed out after 1 s (mutated run)' })
      expect(readFileSync(file).equals(source)).toBe(true)
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)

    test('kills with SIGKILL what ignores SIGTERM', async () => {
      const result = await probe(script(`process.on('SIGTERM', () => {}); ${hang()}`), {
        timeoutSeconds: 1,
        killGraceMs: 200,
      })
      expect(result).toEqual({ verdict: 'ERROR', reason: 'timed out after 1 s (baseline run)' })
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)

    test('asks with SIGTERM first, and gives the command time to clean up', async () => {
      const cleaned = join(dir, 'cleaned.txt')
      const tidy = `require('node:fs').writeFileSync(${JSON.stringify(cleaned)}, 'clean'); process.exit(0)`
      const onTerm = `process.on('SIGTERM', () => setTimeout(() => { ${tidy} }, 300))`
      const result = await probe(script(`${onTerm}; ${hang()}`), { timeoutSeconds: 1 })
      expect(result.reason).toBe('timed out after 1 s (baseline run)')
      expect(readFileSync(cleaned, 'utf8')).toBe('clean')
    }, 10_000)

    test('waits until the whole process group is gone, not just its first process', async () => {
      const lingers = `process.on('SIGTERM', () => setTimeout(() => process.exit(0), 400)); ${IDLE}`
      await probe(script(hang(lingers)), { timeoutSeconds: 1 })
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)
  })

  test('does not run the command when it is already aborted', async () => {
    const marker = join(dir, 'ran.txt')
    const abort = new AbortController()
    abort.abort('SIGTERM')
    const result = await probe(
      script(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`),
      { abort: abort.signal },
    )
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'interrupted by SIGTERM (baseline run); the file was not touched',
    })
    expect(existsSync(marker)).toBe(false)
    expectUntouched()
  })
})

describe('parseTimeout', () => {
  test('is 60 seconds when --timeout is not given', () => {
    expect(parseTimeout(undefined)).toBe(60)
  })

  test.each([
    ['90', 90],
    ['0.5', 0.5],
    ['2147483', 2147483],
  ])('reads %s as %d seconds', (text, seconds) => {
    expect(parseTimeout(text)).toBe(seconds)
  })

  test.each(['', '0', '0.0', '-5', 'abc', '1e3', '0x10', '5 s', ' 5', 'Infinity', '2147484'])(
    'rejects %j',
    (text) => {
      expect(() => parseTimeout(text)).toThrow(
        `--timeout must be a number of seconds, greater than 0 and at most 2147483; got ${JSON.stringify(text)}`,
      )
    },
  )
})

interface CliRun {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

const cliScript = join(import.meta.dirname, 'break-line.ts')

function startCli(
  argv: string[],
  stdin: 'ignore' | 'pipe' = 'ignore',
): { child: ChildProcess; done: Promise<CliRun> } {
  const child = spawn(process.execPath, [cliScript, ...argv], { stdio: [stdin, 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (chunk) => {
    stdout += String(chunk)
  })
  child.stderr?.on('data', (chunk) => {
    stderr += String(chunk)
  })
  const done = new Promise<CliRun>((resolve) => {
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr })
    })
  })
  return { child, done }
}

function cli(argv: string[]): Promise<CliRun> {
  return startCli(argv).done
}

function mutate(find: string, command: string[], extra: string[] = []): string[] {
  return [
    '--file',
    file,
    '--find',
    find,
    '--replace',
    'a - b',
    ...extra,
    '--',
    process.execPath,
    ...command,
  ]
}

describe('main', () => {
  test('exits 2, not 1, when the probe itself crashes', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await main(JSON.parse('null'))).toBe(2)
      expect(error).toHaveBeenCalledWith(expect.stringMatching(/^ERROR: /))
    } finally {
      error.mockRestore()
    }
  })
})

describe('CLI', () => {
  test('prints the verdict on stdout and one header per run on stderr', async () => {
    const run = await cli(mutate('a + b', guard(file, 'a + b')))
    expect(run).toEqual({
      code: 0,
      signal: null,
      stdout: 'CAUGHT: the command passes without the mutation and fails with it (exit 1)\n',
      stderr:
        'break-line: baseline run, without the mutation\nbreak-line: mutated run, with the mutation\n',
    })
  })

  test('shows the output of the command, once per run', async () => {
    const run = await cli(mutate('a + b', script("console.log('ran')")))
    expect(run.stdout).toBe(
      'ran\nran\nNOT CAUGHT: the command passes without the mutation and with it\n',
    )
  })

  test('gives the command no stdin', async () => {
    const reads = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"
    const { done } = startCli(mutate('a + b', script(reads), ['--timeout=2']), 'pipe')
    const run = await done
    expect(run.stdout).toBe('NOT CAUGHT: the command passes without the mutation and with it\n')
  }, 10_000)

  test('reports the usage, not a crash, when a value starts with a dash', async () => {
    const run = await cli([
      '--file',
      file,
      '--find',
      '-x',
      '--replace',
      'y',
      '--',
      process.execPath,
      '-e',
      '',
    ])
    expect(run.code).toBe(2)
    expect(run.stdout).toBe('')
    expect(run.stderr).toContain('usage: node scripts/break-line.ts --file <path> ')
    expectUntouched()
  })

  test('accepts a value that starts with a dash in the --find= form', async () => {
    writeFileSync(file, 'let x = -1\n')
    const run = await cli([
      '--file',
      file,
      '--find=-1',
      '--replace=1',
      '--',
      process.execPath,
      ...guard(file, '-1'),
    ])
    expect(run.code).toBe(0)
  })

  test('exits 0 for CAUGHT, 1 for NOT CAUGHT and 2 for ERROR', async () => {
    expect((await cli(mutate('a + b', guard(file, 'a + b')))).code).toBe(0)
    expect((await cli(mutate('add two', guard(file, 'a + b')))).code).toBe(1)
    expect((await cli(mutate('not in the file', guard(file, 'a + b')))).code).toBe(2)
    expect(readFileSync(file).equals(source)).toBe(true)
  })

  test('exits 2, not 1, when the file cannot be read', async () => {
    const run = await cli([
      '--file',
      join(dir, 'missing.js'),
      '--find',
      'a',
      '--replace',
      'b',
      '--',
      process.execPath,
      '-e',
      '',
    ])
    expect(run.code).toBe(2)
    expect(run.stdout).toMatch(/^ERROR: ENOENT/)
  })

  test.each([
    ['--', ['--file', 'f', '--find', 'a', '--replace', 'b']],
    ['--replace', ['--file', 'f', '--find', 'a', '--', 'node', '-e', '0']],
    ['the command', ['--file', 'f', '--find', 'a', '--replace', 'b', '--']],
  ])('exits 2 with the usage when %s is missing', async (_missing, argv) => {
    const run = await cli(argv)
    expect(run.code).toBe(2)
    expect(run.stdout).toBe('')
    expect(run.stderr).toMatch(/^usage: node scripts\/break-line\.ts --file <path> /)
  })

  test('--timeout=<seconds> bounds each run', async () => {
    const run = await cli(mutate('a + b', script(IDLE), ['--timeout=1']))
    expect(run).toMatchObject({
      code: 2,
      stdout: 'ERROR: timed out after 1 s (baseline run)\n',
    })
  }, 10_000)

  test('rejects a --timeout that is not a number of seconds, before running the command', async () => {
    const marker = join(dir, 'ran.txt')
    const ran = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`
    const run = await cli(mutate('a + b', script(ran), ['--timeout=0']))
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('--timeout must be a number of seconds')
    expect(existsSync(marker)).toBe(false)
    expectUntouched()
  })

  test.each(['--help', '-h'])(
    '%s documents the timeout and the exit codes, and runs nothing',
    async (flag) => {
      const run = await cli([flag])
      expect(run.code).toBe(0)
      expect(run.stdout).toContain(
        '--timeout <seconds>  how long each of the two runs may take (default 60;',
      )
      expect(run.stdout).toContain('CAUGHT      0')
      expect(run.stdout).toContain('NOT CAUGHT  1')
      expect(run.stdout).toContain('ERROR       2')
      expect(run.stdout).toContain('128 + N')
    },
  )

  describe('signals', () => {
    const interrupts: [NodeJS.Signals, number][] = [
      ['SIGINT', 130],
      ['SIGTERM', 143],
      ['SIGHUP', 129],
    ]

    test.each(interrupts)(
      'on %s while the mutation is in place: kills the command, restores the file, exits %d',
      async (signal, code) => {
        const { child, done } = startCli(mutate('a + b', hangsOnMutation()))
        const pids = await until(readPids, 'the mutated run to start')
        expect(readFileSync(file, 'utf8')).toContain('a - b')
        child.kill(signal)
        const run = await done
        expect(run).toEqual({
          code,
          signal: null,
          stdout: `ERROR: interrupted by ${signal} (mutated run); the file was restored\n`,
          stderr:
            'break-line: baseline run, without the mutation\nbreak-line: mutated run, with the mutation\n',
        })
        expect(readFileSync(file).equals(source)).toBe(true)
        expectDead(pids)
      },
      10_000,
    )

    test('on SIGTERM during the baseline run: kills the command and never touches the file', async () => {
      const { child, done } = startCli(mutate('a + b', script(hang())))
      const pids = await until(readPids, 'the baseline run to start')
      child.kill('SIGTERM')
      const run = await done
      expect(run).toMatchObject({
        code: 143,
        stdout: 'ERROR: interrupted by SIGTERM (baseline run); the file was not touched\n',
      })
      expectUntouched()
      expectDead(pids)
    }, 10_000)
  })
})
