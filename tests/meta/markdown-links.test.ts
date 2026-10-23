import { describe, expect, it } from 'vite-plus/test'
import { anchorsOf, checkMarkdownLinks } from '../guards/markdown-links.ts'
import { describeViolations } from '../guards/types.ts'
import { file } from '../support/fixtures.ts'
import { existsInRepository, readRepoFiles } from '../support/repo.ts'

describe('Markdown links', () => {
  it('every relative link of every Markdown file leads to a file and an anchor that exist', () => {
    const docs = readRepoFiles(
      (path) => path.endsWith('.md') && !path.startsWith('tests/fixtures/'),
    )
    expect(docs.map((doc) => doc.path)).toEqual(
      expect.arrayContaining(['README.md', 'CONTRIBUTING.md']),
    )
    const byPath = new Map(docs.map((doc) => [doc.path, anchorsOf(doc.text)]))
    const violations = checkMarkdownLinks({
      docs,
      exists: existsInRepository,
      anchorsOf: (path) => byPath.get(path),
    })
    expect(describeViolations(violations)).toEqual([])
  })

  describe('self-test: the guard fails on a bad fixture', () => {
    const TREE = new Set([
      'README.md',
      'docs/guide.md',
      'docs/notes',
      'docs/notes/0001-a.md',
      'LICENSE',
    ])
    const ANCHORS: Record<string, string[]> = {
      'docs/guide.md': ['overview', 'decisions', 'decisions-1'],
      'README.md': ['readme'],
    }
    const check = (path: string, text: string) =>
      checkMarkdownLinks({
        docs: [file(path, text)],
        exists: (candidate) => TREE.has(candidate),
        anchorsOf: (candidate) => ANCHORS[candidate],
      })

    it('accepts links to files, directories, anchors and the web', () => {
      const text = [
        '[license](LICENSE) [design](docs/guide.md#overview) [dir](docs/notes/) [self](#readme)',
        '[web](https://example.com/a.md#x) [mail](mailto:a@b.co) ![image](docs/notes/0001-a.md)',
        '[root](/LICENSE) [titled](docs/guide.md "Design") [angle](<docs/guide.md>)',
        '[ref]: docs/guide.md#decisions-1',
      ].join('\n')
      expect(check('README.md', text)).toEqual([])
    })

    it('resolves links relative to the directory of the document', () => {
      expect(
        check('docs/notes/0001-a.md', '[up](../guide.md#overview) [sibling](../notes)'),
      ).toEqual([])
      expect(check('docs/notes/0001-a.md', '[wrong](guide.md)')).toHaveLength(1)
    })

    it('reports a link to a file that does not exist, with its line', () => {
      expect(check('README.md', 'first\n[gone](docs/gone.md#top)')).toEqual([
        {
          rule: 'markdown-links/missing-file',
          file: 'README.md',
          message:
            'line 2: the link to docs/gone.md#top points at docs/gone.md, which does not exist',
        },
      ])
    })

    it('reports an anchor that is not a heading, in another file and in the same one', () => {
      expect(check('README.md', '[x](docs/guide.md#nope) [y](#missing)')).toEqual([
        {
          rule: 'markdown-links/missing-anchor',
          file: 'README.md',
          message:
            'line 1: the link to docs/guide.md#nope points at #nope, which is not a heading of docs/guide.md',
        },
        {
          rule: 'markdown-links/missing-anchor',
          file: 'README.md',
          message:
            'line 1: the link to #missing points at #missing, which is not a heading of README.md',
        },
      ])
    })

    it('reports a broken reference definition and a broken image', () => {
      const result = check('README.md', '[ref]: docs/gone.md\n![img](docs/gone.png)')
      expect(result.map((violation) => violation.rule)).toEqual([
        'markdown-links/missing-file',
        'markdown-links/missing-file',
      ])
    })

    it('does not follow links in code', () => {
      const text = 'Write `[x](docs/gone.md)` like so.\n\n```md\n[y](docs/gone.md)\n```\n'
      expect(check('README.md', text)).toEqual([])
    })

    it('gives headings the anchors GitHub gives them', () => {
      expect(
        anchorsOf(
          [
            '# Title: with `code` and **bold**',
            '## Decisions',
            '## Decisions',
            '## [Linked](x.md) heading!',
            '## Alternatives considered',
            '## Naïve café_ok 2',
          ].join('\n'),
        ),
      ).toEqual([
        'title-with-code-and-bold',
        'decisions',
        'decisions-1',
        'linked-heading',
        'alternatives-considered',
        'naïve-café_ok-2',
      ])
    })
  })
})
