import { describe, expect, it } from 'vite-plus/test'
import { workspaceManifestPaths } from '../guards/workspace.ts'
import { exportedNames, importBindings, indexCalls } from '../support/ast.ts'
import { parseJsonc, stripJsonc } from '../support/jsonc.ts'
import {
  fencedLines,
  headings,
  inlineCodeSpans,
  sectionLines,
  stripFencedBlocks,
  tableCells,
} from '../support/markdown.ts'
import { analyzeSource } from '../support/source.ts'
import { taskGraph, vpRunTask, vpRunTasks } from '../support/vp.ts'

// Fails when: the JSONC reader, the Markdown helpers, the source analyzer, the syntax-tree readers
// (exports, imports, calls), the Vite+ task readers or the workspace glob expander that the guards are
// built on stop reading what their documented limits promise.

describe('JSONC', () => {
  it('removes comments and trailing commas, and keeps strings untouched', () => {
    const text = `{
      // a line comment with "quotes"
      "url": "https://example.com/a//b", /* block */ "list": [1, 2, /* c */ ],
      "note": "not /* a comment */ and, }",
      "esc": "quote \\" // still a string",
      "nested": { "a": [ { "b": 1, }, ], },
    }`
    expect(parseJsonc(text)).toEqual({
      ok: true,
      value: {
        url: 'https://example.com/a//b',
        list: [1, 2],
        note: 'not /* a comment */ and, }',
        esc: 'quote " // still a string',
        nested: { a: [{ b: 1 }] },
      },
    })
  })

  it('keeps every offset, so errors point at the right line', () => {
    const text = '{\n  // comment\n  "a": 1, /* two\n lines */\n}\n'
    expect(stripJsonc(text)).toHaveLength(text.length)
    expect(stripJsonc(text).split('\n')).toHaveLength(text.split('\n').length)
  })

  it('reports a syntax error and an unterminated comment instead of throwing', () => {
    expect(parseJsonc('{ "a": ').ok).toBe(false)
    expect(parseJsonc('{ "a": 1 } // trailing').ok).toBe(true)
    expect(parseJsonc('{ "a": 1 } /* never closed').ok).toBe(true)
    expect(parseJsonc('{ "a": 1,, }').ok).toBe(false)
  })
})

describe('Markdown helpers', () => {
  const text = [
    '# Title',
    '',
    'Run `vp check` and ``code with ` tick``.',
    '',
    '```sh',
    '# not a heading, `not code`',
    '```',
    '',
    '## Guards',
    '',
    '- `a.ts` first',
    '- `b.ts` second',
    '',
    '~~~',
    '## also not a heading',
    '~~~',
    '',
    '## After',
    '| a | b \\| c |',
  ].join('\n')

  it('empties fenced blocks and keeps the line count', () => {
    const stripped = stripFencedBlocks(text)
    expect(stripped.split('\n')).toHaveLength(text.split('\n').length)
    expect(stripped).not.toContain('not a heading')
    expect(stripped).toContain('## Guards')
  })

  it('knows which lines are fenced, an unclosed fence running to the end', () => {
    const lines = fencedLines('a\n```\nb\nc').map((line) => line.inFence)
    expect(lines).toEqual([false, true, true, true])
    // A longer fence is not closed by a shorter one.
    expect(fencedLines('````\n```\nx\n````\ny').map((line) => line.inFence)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ])
  })

  it('lists the headings outside fences with their level and line', () => {
    expect(headings(text)).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Guards', line: 9 },
      { level: 2, text: 'After', line: 18 },
    ])
  })

  it('reads inline code spans, including a longer fence of backticks', () => {
    expect(inlineCodeSpans(text).map((span) => span.text)).toEqual([
      'vp check',
      'code with ` tick',
      'a.ts',
      'b.ts',
    ])
    expect(inlineCodeSpans('an unclosed `tick and `x`')).toEqual([{ text: 'tick and', line: 1 }])
  })

  it('returns the lines of a level-2 section up to the next heading', () => {
    expect(sectionLines(text, 'Guards').filter((entry) => entry.line.startsWith('- '))).toEqual([
      { line: '- `a.ts` first', number: 11 },
      { line: '- `b.ts` second', number: 12 },
    ])
    expect(sectionLines(text, 'Missing')).toEqual([])
  })

  it('splits a table row into trimmed cells and honors an escaped pipe', () => {
    expect(tableCells('| a | b \\| c |')).toEqual(['a', 'b \\| c'])
    expect(tableCells('| --- | --- |')).toEqual(['---', '---'])
    expect(tableCells('not a row')).toBeUndefined()
  })
})

