import { processMarkdown } from '@hollware/core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import {
  alertOf,
  compactId,
  corpusFromNotion,
  notionId,
  slugOf,
  withCustomEmojis,
  type Download,
  type NotionLoader,
  type NotionOptions,
  type NotionRecordMap,
} from '../src/import/from-notion.ts'
import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'
import { startStub, type StubServer } from './support/stub-hollware.ts'

const WORKSPACE: Record<string, NotionRecordMap> = JSON.parse(
  readFileSync(new URL('./fixtures/notion/workspace.json', import.meta.url), 'utf8'),
)

const ROOT = 'https://www.notion.so/Guide-00000000000040008000000000000001?pvs=4'
const BLOCKS = '00000000000040008000000000000002'
const LINKS = '00000000000040008000000000000005'
const LINKS_AGAIN = '00000000000040008000000000000008'
const ODD = '00000000000040008000000000000100'

function png(tag: string): Uint8Array {
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from(tag)])
}

const IMAGES: Readonly<Record<string, Uint8Array>> = {
  'https://cdn.example/red.png': png('red'),
  'https://signed.example/dot.png?sig=1': png('dot'),
  'https://emoji.example/party.png': png('party'),
  'https://emoji.example/star.png': png('star'),
}

const loader: NotionLoader = {
  getPage: (id) => {
    const page = WORKSPACE[compactId(notionId(id) ?? '')]
    return page === undefined ? Promise.reject(new Error('no such page')) : Promise.resolve(page)
  },
}

const download: Download = (url) => {
  const bytes = IMAGES[url]
  return Promise.resolve(
    bytes === undefined ? new Response('gone', { status: 404 }) : new Response(bytes),
  )
}

function convert(options: Partial<NotionOptions> = {}) {
  return corpusFromNotion({
    root: ROOT,
    collection: 'docs',
    locale: 'en',
    sectionField: 'section',
    orderField: 'order',
    callouts: 'components',
    toggles: 'details',
    slugMap: {},
    target: { components: ['callout', 'details'], route: '/docs/:slug' },
    loader,
    download,
    ...options,
  })
}

async function markdownOf(slug: string, options: Partial<NotionOptions> = {}): Promise<string> {
  const { corpus } = await convert(options)
  return corpus.files.find((file) => file.slug === slug)?.markdown ?? ''
}

function bodyOf(markdown: string): string {
  return markdown.slice(markdown.indexOf('\n---\n') + '\n---\n'.length)
}

