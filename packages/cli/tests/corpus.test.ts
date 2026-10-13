// Fails when:
// - "reads <collection>/<locale>/<slug>.md and sorts the entries": `readCorpus` stops reading the
//   three-level layout, takes another part of the path for the collection, the locale or the
//   slug, or stops sorting by collection, locale and slug.
// - "reports a Markdown file elsewhere as skipped": a `.md` at another depth is imported, or is
//   dropped without being reported.
// - "ignores what is not Markdown, hidden, or a symbolic link": a non-`.md` file, a hidden file
//   or folder, or a symbolic link (which could lead out of the directory) is read.
// - "reports a slug that is not a slug as a problem": a bad slug is imported or skipped
//   silently.
// - "reports bytes that are not UTF-8 as a problem": invalid UTF-8 is decoded with replacement
//   characters instead of being refused.
// - "keeps the byte order mark and the line ends of a file": the text is trimmed, decoded
//   without `ignoreBOM`, or its line ends are changed.
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vite-plus/test'

import { readCorpus } from '../src/import/corpus.ts'
import { tempDirs } from './support/project.ts'

const temp = tempDirs()

describe('readCorpus', () => {
  it('reads <collection>/<locale>/<slug>.md and sorts the entries', () => {
    const root = temp.make({
      'docs/en/intro.md': 'docs intro',
      'blog/es/zeta.md': 'zeta',
      'blog/en/b-post.md': 'b',
      'blog/en/a-post.md': 'a',
      'blog/en/a-post-2.md': 'a2',
    })

    expect(readCorpus(root)).toEqual({
      files: [
        {
          path: 'blog/en/a-post.md',
          collection: 'blog',
          locale: 'en',
          slug: 'a-post',
          markdown: 'a',
        },
        {
          path: 'blog/en/a-post-2.md',
          collection: 'blog',
          locale: 'en',
          slug: 'a-post-2',
          markdown: 'a2',
        },
        {
          path: 'blog/en/b-post.md',
          collection: 'blog',
          locale: 'en',
          slug: 'b-post',
          markdown: 'b',
        },
        {
          path: 'blog/es/zeta.md',
          collection: 'blog',
          locale: 'es',
          slug: 'zeta',
          markdown: 'zeta',
        },
        {
          path: 'docs/en/intro.md',
          collection: 'docs',
          locale: 'en',
          slug: 'intro',
          markdown: 'docs intro',
        },
      ],
      skipped: [],
      problems: [],
    })
  })

  it('reports a Markdown file elsewhere as skipped', () => {
    const root = temp.make({
      'README.md': 'readme',
      'blog/notes.md': 'notes',
      'blog/en/deep/post.md': 'deep',
      'blog/en/ok.md': 'ok',
    })

    const corpus = readCorpus(root)

    expect(corpus.files.map((file) => file.path)).toEqual(['blog/en/ok.md'])
    expect(corpus.skipped).toEqual(['README.md', 'blog/en/deep/post.md', 'blog/notes.md'])
    expect(corpus.problems).toEqual([])
  })

  it('ignores what is not Markdown, hidden, or a symbolic link', () => {
    const outside = temp.make({ 'secret.md': 'not for upload', 'folder/inner.md': 'inner' })
    const root = temp.make({
      'blog/en/post.md': 'post',
      'blog/en/image.png': 'png',
      'blog/en/page.markdown': 'markdown',
      'blog/en/UPPER.MD': 'upper',
      'blog/en/.draft.md': 'draft',
      '.git/en/x.md': 'git',
      'blog/.hidden/en/x.md': 'hidden',
    })
    symlinkSync(join(outside, 'secret.md'), join(root, 'blog', 'en', 'link.md'))
    symlinkSync(join(outside, 'folder'), join(root, 'blog', 'linked'))

    const corpus = readCorpus(root)

    expect(corpus.files.map((file) => file.path)).toEqual(['blog/en/post.md'])
    expect(corpus.skipped).toEqual([])
    expect(corpus.problems).toEqual([])
  })

  it.each(['My Post', 'a_b', 'Caps', 'a--b', '-a', 'a.b', 'x'.repeat(201)])(
    'reports the slug %j as a problem',
    (slug) => {
      const root = temp.make({ [`blog/en/${slug}.md`]: 'text' })

      const corpus = readCorpus(root)

      expect(corpus.files).toEqual([])
      expect(corpus.problems).toEqual([
        {
          path: `blog/en/${slug}.md`,
          reason: `${JSON.stringify(slug)} is not a slug: use lowercase letters and digits joined by hyphens, up to 200 characters.`,
        },
      ])
    },
  )

  it('reports bytes that are not UTF-8 as a problem', () => {
    const root = temp.make({ 'blog/en/ok.md': 'ok' })
    writeFileSync(join(root, 'blog', 'en', 'latin1.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9]))

    const corpus = readCorpus(root)

    expect(corpus.files.map((file) => file.slug)).toEqual(['ok'])
    expect(corpus.problems).toEqual([
      { path: 'blog/en/latin1.md', reason: 'the file is not valid UTF-8.' },
    ])
  })

  it('keeps the byte order mark and the line ends of a file', () => {
    const root = temp.make()
    mkdirSync(join(root, 'blog', 'en'), { recursive: true })
    writeFileSync(
      join(root, 'blog', 'en', 'bom.md'),
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from('---\r\ntitle: A\r\n---\r\n\r\nbody  \r\n\r\n'),
      ]),
    )

    const [file] = readCorpus(root).files

    expect(file?.markdown.codePointAt(0)).toBe(0xfeff)
    expect(file?.markdown.slice(1)).toBe('---\r\ntitle: A\r\n---\r\n\r\nbody  \r\n\r\n')
  })
})