describe('source analyzer', () => {
  const analyze = (text: string) => analyzeSource('a.ts', text)

  it('reads every form of import, with its kind and line', () => {
    const { references, syntaxErrors } = analyze(
      [
        "import a from 'a'",
        "import type { B } from 'b'",
        "import 'c'",
        "export * from 'd'",
        "export { e } from 'e'",
        "const f = await import('f')",
        'const g = import(`g`)',
        "type H = typeof import('h')",
        "const i = require('i')",
        "const j = require.resolve('j')",
        "import k = require('k')",
      ].join('\n'),
    )
    expect(syntaxErrors).toEqual([])
    expect(references).toEqual([
      { specifier: 'a', kind: 'import', line: 1 },
      { specifier: 'b', kind: 'import', line: 2 },
      { specifier: 'c', kind: 'import', line: 3 },
      { specifier: 'd', kind: 'export-from', line: 4 },
      { specifier: 'e', kind: 'export-from', line: 5 },
      { specifier: 'f', kind: 'dynamic-import', line: 6 },
      { specifier: 'g', kind: 'dynamic-import', line: 7 },
      { specifier: 'h', kind: 'import-type', line: 8 },
      { specifier: 'i', kind: 'require', line: 9 },
      { specifier: 'j', kind: 'require-resolve', line: 10 },
      { specifier: 'k', kind: 'import-equals', line: 11 },
    ])
  })

  it('skips computed specifiers and everything that is only text', () => {
    const { references } = analyze(
      [
        '#!/usr/bin/env node',
        "// import x from 'comment'",
        '/* require("block") */',
        'const s = "import y from \'string\'"',
        "const t = `import z from 'template' ${import('inside')}`",
        "const r = /import\\('regex'\\)/",
        'const dynamic = await import(name)',
        "const concatenated = require('a' + 'b')",
      ].join('\n'),
    )
    expect(references).toEqual([{ specifier: 'inside', kind: 'dynamic-import', line: 5 }])
  })

  it('finds Node globals by name, and skips property names, declarations and calls', () => {
    const { globals } = analyze(
      [
        'const a = process.env',
        'const b = typeof Buffer',
        'const c = { process: 1, __dirname: 2 }',
        'const d = c.process + c.require',
        'class E { process() {} require = 1 }',
        'function process2() {}',
        'function process(x) { return x }',
        'process(1)',
        'const f = globalThis.process',
        'const g = __filename',
        'interface H { require: string }',
      ].join('\n'),
    )
    expect(globals).toEqual([
      { name: 'process', line: 1 },
      { name: 'Buffer', line: 2 },
      { name: 'globalThis.process', line: 9 },
      { name: '__filename', line: 10 },
    ])
  })

  it('reports a syntax error and still returns what it could read', () => {
    expect(analyze('import {').syntaxErrors.length).toBeGreaterThan(0)
  })
})