describe('a Notion page becomes Markdown', () => {
  it('turns each kind of block into its Markdown, in order, nested lists indented', async () => {
    expect(bodyOf(await markdownOf('blocks'))).toBe(
      [
        '',
        'Plain **bold** and _italic_ ~~struck~~ `code` [link](https://example.com) red a\\*b',
        '',
        '## Section',
        '',
        '### Sub',
        '',
        '#### Subsub',
        '',
        '- One',
        '  - One A',
        '    - One A i',
        '- Two',
        '',
        '1. First',
        '   1. Inner',
        '2. Second',
        '',
        '- [ ] Task',
        '- [x] Done',
        '',
        '> Quoted\\',
        '> line',
        '',
        '---',
        '',
        '```typescript',
        'const a = 1',
        '```',
        '',
        '`e=mc^2`',
        '',
        '| Name | Age |',
        '| --- | --- |',
        '| Ana | 3 |',
        '',
        '|  |  |',
        '| --- | --- |',
        '| x | y |',
        '',
        'Left',
        '',
        'Right',
        '',
      ].join('\n'),
    )
  })

  it('reports per page what it dropped or changed', async () => {
    const { report } = await convert()

    expect(report.find((page) => page.id === BLOCKS)).toEqual({
      id: BLOCKS,
      title: 'Blocks',
      slug: 'blocks',
      notes: [
        'text color dropped',
        'equation kept as inline code',
        'table without a header row: an empty header row was added',
        'table of contents dropped: the site builds its own',
        'breadcrumb dropped',
        'database dropped: databases are not imported',
      ],
    })
  })

  it('writes callouts and toggles as the components ::callout and ::details', async () => {
    expect(bodyOf(await markdownOf('callouts'))).toBe(
      [
        '',
        '::callout{icon="💡" tone="gray"}',
        'Tip text',
        '',
        'More',
        '::',
        '',
        '::callout{tone="red"}',
        'Danger',
        '::',
        '',
        '::callout{icon="asset:ast_9885cb070e95da1ae67f6c5ac6" tone="blue"}',
        'Custom',
        '::',
        '',
        '::details{summary="Read more"}',
        'Hidden',
        '::',
        '',
        '[https://youtu.be/x](https://youtu.be/x)',
        '',
      ].join('\n'),
    )
  })

  it('writes callouts as alerts by their color with --callouts alerts, and toggles flat with --toggles flatten', async () => {
    expect(bodyOf(await markdownOf('callouts', { callouts: 'alerts', toggles: 'flatten' }))).toBe(
      [
        '',
        '> [!NOTE]',
        '> Tip text',
        '>',
        '> More',
        '',
        '> [!CAUTION]',
        '> Danger',
        '',
        '> [!TIP]',
        '> Custom',
        '',
        '**Read more**',
        '',
        'Hidden',
        '',
        '[https://youtu.be/x](https://youtu.be/x)',
        '',
      ].join('\n'),
    )
  })

  it('maps each Notion color to the alert type of its meaning', () => {
    const colors = ['default', 'gray', 'blue', 'yellow', 'orange', 'brown', 'red', 'pink']
    const more = ['purple', 'green', 'teal', 'unknown']

    expect([...colors, ...more].map(alertOf)).toEqual([
      'NOTE',
      'NOTE',
      'TIP',
      'WARNING',
      'WARNING',
      'WARNING',
      'CAUTION',
      'CAUTION',
      'IMPORTANT',
      'IMPORTANT',
      'IMPORTANT',
      'NOTE',
    ])
  })

  it('writes a video as ::embed when the collection declares embed, and as a link with a note when not', async () => {
    const embedded = await convert({
      target: { components: ['callout', 'details', 'embed'], route: '/docs/:slug' },
    })
    const linked = await convert()

    expect(embedded.corpus.files.find((file) => file.slug === 'callouts')?.markdown).toContain(
      '\n::embed{url="https://youtu.be/x"}\n::\n',
    )
    expect(embedded.report.find((page) => page.slug === 'callouts')?.notes).toEqual([])
    expect(linked.report.find((page) => page.slug === 'callouts')?.notes).toEqual([
      'video kept as a link: the collection declares no embed component',
    ])
  })
})

describe('the images of a Notion page', () => {
  it('are downloaded now, by the signed address when Notion gives one, and referenced as assets', async () => {
    const { corpus, images, report } = await convert()

    expect(bodyOf(corpus.files.find((file) => file.slug === 'gallery')?.markdown ?? '')).toBe(
      [
        '',
        '![A red dot](asset:ast_263b2eda037e43f07cb5fd331d)',
        '',
        '![Gallery (2)](asset:ast_f7537c9522bb83c8beb9017452)',
        '',
        'Hi ![party](asset:ast_d8cfff98e0e0486816eadf3470)',
        '',
      ].join('\n'),
    )
    expect(
      images.map(({ key, filename, alt, bytes }) => [key, filename, alt, Buffer.from(bytes)]),
    ).toEqual([
      ['ast_263b2eda037e43f07cb5fd331d', 'red.png', 'A red dot', Buffer.from(png('red'))],
      ['ast_f7537c9522bb83c8beb9017452', 'dot.png', 'Gallery (2)', Buffer.from(png('dot'))],
      ['ast_9885cb070e95da1ae67f6c5ac6', 'star.png', 'icon', Buffer.from(png('star'))],
      ['ast_d8cfff98e0e0486816eadf3470', 'party.png', 'party', Buffer.from(png('party'))],
    ])
    expect(report.find((page) => page.slug === 'gallery')?.notes).toEqual([
      'image 3 dropped: its download answered 404',
    ])
  })

  it('take the caption as alt, or the title of the page and their place in it', async () => {
    const { images } = await convert()

    expect(images.slice(0, 2).map(({ alt }) => alt)).toEqual(['A red dot', 'Gallery (2)'])
  })

  it('drop what is not an image Hollware takes, with a note', async () => {
    const { report, images } = await convert({
      download: () => Promise.resolve(new Response('<html>not an image</html>')),
    })

    expect(images).toEqual([])
    expect(report.find((page) => page.slug === 'gallery')?.notes).toEqual([
      'image 1 dropped: it is not a JPEG, PNG, WebP, AVIF, GIF or SVG image',
      'image 2 dropped: it is not a JPEG, PNG, WebP, AVIF, GIF or SVG image',
      'image 3 dropped: it is not a JPEG, PNG, WebP, AVIF, GIF or SVG image',
      'custom emoji dropped: it is not a JPEG, PNG, WebP, AVIF, GIF or SVG image',
    ])
  })
})

