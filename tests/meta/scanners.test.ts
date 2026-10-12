import { describe, expect, it } from 'vite-plus/test'
import { workspaceManifestPaths } from '../guards/workspace.ts'
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

// Fails when: the JSONC reader, the Markdown helpers, the source analyzer or the workspace glob
// expander that the guards are built on stop reading what their documented limits promise.

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
