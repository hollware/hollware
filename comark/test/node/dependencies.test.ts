import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vite-plus/test'
import { COMARK_HTML_VERSION, COMARK_VERSION, MARKDOWN_EXIT_VERSION } from '../../src/versions.ts'
import { closureOf, findNodeImports } from './support/closure.ts'

// S3f. Fails when: a Comark upgrade changes which markdown-exit it pins, adds or drops a package in
// the closure, or adds an import of a Node.js built-in anywhere in it (then the answer to "does it
// need nodejs_compat" must be re-checked against the Worker bundle). Also binds the pinned version
// constants of src/versions.ts to the installed packages, which is how the pipeline knows its own
// Comark version (Comark exposes none at runtime).

const appDir = new URL('../../', import.meta.url).pathname
const closure = closureOf(appDir, ['comark', '@comark/html'])

describe('the dependency closure of comark and @comark/html', () => {
  it('has exactly these packages (types-only packages included)', () => {
    expect([...closure.keys()].sort()).toStrictEqual([
      '@comark/html@0.7.0',
      '@types/linkify-it@5.0.0',
      '@types/mdurl@2.0.0',
      'argparse@2.0.1',
      'comark@0.7.0',
      'dom-serializer@3.1.1',
      'domelementtype@3.0.0',
      'domhandler@6.0.1',
      'domutils@4.0.2',
      'entities@7.0.1',
      'entities@8.1.0',
      'htmlparser2@12.0.0',
      'js-yaml@5.4.3',
      'linkify-it@5.0.2',
      'markdown-exit@1.1.0-beta.2',
      'mdurl@2.1.0',
      'punycode.js@2.3.1',
      'uc.micro@2.1.0',
    ])
  })

  it('comark pins markdown-exit to an exact prerelease, @comark/html pins comark', () => {
    expect(closure.get('comark@0.7.0')?.manifest.dependencies).toStrictEqual({
      entities: '^8.0.0',
      htmlparser2: '^12.0.0',
      'js-yaml': '^5.2.1',
      'markdown-exit': '1.1.0-beta.2',
    })
    expect(closure.get('@comark/html@0.7.0')?.manifest.dependencies).toStrictEqual({
      comark: '0.7.0',
    })
  })

  it('markdown-exit 1.1.0-beta.2 depends on pure-JavaScript packages only', () => {
    expect(closure.get('markdown-exit@1.1.0-beta.2')?.manifest.dependencies).toStrictEqual({
      '@types/linkify-it': '^5.0.0',
      '@types/mdurl': '^2.0.0',
      entities: '^7.0.0',
      'linkify-it': '^5.0.1',
      mdurl: '^2.0.0',
      'punycode.js': '^2.3.1',
      'uc.micro': '^2.1.0',
    })
  })

  it('two majors of entities are installed (markdown-exit wants 7, comark and htmlparser2 want 8)', () => {
    const versions = [...closure.keys()].filter((id) => id.startsWith('entities@')).sort()

    expect(versions).toStrictEqual(['entities@7.0.1', 'entities@8.1.0'])
  })

  it('only four files import a Node.js built-in: a CLI, an optional stream entry and argparse', () => {
    expect(findNodeImports(closure)).toStrictEqual([
      { file: 'argparse@2.0.1:argparse.js', builtins: ['assert', 'fs', 'path', 'util'] },
      { file: 'argparse@2.0.1:lib/sub.js', builtins: ['util'] },
      {
        file: 'htmlparser2@12.0.0:dist/WritableStream.js',
        builtins: ['node:stream', 'node:string_decoder'],
      },
      { file: 'js-yaml@5.4.3:bin/js-yaml.mjs', builtins: ['node:fs'] },
    ])
  })

  it('and none of the four is reachable from what comark imports', () => {
    // js-yaml's bin/ is its CLI (only argparse uses assert/fs/path/util), htmlparser2's WritableStream
    // is the subpath "htmlparser2/WritableStream" while comark imports the package root. Checked
    // against the files comark itself imports, by name.
    const comark = closure.get('comark@0.7.0')?.dir ?? ''
    const sources = [
      'parse.js',
      'internal/yaml.js',
      'internal/parse/html/index.js',
      'utils/index.js',
    ]
      .map((file) => readFileSync(`${comark}/dist/${file}`, 'utf8'))
      .join('\n')

    expect(sources).toContain("from 'htmlparser2'")
    expect(sources).not.toContain('htmlparser2/WritableStream')
    expect(sources).toContain("from 'js-yaml'")
    expect(sources).not.toContain('argparse')
  })
})

describe('the pinned versions in src/versions.ts', () => {
  it('match the installed packages', () => {
    expect(closure.get(`comark@${COMARK_VERSION}`)?.manifest.version).toBe('0.7.0')
    expect(closure.get(`@comark/html@${COMARK_HTML_VERSION}`)?.manifest.version).toBe('0.7.0')
    expect(closure.get(`markdown-exit@${MARKDOWN_EXIT_VERSION}`)?.manifest.version).toBe(
      '1.1.0-beta.2',
    )
  })

  it('match the exact versions this app declares', () => {
    const manifest: { dependencies: Record<string, string> } = JSON.parse(
      readFileSync(`${appDir}package.json`, 'utf8'),
    )

    expect(manifest.dependencies).toStrictEqual({
      '@comark/html': COMARK_HTML_VERSION,
      comark: COMARK_VERSION,
    })
  })
})