describe('the custom emoji of a Notion page', () => {
  it('are read as custom_emoji records, by the ids of the text and of the icons, when the page lacks their images', async () => {
    const asked: [string, readonly string[]][] = []
    const bare: NotionLoader = {
      getPage: async (id) => {
        const { custom_emojis: _dropped, ...page } = await loader.getPage(id)
        return withCustomEmojis(page, (table, ids) => {
          asked.push([table, ids])
          return Promise.resolve({
            recordMap: {
              custom_emoji: {
                'emoji-1': { value: { value: { url: 'https://emoji.example/party.png' } } },
                '5f0c3a2e-0000-4000-8000-00000000e001': {
                  value: { url: 'https://emoji.example/star.png' },
                },
              },
            },
          })
        })
      },
    }

    const { corpus } = await convert({ loader: bare })

    expect(asked).toEqual([
      ['custom_emoji', ['5f0c3a2e-0000-4000-8000-00000000e001']],
      ['custom_emoji', ['emoji-1']],
    ])
    expect(corpus.files.find((file) => file.slug === 'callouts')?.markdown).toContain(
      '::callout{icon="asset:ast_9885cb070e95da1ae67f6c5ac6" tone="blue"}',
    )
    expect(corpus.files.find((file) => file.slug === 'gallery')?.markdown).toContain(
      'Hi ![party](asset:ast_d8cfff98e0e0486816eadf3470)',
    )
  })

  it('asks nothing of a page without custom emoji', async () => {
    const page = await loader.getPage(BLOCKS)
    const answer = await withCustomEmojis(page, () => Promise.reject(new Error('asked')))

    expect(answer).toBe(page)
  })
})