describe('syntax-tree readers', () => {
  it('lists the value exports of a module, whatever way they are declared', () => {
    const text = [
      'export function plain() {}',
      'export async function asynchronous() {}',
      'export const arrow = () => 1, second = 2',
      'export let counter = 0',
      'const local = 1',
      'export { local, local as renamed }',
      "export { fromOther } from './other.ts'",
      "export { a as 'string name' } from './other.ts'",
      'export type { OnlyAType }',
      'export { type InlineType, inlineValue }',
      'export type Alias = string',
      'export interface Shape { a: string }',
      'export default function fallback() {}',
      "export * from './star.ts'",
      'export const { destructured } = { destructured: 1 }',
      '// export function inComment() {}',
      'const text = "export function inString() {}"',
    ].join('\n')
    expect(exportedNames('a.ts', text)).toEqual([
      'plain',
      'asynchronous',
      'arrow',
      'second',
      'counter',
      'local',
      'renamed',
      'fromOther',
      'string name',
      'inlineValue',
    ])
  })

  it('lists the value bindings of the imports of a file, with their local names', () => {
    const text = [
      "import { a, b as c, type D, type E as F } from './x.ts'",
      "import type { G } from './y.ts'",
      "import def from './z.ts'",
      "import * as ns from './w.ts'",
      "import Both, { h } from './v.ts'",
      "import './effect.ts'",
      'const note = "import { x } from \'string\'"',
    ].join('\n')
    expect(importBindings('a.ts', text)).toEqual([
      { specifier: './x.ts', imported: 'a', local: 'a' },
      { specifier: './x.ts', imported: 'b', local: 'c' },
      { specifier: './z.ts', imported: 'default', local: 'def' },
      { specifier: './w.ts', imported: '*', local: 'ns' },
      { specifier: './v.ts', imported: 'default', local: 'Both' },
      { specifier: './v.ts', imported: 'h', local: 'h' },
    ])
  })

  describe('calls', () => {
    const index = (text: string) => indexCalls('a.ts', text)
    const direct = (text: string) => [...index(text).directCalls(0, text.length)].sort()

    it('names a call by its callee when that is a name or a member of one', () => {
      const text = [
        'one(1)',
        'ns.two(2)',
        "ns['three'](3)",
        'four?.(4)',
        'five!(5)',
        ';(six as Fn)(6)',
        ';(seven satisfies Fn)(7)',
        ';(guard as Guard).cast(12)',
        'a.b.c(7)',
        'list[0](8)',
        'make()()',
        'new Eight()',
        'new.target',
        '// ignored(9)',
        'const s = "ignored(10)"',
        'const t = `ignored(${eleven(11)})`',
      ].join('\n')
      expect(direct(text)).toEqual([
        'eleven',
        'five',
        'four',
        'guard.cast',
        'make',
        'ns.three',
        'ns.two',
        'one',
        'seven',
        'six',
      ])
    })

    it('limits the calls to an offset range', () => {
      const text = 'before(1)\nTARGET(inside(2))\nafter(3)'
      const start = text.indexOf('TARGET')
      const end = text.indexOf('\nafter')
      expect([...index(text).directCalls(start, end)].sort()).toEqual(['TARGET', 'inside'])
      expect([...index(text).directCalls(0, start)]).toEqual(['before'])
    })

    it('follows a function the file defines into the calls it makes, and theirs', () => {
      const text = [
        'function inner() { deep() }',
        'const middle = () => inner()',
        'const outer = async function () { middle() }',
        'const unrelated = () => never()',
        'outer()',
      ].join('\n')
      // Only the last line calls anything that is defined here.
      const start = text.indexOf('outer()')
      expect([...index(text).directCalls(start, text.length)]).toEqual(['outer'])
      expect([...index(text).reachableCalls(start, text.length)].sort()).toEqual([
        'deep',
        'inner',
        'middle',
        'outer',
      ])
    })

    it('does not follow a function that is only named, and survives recursion', () => {
      const text = [
        'const helper = () => target()',
        'const loop = () => { loop(); other() }',
        'const passed = [helper]',
        'loop()',
      ].join('\n')
      const start = text.lastIndexOf('loop()')
      expect([...index(text).reachableCalls(start, text.length)].sort()).toEqual(['loop', 'other'])
    })

    it('resolves a name in the closest scope around the call, not in a neighbour', () => {
      // Four scopes, each with a `check` of its own: a function declaration, an arrow function, a
      // function expression and the file.
      const text = [
        'function first() {',
        '  const check = () => fromDeclaration()',
        '  check()',
        '}',
        "describe('second', () => {",
        '  const check = () => fromArrow()',
        '  check()',
        '})',
        "describe('third', function () {",
        '  const check = () => fromExpression()',
        '  check()',
        '})',
        'const check = () => fromFile()',
        'check()',
      ].join('\n')
      /** What the `check()` that follows `marker` reaches. */
      const reachedFrom = (marker: string) => {
        const start = text.indexOf('check()', text.indexOf(marker))
        return [...index(text).reachableCalls(start, start + 'check()'.length)].sort()
      }
      expect(reachedFrom('function first')).toEqual(['check', 'fromDeclaration'])
      expect(reachedFrom("describe('second'")).toEqual(['check', 'fromArrow'])
      expect(reachedFrom("describe('third'")).toEqual(['check', 'fromExpression'])
      expect(reachedFrom('const check = () => fromFile()')).toEqual(['check', 'fromFile'])
    })
  })
})

