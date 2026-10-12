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

// Everything here runs real child processes: `node -e ...` stands in for a test command, and the
// CLI tests run `scripts/break-line.ts` itself. Each test says which line of break-line.ts it
// guards ("Fails when"); the probe can check that claim on its own source.

// A stand-in for a test command: it passes only while `file` still contains `needle`.
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
// A time long ago: any write to the file, even of the same bytes, moves its mtime away from it.
const PAST = new Date('2001-01-01T00:00:00Z')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'break-line-'))
  file = join(dir, 'sum.js')
  pidsFile = join(dir, 'pids.json')
  writeFileSync(file, source)
  utimesSync(file, PAST, PAST)
})

afterEach(() => {
  // A test that fails halfway can leave its hung processes behind.
  const pids = readPids()
  if (pids !== undefined) {
    for (const pid of [pids.child, pids.grandchild]) {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        // Already gone, which is what a passing test leaves.
      }
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
  } catch {
    // Not written yet, or half written.
  }
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

// Idles for a minute: far longer than any timeout here, and short enough that a failing test
// cannot leave a process behind for long.
const IDLE = 'setTimeout(() => {}, 60000)'

// The source of a command that hangs: it records its own pid and the pid of a grandchild in the
// same process group (a test runner and its workers), then idles.
function hang(grandchildSource = IDLE): string {
  return `
    const { spawn } = require('node:child_process')
    const grandchild = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildSource)}], { stdio: 'ignore' })
    require('node:fs').writeFileSync(${JSON.stringify(pidsFile)}, JSON.stringify({ child: process.pid, grandchild: grandchild.pid }))
    ${IDLE}
  `
}

// A command that passes on `sum.js` as it is and hangs once it holds the mutation.
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
  // Fails when: the last switch of probe() changes what a failing mutated run is:
  // `verdict: 'CAUGHT', reason: ...passes without the mutation and fails with it (exit ...)`.
  test('reports CAUGHT when the command passes without the mutation and fails with it', async () => {
    const result = await probe(guard(file, 'a + b'))
    expect(result).toEqual({
      verdict: 'CAUGHT',
      reason: 'the command passes without the mutation and fails with it (exit 1)',
    })
  })

  // Fails when: the same switch sends a passing mutated run to CAUGHT, or its reason changes:
  // `{ verdict: 'NOT CAUGHT', reason: 'the command passes without the mutation and with it' }`.
  test('reports NOT CAUGHT when the command passes with the mutation too', async () => {
    const result = await probe(guard(file, 'add two numbers'), { find: 'a + b', replace: 'a * b' })
    expect(result).toEqual({
      verdict: 'NOT CAUGHT',
      reason: 'the command passes without the mutation and with it',
    })
  })

  // Fails when: restore() writes anything but `original` (line endings normalized, the final
  // newline added), or probe() stops calling it after the mutated run.
  test('restores the file byte for byte, CRLF and missing final newline included', async () => {
    await probe(guard(file, 'a + b'))
    expect(readFileSync(file).equals(source)).toBe(true)
  })

  // Fails when: probe() runs the baseline on the mutated file (`const baseline = await run(spec)`
  // after `writeFileSync(options.file, mutated)`), skips it, runs a third time, or builds the
  // mutation with other slices than `text.slice(0, at) + options.replace + text.slice(at + ...)`.
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

  // Fails when: probe() drops `if (baseline.status !== 0)`, so a command that always fails is
  // taken to guard the snippet, or writes the mutation before the baseline has passed.
  test('reports ERROR, and never touches the file, when the command fails without the mutation', async () => {
    const result = await probe(script('process.exit(1)'))
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'the command fails without the mutation (exit 1)',
    })
    expectUntouched()
  })

  // Fails when: the baseline switch of probe() takes `case 'signaled'` for a pass, or leaves the
  // signal out of its reason.
  test('reports ERROR when the command is killed by a signal without the mutation', async () => {
    const result = await probe(script("process.kill(process.pid, 'SIGKILL')"))
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'the command fails without the mutation (signal SIGKILL)',
    })
    expectUntouched()
  })

  // Fails when: the last switch of probe() sends `case 'signaled'` to CAUGHT, the way the first
  // version counted any ending that was not a pass as a test failing.
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

  // Fails when: probe() drops `if (at === -1) return failure('snippet not found')`.
  test('reports ERROR when the snippet is missing', async () => {
    const result = await probe(guard(file, 'a + b'), { find: 'a / b', replace: 'a % b' })
    expect(result).toEqual({ verdict: 'ERROR', reason: 'snippet not found' })
  })

  // Fails when: probe() drops `options.find === '' ? -1 : ...`: an empty snippet would match
  // everywhere and be reported as ambiguous.
  test('reports ERROR when the snippet is empty', async () => {
    const result = await probe(guard(file, 'a + b'), { find: '', replace: 'x' })
    expect(result).toEqual({ verdict: 'ERROR', reason: 'snippet not found' })
  })

  // Fails when: probe() drops the `text.indexOf(options.find, at + 1) !== -1` check.
  test('reports ERROR when the snippet is ambiguous', async () => {
    writeFileSync(file, 'a + b\na + b\n')
    const result = await probe(guard(file, 'a + b'))
    expect(result).toEqual({
      verdict: 'ERROR',
      reason: 'snippet appears more than once; make it unique',
    })
  })

  // Fails when: probe() drops `if (options.find === options.replace)`: nothing would change and
  // the run would come out as NOT CAUGHT.
  test('reports ERROR when the replacement equals the snippet', async () => {
    const result = await probe(guard(file, 'a + b'), { find: 'a + b', replace: 'a + b' })
    expect(result).toEqual({ verdict: 'ERROR', reason: 'the replacement equals the snippet' })
  })

  // Fails when: the baseline run starts after `writeFileSync(options.file, mutated)`, so a
  // command that cannot start leaves the file for the restore to fix, or `case 'not-started'`
  // is dropped from either switch.
  test('reports ERROR, and never touches the file, when the command cannot start', async () => {
    const result = await probe([], { command: join(dir, 'missing-binary') })
    expect(result.verdict).toBe('ERROR')
    expect(result.reason).toMatch(/^the command could not start: .*ENOENT/)
    expectUntouched()
  })

  // Fails when: run() loses the `catch` around spawn(): its synchronous error would leave
  // breakLine() as a bare message instead of "the command could not start".
  test('reports ERROR, and never touches the file, when the command is not a valid file name', async () => {
    const result = await probe([], { command: 'a\0b' })
    expect(result.verdict).toBe('ERROR')
    expect(result.reason).toMatch(/^the command could not start: .*null bytes/)
    expectUntouched()
  })

  // Fails when: run() stops passing `cwd: spec.cwd` to spawn().
  test('runs the command in the given directory', async () => {
    const where = join(dir, 'cwd.txt')
    const result = await probe(
      script(`require('node:fs').writeFileSync(${JSON.stringify(where)}, process.cwd())`),
      { cwd: dir },
    )
    expect(result.verdict).toBe('NOT CAUGHT')
    expect(readFileSync(where, 'utf8')).toBe(realpathSync(dir))
  })

  // Fails when: probe() drops `if (problem !== undefined) return failure(problem)`, or restore()
  // lets its write error escape: a command that failed would read as CAUGHT while the file is
  // left mutated. The mutated run swaps the file for a directory, which nobody can write a file
  // over, root included, so the test runs as any user.
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

  // Fails when: the `catch` around `writeFileSync(options.file, mutated)` in probe() stops
  // restoring or stops adding what the restore found to the reason. The baseline swaps the file
  // for a directory, so neither the mutation nor the restore can be written, as any user.
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
    // Fails when: run() loses its `setTimeout(..., spec.timeoutMs)`, so a hung baseline never
    // ends, when the reason or `case 'timeout'` of the baseline switch changes, or when
    // terminateGroup() leaves a process of the group alive.
    test('kills a hung baseline and its process group, and never touches the file', async () => {
      const result = await probe(script(hang()), { timeoutSeconds: 1 })
      expect(result).toEqual({ verdict: 'ERROR', reason: 'timed out after 1 s (baseline run)' })
      expectUntouched()
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)

    // Fails when: the last switch of probe() reports something else for `case 'timeout'`, the
    // restore stops happening after a timeout, or signalGroup() signals `group` instead of
    // `-group`, which leaves the grandchild running.
    test('kills a hung mutated run and its process group, and restores the file', async () => {
      const result = await probe(hangsOnMutation(), { timeoutSeconds: 1 })
      expect(result).toEqual({ verdict: 'ERROR', reason: 'timed out after 1 s (mutated run)' })
      expect(readFileSync(file).equals(source)).toBe(true)
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)

    // Fails when: terminateGroup() loses `signalGroup(group, 'SIGKILL')` or waitForGroupToEnd()
    // answers true after its deadline: a command that ignores SIGTERM would outlive the probe.
    test('kills with SIGKILL what ignores SIGTERM', async () => {
      const result = await probe(script(`process.on('SIGTERM', () => {}); ${hang()}`), {
        timeoutSeconds: 1,
        killGraceMs: 200,
      })
      expect(result).toEqual({ verdict: 'ERROR', reason: 'timed out after 1 s (baseline run)' })
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)

    // Fails when: terminateGroup() starts with `signalGroup(group, 'SIGKILL')`, or KILL_GRACE_MS
    // shrinks below the 300 ms this command takes to clean up: a runner that tidies up after
    // SIGTERM would be cut off.
    test('asks with SIGTERM first, and gives the command time to clean up', async () => {
      const cleaned = join(dir, 'cleaned.txt')
      const tidy = `require('node:fs').writeFileSync(${JSON.stringify(cleaned)}, 'clean'); process.exit(0)`
      const onTerm = `process.on('SIGTERM', () => setTimeout(() => { ${tidy} }, 300))`
      const result = await probe(script(`${onTerm}; ${hang()}`), { timeoutSeconds: 1 })
      expect(result.reason).toBe('timed out after 1 s (baseline run)')
      expect(readFileSync(cleaned, 'utf8')).toBe('clean')
    }, 10_000)

    // Fails when: groupExists() asks about `group` instead of `-group`: the probe would
    // go on, and restore the file, while a process of the group is still running.
    test('waits until the whole process group is gone, not just its first process', async () => {
      const lingers = `process.on('SIGTERM', () => setTimeout(() => process.exit(0), 400)); ${IDLE}`
      await probe(script(hang(lingers)), { timeoutSeconds: 1 })
      expectDead(await until(readPids, 'the command to record its pids'))
    }, 10_000)
  })

  // Fails when: run() loses `if (spec.abort?.aborted === true) return { kind: 'aborted' }`: the
  // command would start although the probe was told to stop.
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
  // Fails when: DEFAULT_TIMEOUT_SECONDS changes: the default is documented in --help.
  test('is 60 seconds when --timeout is not given', () => {
    expect(parseTimeout(undefined)).toBe(60)
  })

  // Fails when: parseTimeout() stops reading whole numbers, fractions or the largest value.
  test.each([
    ['90', 90],
    ['0.5', 0.5],
    ['2147483', 2147483],
  ])('reads %s as %d seconds', (text, seconds) => {
    expect(parseTimeout(text)).toBe(seconds)
  })

  // Fails when: the pattern of parseTimeout() accepts more than plain decimals, `seconds > 0` is
  // loosened, or `seconds <= MAX_TIMEOUT_SECONDS` goes (a longer timer fires after 1 ms).
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

// The arguments of a run that replaces `find` with `a - b` in sum.js, then the command.
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
  // Fails when: main() loses its `catch`: a crash of the probe would exit with 1, which reads as
  // NOT CAUGHT. It gets what no caller sends, to make it crash.
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
  // Fails when: the first announce() or the console.log of the verdict in cli() changes: stdout
  // carries the verdict and nothing else, and stderr names the two runs.
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

  // Fails when: run() sets `const output = spec.inheritOutput ? 'inherit' : 'ignore'` to
  // 'ignore': the CLI shows the output of the command, once per run.
  test('shows the output of the command, once per run', async () => {
    const run = await cli(mutate('a + b', script("console.log('ran')")))
    expect(run.stdout).toBe(
      'ran\nran\nNOT CAUGHT: the command passes without the mutation and with it\n',
    )
  })

  // Fails when: run() hands its own stdin to the command (`stdio: ['inherit', ...]`): a command
  // that reads it would wait on the terminal, which the probe does not own.
  test('gives the command no stdin', async () => {
    const reads = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0))"
    const { done } = startCli(mutate('a + b', script(reads), ['--timeout=2']), 'pipe')
    const run = await done
    expect(run.stdout).toBe('NOT CAUGHT: the command passes without the mutation and with it\n')
  }, 10_000)

  // Fails when: cli() loses the `catch` around parseArgs(): the error of a value that starts
  // with "-" would reach main() as a crash, without the usage that explains the --find= form.
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

  // Fails when: the `find` option of parseArgs() stops being a string option, which is what the
  // `--find=<value>` form that the error above points to relies on.
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

  // Fails when: EXIT_CODES changes, or cli() returns something else for a verdict.
  test('exits 0 for CAUGHT, 1 for NOT CAUGHT and 2 for ERROR', async () => {
    expect((await cli(mutate('a + b', guard(file, 'a + b')))).code).toBe(0)
    expect((await cli(mutate('add two', guard(file, 'a + b')))).code).toBe(1)
    expect((await cli(mutate('not in the file', guard(file, 'a + b')))).code).toBe(2)
    expect(readFileSync(file).equals(source)).toBe(true)
  })

  // Fails when: breakLine() stops catching what probe() throws: the CLI would die with a stack
  // trace and exit 1, which reads as NOT CAUGHT.
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

  // Fails when: cli() stops asking for the usage when an option or the command is missing.
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

  // Fails when: cli() stops handing parseTimeout(values.timeout) to breakLine(), so --timeout is
  // ignored and the 60 s default applies: this test would wait for it.
  test('--timeout=<seconds> bounds each run', async () => {
    const run = await cli(mutate('a + b', script(IDLE), ['--timeout=1']))
    expect(run).toMatchObject({
      code: 2,
      stdout: 'ERROR: timed out after 1 s (baseline run)\n',
    })
  }, 10_000)

  // Fails when: cli() stops turning the error of parseTimeout() into a usage error before it
  // runs anything.
  test('rejects a --timeout that is not a number of seconds, before running the command', async () => {
    const marker = join(dir, 'ran.txt')
    const ran = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`
    const run = await cli(mutate('a + b', script(ran), ['--timeout=0']))
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('--timeout must be a number of seconds')
    expect(existsSync(marker)).toBe(false)
    expectUntouched()
  })

  // Fails when: the `help` option or the HELP text of break-line.ts loses what it promises: the
  // default timeout and the exit codes.
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

    // Fails when: INTERRUPT_SIGNALS loses the signal, the listener of cli() stops aborting,
    // `128 + constants.signals[received]` changes, or run() stops killing the group on abort.
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

    // Fails when: the baseline run cannot be aborted, or its 'aborted' reason stops saying that
    // the file was not touched.
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