describe('the links of a Notion page', () => {
  it('point at the route of the imported page, and keep the address of a page outside, with a note', async () => {
    const { corpus, report } = await convert()

    expect(bodyOf(corpus.files.find((file) => file.slug === 'links')?.markdown ?? '')).toBe(
      [
        '',
        'See [Gallery](/docs/gallery) and [deeper](/docs/deeper) and [outside](https://www.notion.so/Other-00000000000040008000000000000099) and [web](https://example.org)',
        '',
        '[Deep](/docs/deep)',
        '',
      ].join('\n'),
    )
    expect(report.find((page) => page.slug === 'links')?.notes).toEqual([
      'link to a Notion page outside the import kept as https://www.notion.so/Other-00000000000040008000000000000099',
    ])
  })

  it('keep the Notion address, with a note, when the collection has no route for the locale', async () => {
    const { corpus, report } = await convert({
      target: { components: ['callout', 'details'], route: undefined },
    })

    expect(corpus.files.find((file) => file.slug === 'deep')?.markdown).toContain(
      '\n[Deeper](https://www.notion.so/00000000000040008000000000000007)\n',
    )
    expect(report.find((page) => page.slug === 'deep')?.notes).toEqual([
      'collection docs has no route for locale en: links to imported pages kept as Notion URLs',
    ])
  })

  it('make Markdown that Comark parses with no marker, and whose links to pages are internal', async () => {
    const { corpus } = await convert()
    const options = {
      components: ['callout', 'details'],
      maxMarkdownBytes: 100_000,
      routes: { docs: { en: '/docs/:slug' } },
    }

    const results = await Promise.all(
      corpus.files.map(async (file) => processMarkdown(file.markdown, options)),
    )
    const found = results.map((result) =>
      result.ok
        ? {
            disallowed: result.value.extracted.disallowed.length,
            internal: result.value.extracted.links
              .filter((link) => link.kind === 'internal')
              .map((link) => link.target?.slug),
          }
        : { disallowed: -1, internal: [] },
    )

    expect(found).toEqual([
      { disallowed: 0, internal: ['blocks', 'callouts', 'gallery', 'links', 'links-2'] },
      { disallowed: 0, internal: [] },
      { disallowed: 0, internal: [] },
      { disallowed: 0, internal: [] },
      { disallowed: 0, internal: ['gallery', 'deeper', 'deep'] },
      { disallowed: 0, internal: ['deeper'] },
      { disallowed: 0, internal: [] },
      { disallowed: 0, internal: [] },
    ])
  })

  it('escapes what Markdown or Comark would read as syntax, splits paragraphs at a blank line and trims line ends', async () => {
    const page: NotionRecordMap = JSON.parse(
      readFileSync(new URL('./fixtures/notion/text.json', import.meta.url), 'utf8'),
    )
    const only: NotionLoader = { getPage: () => Promise.resolve(page) }

    expect(bodyOf(await markdownOf('odd', { root: ODD, loader: only }))).toBe(
      [
        '',
        '\\# not a heading, \\:smile: \\[x\\] \\<b> \\| a\\_b \\*c\\* \\{d}\\',
        '1\\. not a list',
        '',
        'Welcome to **Help**',
        '',
        'Ask us anything.\\',
        '\\> not a quote, a > b',
        '',
        '- Item',
        '',
        '  More of it',
        '',
        '### 1. Step one',
        '',
      ].join('\n'),
    )
  })
})

describe('the slugs, sections and order of the entries', () => {
  it('makes an ASCII slug of the title, without accents', () => {
    expect(['Ñandú y Pingüino: ¡Hola!', '  ', 'Já 2.0 — Über'].map(slugOf)).toEqual([
      'nandu-y-pinguino-hola',
      'page',
      'ja-2-0-uber',
    ])
  })

  it('numbers the second page of a title, in the order of the tree', async () => {
    const { corpus } = await convert()

    expect(corpus.files.map((file) => file.path)).toEqual([
      'docs/en/guide.md',
      'docs/en/blocks.md',
      'docs/en/callouts.md',
      'docs/en/gallery.md',
      'docs/en/links.md',
      'docs/en/deep.md',
      'docs/en/deeper.md',
      'docs/en/links-2.md',
    ])
  })

  it('takes the slug of --slug-map first, and numbers the titles that would take it', async () => {
    const { corpus } = await convert({ slugMap: { [BLOCKS]: 'links' } })

    expect(corpus.files.map((file) => file.slug)).toEqual([
      'guide',
      'links',
      'callouts',
      'gallery',
      'links-2',
      'deep',
      'deeper',
      'links-3',
    ])
  })

  it('reports a slug of --slug-map that is not a slug, or that two pages are given', async () => {
    const { corpus } = await convert({
      slugMap: { [BLOCKS]: 'Not A Slug', [LINKS]: 'same', [LINKS_AGAIN]: 'same', nope: 'x' },
    })

    expect(corpus.problems).toEqual([
      {
        path: `--slug-map ${BLOCKS}`,
        reason: '"Not A Slug" is not a slug: use lowercase letters and digits joined by hyphens.',
      },
      { path: '--slug-map nope', reason: 'it is not the id of a Notion page.' },
      {
        path: `--slug-map ${LINKS_AGAIN}`,
        reason: `its slug "same" is given to ${LINKS} too.`,
      },
    ])
  })

  it('gives each page the title of its top page below the root as section, and its place among its siblings as order', async () => {
    const { corpus } = await convert({ sectionField: 'group', orderField: 'position' })
    const fields = corpus.files.map((file) => {
      const group = /^group: (.*)$/m.exec(file.markdown)?.[1]
      const position = /^position: (.*)$/m.exec(file.markdown)?.[1]
      return `${file.slug} ${group} ${position}`
    })

    expect(fields).toEqual([
      'guide "Guide" 1',
      'blocks "Blocks" 1',
      'callouts "Callouts" 2',
      'gallery "Gallery" 3',
      'links "Links" 4',
      'deep "Links" 1',
      'deeper "Links" 1',
      'links-2 "Links" 5',
    ])
  })

  it('starts each entry with its title in the frontmatter, not as a heading', async () => {
    expect(await markdownOf('deeper')).toBe(
      '---\ntitle: "Deeper"\nsection: "Links"\norder: 1\n---\n\nBottom\n',
    )
  })
})

