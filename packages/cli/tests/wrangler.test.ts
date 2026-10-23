import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { CliError } from '../src/errors.ts'
import { createWranglerRunner, failureReason, findWrangler, stripAnsi } from '../src/wrangler.ts'
import { tempDirs } from './support/project.ts'

const temp = tempDirs()

function withWrangler(directory: string, script: string): string {
  const bin = join(directory, 'node_modules', '.bin', 'wrangler')
  mkdirSync(dirname(bin), { recursive: true })
  writeFileSync(bin, `#!/bin/sh\n${script}\n`)
  chmodSync(bin, 0o755)
  return bin
}

describe('createWranglerRunner', () => {
  it('runs the wrangler of the project, in the project, with the arguments as they are', async () => {
    const project = temp.make()
    withWrangler(project, 'echo "cwd:$PWD"; for arg in "$@"; do echo "arg:$arg"; done')
    const run = createWranglerRunner(project)
    const result = await run([
      'd1',
      'execute',
      'DB',
      '--command',
      'SELECT \'a b\'; -- $HOME `x` "y"',
    ])
    expect(result).toEqual({
      code: 0,
      stdout: [
        `cwd:${realpathSync(project)}`,
        'arg:d1',
        'arg:execute',
        'arg:DB',
        'arg:--command',
        'arg:SELECT \'a b\'; -- $HOME `x` "y"',
        '',
      ].join('\n'),
      stderr: '',
    })
  })

  it('returns what wrangler printed and its exit code', async () => {
    const project = temp.make()
    withWrangler(project, 'echo "to stdout"; echo "to stderr" >&2; exit 3')
    expect(await createWranglerRunner(project)([])).toEqual({
      code: 3,
      stdout: 'to stdout\n',
      stderr: 'to stderr\n',
    })
  })

  it('never leaves stdin open for wrangler to wait on', async () => {
    const project = temp.make()
    withWrangler(project, 'input=$(cat); echo "stdin:[$input]"')
    expect((await createWranglerRunner(project)([])).stdout).toBe('stdin:[]\n')
  })

  it('uses the nearest wrangler, so a workspace that hoists its dependencies works', async () => {
    const root = temp.make()
    const app = join(root, 'packages', 'app')
    mkdirSync(app, { recursive: true })
    withWrangler(root, 'echo "root wrangler"')
    expect((await createWranglerRunner(app)([])).stdout).toBe('root wrangler\n')

    withWrangler(app, 'echo "app wrangler"')
    expect((await createWranglerRunner(app)([])).stdout).toBe('app wrangler\n')
    expect(findWrangler(app)).toBe(join(app, 'node_modules', '.bin', 'wrangler'))
  })

  it('says how to install wrangler when the project has none', async () => {
    const project = temp.make()
    const run = createWranglerRunner(project)
    await expect(run(['d1', 'list'])).rejects.toThrow(
      new CliError(
        `wrangler is not installed in ${project} or any directory above it. Install it in the project (for example "pnpm add -D wrangler") and run hollware from the project directory.`,
      ),
    )
  })
})

const REAL_STDERR =
  '\u001B[33m▲ \u001B[43;33m[\u001B[43;30mWARNING\u001B[43;33m]\u001B[0m \u001B[1mNo migrations folder found. Set `migrations_dir` in your wrangler.jsonc file to choose a different path.\u001B[0m\n\n\n\u001B[31m✘ \u001B[41;31m[\u001B[41;97mERROR\u001B[41;31m]\u001B[0m \u001B[1mNo migrations present at /project/migrations.\u001B[0m\n\n\n🪵  Logs were written to "/Users/someone/Library/Preferences/.wrangler/logs/wrangler-2026-10-12_21-30-29_186.log"\n'

describe('failureReason', () => {
  it.each([
    [
      'the text of the JSON error on stdout',
      {
        code: 1,
        stdout: '\n{\n  "error": {\n    "text": "no such table: nope: SQLITE_ERROR"\n  }\n}\n',
        stderr: '',
      },
      'no such table: nope: SQLITE_ERROR',
    ],
    [
      'a JSON error that is a string',
      { code: 1, stdout: '{"error":"plain"}', stderr: '' },
      'plain',
    ],
    [
      'the first [ERROR] of stderr, without colors, ignoring the warning before it',
      { code: 1, stdout: '', stderr: REAL_STDERR },
      'No migrations present at /project/migrations.',
    ],
    [
      'an [ERROR] that goes on over more lines, up to the blank one',
      {
        code: 1,
        stdout: '',
        stderr:
          '✘ [ERROR] Found both a user configuration file at "wrangler.jsonc"\n  and a deploy configuration file at "../.wrangler/deploy/config.json".\n\n  More help below.\n',
      },
      'Found both a user configuration file at "wrangler.jsonc" and a deploy configuration file at "../.wrangler/deploy/config.json".',
    ],
    [
      'the last line of stderr when there is no [ERROR], ignoring the notice about the log file',
      {
        code: 1,
        stdout: 'banner',
        stderr: 'something odd\nlast words\n🪵  Logs were written to "/x.log"\n',
      },
      'last words',
    ],
    [
      'the last line of stdout when stderr is empty',
      { code: 2, stdout: 'first\nlast line\n', stderr: '' },
      'last line',
    ],
    [
      'that wrangler printed nothing',
      { code: 2, stdout: '', stderr: '\n' },
      'wrangler exited with code 2 and printed nothing',
    ],
  ])('is %s', (_what, result, reason) => {
    expect(failureReason(result)).toBe(reason)
  })

  it('collapses white space and cuts a long reason at 400 characters', () => {
    const reason = failureReason({ code: 1, stdout: '', stderr: `error:${'  word'.repeat(200)}` })
    expect(reason).toBe(`error:${' word'.repeat(78)} wor…`)
    expect(reason).toHaveLength(401)
  })
})

describe('stripAnsi', () => {
  it('removes the color codes of wrangler', () => {
    expect(stripAnsi('\u001B[31m✘ \u001B[41;31m[\u001B[0mERROR\u001B[0m')).toBe('✘ [ERROR')
  })
})