describe('Vite+ task readers', () => {
  it('finds the task after the options of `vp run`, and stops at `--`', () => {
    expect(vpRunTask(['build'])).toBe('build')
    expect(vpRunTask(['-r', 'build'])).toBe('build')
    expect(vpRunTask(['-F', '@a/b', '--log', 'grouped', 'test', 'extra'])).toBe('test')
    expect(vpRunTask(['--concurrency-limit', '8', '-r', 'build'])).toBe('build')
    expect(vpRunTask([])).toBeUndefined()
    expect(vpRunTask(['-r'])).toBeUndefined()
    expect(vpRunTask(['--', 'build'])).toBeUndefined()
  })

  describe('tasks a script runs', () => {
    it('reads vp run in every shape a workflow or a task uses', () => {
      expect(vpRunTasks('vp run check:push')).toEqual(['check:push'])
      expect(vpRunTasks('pnpm exec vp run -r build')).toEqual(['build'])
      expect(vpRunTasks('./node_modules/.bin/vp run -F @hollware/core build')).toEqual(['build'])
      expect(vpRunTasks('vpr test:acceptance -- agent-flow')).toEqual(['test:acceptance'])
      expect(vpRunTasks('FORCE_COLOR=1 CI=true vp run lint')).toEqual(['lint'])
      expect(vpRunTasks('vp check && vp run a ; vp run b | cat || vp run c')).toEqual([
        'a',
        'b',
        'c',
      ])
      expect(vpRunTasks('set -e\nif true; then\n  vp run inner\nfi\nvp run last')).toEqual([
        'inner',
        'last',
      ])
      expect(vpRunTasks('vp run \\\n  check:push')).toEqual(['check:push'])
    })

    it('does not take a mention, a comment or another vp command for a run', () => {
      expect(vpRunTasks('echo vp run nope')).toEqual([])
      expect(vpRunTasks('# vp run commented\nvp run real # vp run trailing')).toEqual(['real'])
      // A separator inside a comment does not begin another command.
      expect(vpRunTasks('# first; vp run hidden\nvp run real # and then; vp run hidden')).toEqual([
        'real',
      ])
      expect(vpRunTasks('vp check\nvp test\nvp run\nvp run -- build\nvp build')).toEqual([])
      expect(vpRunTasks('run: vp run in-a-key')).toEqual([])
      expect(vpRunTasks('')).toEqual([])
    })

    it('reads a task of the root package without its prefix, and keeps the others whole', () => {
      expect(vpRunTasks('vp run hollware-monorepo#check:push', 'hollware-monorepo')).toEqual([
        'check:push',
      ])
      expect(vpRunTasks('vp run @a/b#build', 'hollware-monorepo')).toEqual(['@a/b#build'])
      expect(vpRunTasks('vp run hollware-monorepo#check:push')).toEqual([
        'hollware-monorepo#check:push',
      ])
    })
  })

  it('lists, for each task of run.tasks, the tasks it runs by command and by dependsOn', () => {
    const config = {
      run: {
        tasks: {
          'check:push': { command: ['vp check', 'vp run -r build', 'vp run test:acceptance'] },
          deploy: {
            command: 'echo deploy',
            dependsOn: ['build', { task: 'test', from: 'dependencies' }, 'root#lint', 3],
          },
          build: 'vp build',
          twice: ['vp run build', 'vp run build'],
          odd: { cache: false },
          broken: { command: 3 },
        },
      },
    }
    expect(taskGraph(config, 'root')).toEqual({
      'check:push': ['build', 'test:acceptance'],
      deploy: ['build', 'test', 'lint'],
      build: [],
      twice: ['build'],
      odd: [],
      broken: [],
    })
    expect(taskGraph({}, 'root')).toEqual({})
    expect(taskGraph({ run: { tasks: [] } })).toEqual({})
  })
})

describe('workspace globs', () => {
  const files = [
    'apps/a/package.json',
    'apps/a/site/package.json',
    'packages/x/package.json',
    'packages/x/tests/fixtures/package.json',
    'examples/README.md',
    'package.json',
  ]

  it('expands `dir/*` to the manifests one level down, and always includes the root', () => {
    expect(workspaceManifestPaths(['apps/*', 'packages/*', 'examples/*'], files)).toEqual({
      paths: ['apps/a/package.json', 'package.json', 'packages/x/package.json'],
      unsupportedGlobs: [],
    })
  })

  it('reports globs it cannot expand instead of guessing', () => {
    expect(
      workspaceManifestPaths(['packages/**', '!excluded/*', 'one-dir'], files).unsupportedGlobs,
    ).toEqual(['packages/**', '!excluded/*', 'one-dir'])
  })
})