describe('reading Notion', () => {
  it('takes the page id from an address, with or without dashes, and refuses text without one', () => {
    expect(
      [
        'https://www.notion.so/team/My-Page-0123456789abcdef0123456789abcdef?pvs=4#fedcba98765432100123456789abcdef',
        '01234567-89ab-cdef-0123-456789abcdef',
        'not a page',
      ].map(notionId),
    ).toEqual([
      '01234567-89ab-cdef-0123-456789abcdef',
      '01234567-89ab-cdef-0123-456789abcdef',
      undefined,
    ])
  })

  it('reads at most four pages at a time', async () => {
    let reading = 0
    let most = 0
    const slow: NotionLoader = {
      getPage: async (id) => {
        reading += 1
        most = Math.max(most, reading)
        await new Promise((resolve) => setTimeout(resolve, 5))
        reading -= 1
        return loader.getPage(id)
      },
    }

    await convert({ loader: slow })

    expect(most).toBe(4)
  })

  it('reports each component the pages use and the collection does not declare, with the fix', async () => {
    const { corpus } = await convert({ target: { components: [], route: '/docs/:slug' } })

    expect(corpus.problems).toEqual([
      {
        path: 'docs/en/callouts.md',
        reason:
          'it uses the component callout, which collection docs does not declare: declare callout in its components, or use --callouts alerts.',
      },
      {
        path: 'docs/en/callouts.md',
        reason:
          'it uses the component details, which collection docs does not declare: declare details in its components, or use --toggles flatten.',
      },
    ])
  })
})

const TOKEN = `hw_pat_${'a'.repeat(52)}`
const temp = tempDirs()
const stubs: StubServer[] = []

afterEach(async () => {
  for (const stub of stubs.splice(0)) await stub.close()
})

async function serve(components: string[]): Promise<StubServer> {
  const stub = await startStub({
    token: TOKEN,
    site: { key: 'blog', locales: ['en'], collections: ['docs'] },
    declared: { docs: { components, routes: { en: '/docs/:slug' } } },
  })
  stubs.push(stub)
  return stub
}

function runNotion(cwd: string, url: string, args: string[] = []) {
  return run(
    ['import', '--from', 'notion', '--root', ROOT, '--collection', 'docs', '--url', url, ...args],
    { cwd, readStdin: () => Promise.resolve(TOKEN), notion: loader, download },
  )
}

describe('hollware import --from notion', () => {
  it('writes the pages as drafts with their images, and a second run changes nothing', async () => {
    const stub = await serve(['callout', 'details'])
    const cwd = temp.make()

    const first = await runNotion(cwd, stub.url, [
      '--id-map',
      'ids.json',
      '--report',
      'report.json',
    ])
    const second = await runNotion(cwd, stub.url)

    expect(first.err).toEqual([])
    expect(first.code).toBe(0)
    expect(first.out.slice(0, 4)).toEqual([
      'Read 8 Notion pages: 4 with notes (in report.json), 4 images.',
      'Found 8 entries in Notion (docs: 8).',
      'Images: 4 uploaded, 0 already there.',
      'Validated 8 files: none would be refused.',
    ])
    expect(first.out.at(-1)).toBe('Drafts: 8 created, 0 updated, 0 unchanged.')
    expect(stub.entries.get('docs/en/gallery')?.revisions).toEqual([
      '---\ntitle: "Gallery"\nsection: "Gallery"\norder: 3\n---\n\n![A red dot](asset:ast_4ee2fe13c190458874b3ee3ce2)\n\n![Gallery (2)](asset:ast_2268af935e13c412581144d769)\n\nHi ![party](asset:ast_2ff599b00db07757dc0c1b936c)\n',
    ])
    expect([...stub.assets.values()].map(({ filename, alt }) => [filename, alt])).toEqual([
      ['red.png', 'A red dot'],
      ['dot.png', 'Gallery (2)'],
      ['star.png', 'icon'],
      ['party.png', 'party'],
    ])
    expect(JSON.parse(readFileSync(join(cwd, 'ids.json'), 'utf8'))[LINKS_AGAIN]).toEqual({
      collection: 'docs',
      locale: 'en',
      slug: 'links-2',
    })
    expect(JSON.parse(readFileSync(join(cwd, 'report.json'), 'utf8'))).toHaveLength(8)
    expect(second.code).toBe(0)
    expect(second.out).toContain('Images: 0 uploaded, 4 already there.')
    expect(second.out.at(-1)).toBe('Drafts: 0 created, 0 updated, 8 unchanged.')
  })

  it('sends nothing when the collection does not declare a component the pages use', async () => {
    const stub = await serve([])
    const cwd = temp.make()

    const { code, err } = await runNotion(cwd, stub.url)

    expect(code).toBe(1)
    expect(err.join('\n')).toContain(
      '2 files cannot be imported, so nothing was sent:\n  docs/en/callouts.md: it uses the component callout',
    )
    expect(stub.calls.map((call) => call.tool)).toEqual(['describe_site'])
  })

  it('stops when the site has no such collection', async () => {
    const stub = await serve([])
    const cwd = temp.make()

    const { code, err } = await run(
      ['import', '--from', 'notion', '--root', ROOT, '--collection', 'wiki', '--url', stub.url],
      { cwd, readStdin: () => Promise.resolve(TOKEN), notion: loader, download },
    )

    expect(code).toBe(1)
    expect(err.join('\n')).toContain('the site has no collection wiki: it has docs.')
  })

  it('says what to check when Notion does not give the page', async () => {
    const stub = await serve([])
    const cwd = temp.make()

    const { code, err } = await run(
      [
        'import',
        '--from',
        'notion',
        '--root',
        'ffffffffffffffffffffffffffffffff',
        '--collection',
        'docs',
        '--url',
        stub.url,
      ],
      { cwd, readStdin: () => Promise.resolve(TOKEN), notion: loader, download },
    )

    expect(code).toBe(1)
    expect(err.join('\n')).toContain(
      'could not read the Notion page ffffffff-ffff-ffff-ffff-ffffffffffff: no such page. Check --root, and that the page is shared to the web.',
    )
  })

  it('asks for what it needs, and keeps the flags of notion to it', async () => {
    const cwd = temp.make()
    const io = { cwd, notion: loader, download }

    const outcomes = await Promise.all(
      [
        ['import', '--from', 'notion', '--collection', 'docs', '--url', 'https://cms.example.com'],
        ['import', '--from', 'notion', '--root', ROOT, '--url', 'https://cms.example.com'],
        [
          'import',
          '--from',
          'notion',
          '--root',
          ROOT,
          '--collection',
          'docs',
          '--callouts',
          'boxes',
        ],
        ['import', 'content', '--root', ROOT, '--url', 'https://cms.example.com'],
      ].map(async (argv) => (await run(argv, io)).err.join('\n')),
    )

    expect(outcomes.map((text) => text.replace(/^hollware import: /, '').split('. ')[0])).toEqual([
      '--from notion needs --root: the id or the address of the top page',
      '--from notion needs --collection: the collection its pages go to',
      '--callouts takes components or alerts, not "boxes"',
      '--root is for --from notion',
    ])
  })
})
