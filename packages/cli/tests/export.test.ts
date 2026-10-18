// Fails when:
// - "writes each entry at <collection>/<locale>/<slug>.md …": the path in `exportEntries`
//   (src/commands/export.ts) changes its order or its extension, the Markdown is re-serialized,
//   trimmed or re-encoded (the byte order mark, the line ends), the entries are not sorted, the
//   summary per collection and locale changes, `list_entries` is asked for the trash or a status,
//   or `get_entry` for the published revision without --published.
// - "--published exports the published revision of the published entries only": `list_entries`
//   is not asked for `status: 'published'`, or `get_entry` is not asked for `published: true`.
// - "--collection and --locale narrow …" / "refuses a collection or a locale …": `chosen` stops
//   narrowing to what was asked, or the locale stops reaching `list_entries`, or a name the site
//   does not have is let through to the server.
// - "--site stops when the token is of another site": the key of `describe_site` is not compared.
// - "pages through list_entries": `nextCursor` is not followed, or is sent wrong.
// - "--dry-run lists what it would write …": `--dry-run` writes a file or a directory.
// - "refuses a directory that is not empty …" / "refuses a file": `checkTarget` lets a directory
//   that holds anything through, or reads the token or connects before it checks.
// - "writes into an empty directory …" (the round trip with import): what export writes differs
//   from what import reads, or an import of an export into the same site changes something.
// - "stops with a clear error and writes nothing when a call fails" rows: a `get_entry` that
//   fails in words, an entry gone between the list and the read, or a token the server rejects
//   leaves files behind, or is not told.
// - "refuses an entry that cannot be a file below the directory": `SAFE_SEGMENT` or the slug
//   check is dropped, so a locale like `..` writes outside the directory.
// - "asks for what it needs" rows: a missing directory or `--url` is accepted, or the token is
//   read first.
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'
import {
  startStub,
  type RecordedCall,
  type StubEntry,
  type StubOptions,
  type StubServer,
} from './support/stub-hollware.ts'

const TOKEN = `hw_pat_${'a'.repeat(52)}`
const OTHER_TOKEN = `hw_pat_${'b'.repeat(52)}`
const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/content', import.meta.url))
const BOM = String.fromCharCode(0xfeff)

const temp = tempDirs()
const stubs: StubServer[] = []

afterEach(async () => {
  for (const stub of stubs.splice(0)) await stub.close()
})

async function serve(options: Partial<StubOptions> = {}): Promise<StubServer> {
  const stub = await startStub({ token: TOKEN, ...options })
  stubs.push(stub)
  return stub
}

function post(title: string, extra = ''): string {
  return `---\ntitle: ${title}\n---\n\n# ${title}\n${extra}`
}

const id = (n: number): string => `ent_${String(n).padStart(26, '0')}`

interface Seed {
  revisions: string[]
  published?: number | null
  deletedAt?: string
}

/** Puts entries in the stub, by `<collection>/<locale>/<slug>`, in this order (oldest first). */
function seed(stub: StubServer, rows: Record<string, Seed>): void {
  let n = 900
  for (const [key, row] of Object.entries(rows)) {
    const [collection = '', locale = '', slug = ''] = key.split('/')
    n += 1
    const entry: StubEntry = {
      id: id(n),
      collection,
      locale,
      slug,
      version: row.revisions.length,
      revisions: row.revisions,
      published: row.published ?? null,
      deletedAt: row.deletedAt ?? null,
    }
    stub.entries.set(key, entry)
  }
}

/** Runs `hollware export <dir> --url <url> …` from `cwd`, with the token on stdin. */
function runExport(cwd: string, dir: string, url: string, args: string[] = []) {
  return run(['export', dir, '--url', url, ...args], {
    cwd,
    readStdin: () => Promise.resolve(`${TOKEN}\n`),
  })
}

/** The files below a directory, as `a/b/c.md`, sorted. */
function filesOf(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split('\\').join('/'))
    .filter((path) => statSync(join(root, path)).isFile())
    .sort()
}

const calls = (stub: StubServer, tool: string): RecordedCall['args'][] =>
  stub.calls.filter((call) => call.tool === tool).map((call) => call.args)

const CRLF_WITH_BOM = `${BOM}---\r\ntitle: Bom\r\n---\r\n\r\nbody  \r\n\r\n\r\n`

/** A site with two collections: a published entry edited since, a draft, one in the trash, a doc. */
async function sampleSite(): Promise<StubServer> {
  const stub = await serve({
    site: { key: 'blog', locales: ['en', 'es'], collections: ['blog', 'docs'] },
  })
  seed(stub, {
    'blog/en/a': { revisions: [post('A'), post('A', 'Edited.\n')], published: 0 },
    'blog/es/b': { revisions: [CRLF_WITH_BOM] },
    'blog/en/gone': { revisions: [post('Gone')], deletedAt: '2026-10-10T00:00:00.000Z' },
    'docs/en/start': { revisions: [post('Start')], published: 0 },
  })
  return stub
}

describe('hollware export', () => {
  it('writes each entry at <collection>/<locale>/<slug>.md, its latest revision byte for byte, drafts included and the trash left out', async () => {
    const stub = await sampleSite()
    const base = temp.make()

    const { code, out, err } = await runExport(base, 'out', stub.url)

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out).toEqual([
      [
        'Exported 3 entries of the site blog to out (the latest revisions, drafts included):',
        '  blog/en: 1',
        '  blog/es: 1',
        '  docs/en: 1',
      ].join('\n'),
    ])
    const root = join(base, 'out')
    expect(filesOf(root)).toEqual(['blog/en/a.md', 'blog/es/b.md', 'docs/en/start.md'])
    expect(readFileSync(join(root, 'blog/en/a.md'))).toEqual(
      Buffer.from('---\ntitle: A\n---\n\n# A\nEdited.\n'),
    )
    expect([...readFileSync(join(root, 'blog/es/b.md'))]).toEqual([
      0xef,
      0xbb,
      0xbf,
      ...Buffer.from('---\r\ntitle: Bom\r\n---\r\n\r\nbody  \r\n\r\n\r\n'),
    ])
    expect(readFileSync(join(root, 'docs/en/start.md'), 'utf8')).toBe(
      '---\ntitle: Start\n---\n\n# Start\n',
    )
    expect(tools(stub)).toEqual([
      'describe_site',
      'list_entries',
      'list_entries',
      'get_entry',
      'get_entry',
      'get_entry',
    ])
    expect(calls(stub, 'list_entries')).toEqual([
      { collection: 'blog', limit: 100 },
      { collection: 'docs', limit: 100 },
    ])
    expect(calls(stub, 'get_entry')).toEqual([
      {
        collection: 'blog',
        locale: 'en',
        slug: 'a',
        formats: ['markdown'],
        published: false,
        related: false,
      },
      {
        collection: 'blog',
        locale: 'es',
        slug: 'b',
        formats: ['markdown'],
        published: false,
        related: false,
      },
      {
        collection: 'docs',
        locale: 'en',
        slug: 'start',
        formats: ['markdown'],
        published: false,
        related: false,
      },
    ])
  })

  it('--published exports the published revision of the published entries only', async () => {
    const stub = await sampleSite()
    const base = temp.make()

    const { code, out } = await runExport(base, 'out', stub.url, ['--published'])

    expect(code).toBe(0)
    expect(out).toEqual([
      [
        'Exported 2 entries of the site blog to out (the published revisions):',
        '  blog/en: 1',
        '  docs/en: 1',
      ].join('\n'),
    ])
    const root = join(base, 'out')
    expect(filesOf(root)).toEqual(['blog/en/a.md', 'docs/en/start.md'])
    expect(readFileSync(join(root, 'blog/en/a.md'), 'utf8')).toBe('---\ntitle: A\n---\n\n# A\n')
    expect(calls(stub, 'list_entries')).toEqual([
      { collection: 'blog', status: 'published', limit: 100 },
      { collection: 'docs', status: 'published', limit: 100 },
    ])
    expect(calls(stub, 'get_entry').map((args) => args.published)).toEqual([true, true])
  })

  it('--collection and --locale narrow it to what they name, and repeat', async () => {
    const stub = await sampleSite()
    const base = temp.make()

    const one = await runExport(base, 'one', stub.url, ['--collection', 'blog', '--locale', 'es'])

    expect(one.code).toBe(0)
    expect(filesOf(join(base, 'one'))).toEqual(['blog/es/b.md'])
    expect(calls(stub, 'list_entries')).toEqual([{ collection: 'blog', locale: 'es', limit: 100 }])
    expect(one.out).toEqual([
      'Exported 1 entry of the site blog to one (the latest revisions, drafts included):\n  blog/es: 1',
    ])

    const before = stub.calls.length
    const two = await runExport(base, 'two', stub.url, ['--locale', 'en', '--locale', 'es'])

    expect(two.code).toBe(0)
    expect(filesOf(join(base, 'two'))).toEqual(['blog/en/a.md', 'blog/es/b.md', 'docs/en/start.md'])
    expect(
      stub.calls
        .slice(before)
        .filter((call) => call.tool === 'list_entries')
        .map((call) => call.args),
    ).toEqual([
      { collection: 'blog', locale: 'en', limit: 100 },
      { collection: 'blog', locale: 'es', limit: 100 },
      { collection: 'docs', locale: 'en', limit: 100 },
      { collection: 'docs', locale: 'es', limit: 100 },
    ])
  })

  it.each([
    [['--collection', 'nope'], 'the site has no collection "nope": it has blog, docs.'],
    [['--locale', 'fr', '--locale', 'de'], 'the site has no locale "fr", "de": it has en, es.'],
  ])('refuses %j, which the site does not have, before it lists anything', async (args, why) => {
    const stub = await sampleSite()
    const base = temp.make()

    const { code, out, err } = await runExport(base, 'out', stub.url, args)

    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([`hollware export: ${why}`])
    expect(tools(stub)).toEqual(['describe_site'])
    expect(existsSync(join(base, 'out'))).toBe(false)
  })

  it('--site stops when the token is of another site', async () => {
    const stub = await sampleSite()
    const base = temp.make()

    const { code, err } = await runExport(base, 'out', stub.url, ['--site', 'docs'])

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware export: the token is of the site "blog", not "docs": a personal token reads the one site it is of. Use a token of docs.',
    ])
    expect(tools(stub)).toEqual(['describe_site'])
    expect(existsSync(join(base, 'out'))).toBe(false)

    const same = await runExport(base, 'out', stub.url, ['--site', 'blog'])
    expect(same.code).toBe(0)
  })

  it('pages through list_entries until there is no next cursor', async () => {
    const stub = await serve({ pageSize: 2 })
    seed(stub, {
      'blog/en/p1': { revisions: [post('P1')] },
      'blog/en/p2': { revisions: [post('P2')] },
      'blog/en/p3': { revisions: [post('P3')] },
      'blog/en/p4': { revisions: [post('P4')] },
      'blog/en/p5': { revisions: [post('P5')] },
    })
    const base = temp.make()

    const { code, out } = await runExport(base, 'out', stub.url)

    expect(code).toBe(0)
    expect(calls(stub, 'list_entries')).toEqual([
      { collection: 'blog', limit: 100 },
      { collection: 'blog', limit: 100, cursor: '2' },
      { collection: 'blog', limit: 100, cursor: '4' },
    ])
    expect(filesOf(join(base, 'out'))).toEqual([
      'blog/en/p1.md',
      'blog/en/p2.md',
      'blog/en/p3.md',
      'blog/en/p4.md',
      'blog/en/p5.md',
    ])
    expect(out).toEqual([
      'Exported 5 entries of the site blog to out (the latest revisions, drafts included):\n  blog/en: 5',
    ])
  })

  it('--dry-run lists what it would write, and writes nothing', async () => {
    const stub = await sampleSite()
    const base = temp.make()

    const { code, out, err } = await runExport(base, 'out', stub.url, ['--dry-run'])

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out).toEqual([
      [
        'would write  blog/en/a.md',
        'would write  blog/es/b.md',
        'would write  docs/en/start.md',
      ].join('\n'),
      [
        'Dry run: 3 entries of the site blog would be written to out (the latest revisions, drafts included):',
        '  blog/en: 1',
        '  blog/es: 1',
        '  docs/en: 1',
        'Nothing was written.',
      ].join('\n'),
    ])
    expect(existsSync(join(base, 'out'))).toBe(false)
  })

  it('says so when there is nothing to export, and writes nothing', async () => {
    const stub = await sampleSite()
    const base = temp.make()

    const { code, out } = await runExport(base, 'out', stub.url, ['--published', '--locale', 'es'])

    expect(code).toBe(0)
    expect(out).toEqual([
      'No entries to export from the site blog (the published revisions). Nothing was written.',
    ])
    expect(existsSync(join(base, 'out'))).toBe(false)
  })
})

describe('hollware export writes only into a new or an empty directory', () => {
  it('refuses a directory that is not empty, before it reads the token or connects, and writes nothing', async () => {
    const stub = await sampleSite()
    const base = temp.make({ 'out/notes.txt': 'mine' })
    let read = false

    const { code, out, err } = await run(['export', 'out', '--url', stub.url], {
      cwd: base,
      readStdin: () => {
        read = true
        return Promise.resolve(TOKEN)
      },
    })

    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([
      'hollware export: out is not empty: export into a new or an empty directory, so that no file is overwritten. Nothing was written.',
    ])
    expect(read).toBe(false)
    expect(stub.authorizations).toEqual([])
    expect(filesOf(join(base, 'out'))).toEqual(['notes.txt'])
    expect(readFileSync(join(base, 'out/notes.txt'), 'utf8')).toBe('mine')
  })

  it('refuses a file', async () => {
    const base = temp.make({ 'out.md': 'x' })

    const { code, err } = await runExport(base, 'out.md', 'https://cms.example.com')

    expect(code).toBe(1)
    expect(err).toEqual(['hollware export: out.md is not a directory.'])
  })
})

describe('a round trip through export and import', () => {
  it(
    'writes into an empty directory what import takes back unchanged: the fixtures, byte for byte',
    { timeout: 60_000 },
    async () => {
      const stub = await serve()
      const imported = await run(['import', FIXTURES, '--url', stub.url], {
        cwd: FIXTURES,
        readStdin: () => Promise.resolve(TOKEN),
      })
      expect(imported.out).toContain('Drafts: 10 created, 0 updated, 0 unchanged.')
      const dir = temp.make()

      const exported = await runExport(dir, dir, stub.url)

      expect(exported.err).toEqual([])
      expect(exported.code).toBe(0)
      const files = filesOf(dir)
      expect(files).toHaveLength(10)
      for (const path of files) {
        expect(readFileSync(join(dir, path))).toEqual(readFileSync(join(FIXTURES, path)))
      }

      const again = await run(['import', dir, '--url', stub.url], {
        cwd: dir,
        readStdin: () => Promise.resolve(TOKEN),
      })

      expect(again.err).toEqual([])
      expect(again.code).toBe(0)
      expect(again.out.at(-1)).toBe('Drafts: 0 created, 0 updated, 10 unchanged.')
      for (const entry of stub.entries.values()) {
        expect([entry.version, entry.revisions.length]).toEqual([1, 1])
      }
    },
  )
})

describe('hollware export stops with a clear error and writes nothing when a call fails', () => {
  it('when get_entry fails in words', async () => {
    const stub = await serve({
      toolError: (call) =>
        call.tool === 'get_entry' && call.args.slug === 'b'
          ? 'the store is unavailable.'
          : undefined,
    })
    seed(stub, { 'blog/en/a': { revisions: [post('A')] }, 'blog/en/b': { revisions: [post('B')] } })
    const base = temp.make()

    const { code, out, err } = await runExport(base, 'out', stub.url)

    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([
      'hollware export: could not read blog/en/b.md: get_entry failed: the store is unavailable. Nothing was written.',
    ])
    expect(existsSync(join(base, 'out'))).toBe(false)
  })

  it('when an entry is gone between the list and the read', async () => {
    const stub = await serve({
      before: (call, entries) => {
        if (call.tool === 'get_entry') entries.delete('blog/en/a')
      },
    })
    seed(stub, { 'blog/en/a': { revisions: [post('A')] } })
    const base = temp.make()

    const { code, err } = await runExport(base, 'out', stub.url)

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware export: blog/en/a.md is gone: it was moved to the trash or renamed while the export ran. Nothing was written: run the export again.',
    ])
    expect(existsSync(join(base, 'out'))).toBe(false)
  })

  it('when the server rejects the token (401)', async () => {
    const stub = await serve({ token: OTHER_TOKEN })
    const base = temp.make()

    const result = await runExport(base, 'out', stub.url)

    expect(result).toEqual({
      code: 1,
      out: [],
      err: [
        'hollware export: the server rejected the token (401). It may be wrong, expired or revoked: "hollware token create" makes a new one.',
      ],
    })
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(existsSync(join(base, 'out'))).toBe(false)
  })

  it('refuses an entry that cannot be a file below the directory', async () => {
    const stub = await serve()
    seed(stub, { 'blog/en/a': { revisions: [post('A')] } })
    stub.entries.set('blog/../evil', {
      id: id(1),
      collection: 'blog',
      locale: '..',
      slug: 'evil',
      version: 1,
      revisions: [post('Evil')],
      published: null,
    })
    const base = temp.make()
    mkdirSync(join(base, 'work'))
    writeFileSync(join(base, 'keep.txt'), 'keep')

    const { code, err } = await runExport(join(base, 'work'), 'out', stub.url)

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware export: the server listed an entry that cannot be a file below the directory: "blog/../evil.md". Nothing was written.',
    ])
    expect(filesOf(base)).toEqual(['keep.txt'])
  })
})

describe('hollware export and its images (ADR-038)', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

  /** A site with a post that shows one image, uploaded the way an agent uploads it. */
  async function siteWithAnImage(): Promise<{ stub: StubServer; id: string }> {
    const stub = await serve()
    const id = 'ast_' + createHash('sha256').update(PNG).digest('hex').slice(0, 26)
    stub.assets.set(id, {
      id,
      format: 'image/webp',
      originalFormat: 'image/png',
      served: new TextEncoder().encode('RIFF webp'),
      original: PNG,
      alt: 'The stage',
      filename: 'stage.png',
    })
    seed(stub, {
      'blog/en/talk': {
        revisions: [`---\ntitle: Talk\nimg: asset:${id}\n---\n\n![The stage](asset:${id})\n`],
        published: 0,
      },
    })
    return { stub, id }
  }

  it('for a site, writes each image as it is served and points the references at --assets-url', async () => {
    const { stub, id } = await siteWithAnImage()
    const base = temp.make()

    const { code, out, err } = await runExport(base, 'content', stub.url, [
      '--published',
      '--assets',
      'public/img',
      '--assets-url',
      '/img/',
    ])

    expect([code, err]).toEqual([0, []])
    expect(filesOf(join(base, 'public/img'))).toEqual([`${id}.webp`])
    expect(readFileSync(join(base, 'public/img', `${id}.webp`), 'utf8')).toBe('RIFF webp')
    expect(readFileSync(join(base, 'content/blog/en/talk.md'), 'utf8')).toBe(
      `---\ntitle: Talk\nimg: /img/${id}.webp\n---\n\n![The stage](/img/${id}.webp)\n`,
    )
    expect(out).toContain('Wrote 1 image to public/img.')
    expect(filesOf(join(base, 'content'))).toEqual(['blog/en/talk.md'])
  })

  it('by default, keeps the originals in _assets, which an import into another site uploads under the same ids', async () => {
    const { stub, id } = await siteWithAnImage()
    const base = temp.make()

    const exported = await runExport(base, 'backup', stub.url, ['--published'])

    expect(exported.code).toBe(0)
    const root = join(base, 'backup')
    expect(filesOf(root)).toEqual(['_assets/assets.json', `_assets/${id}.png`, 'blog/en/talk.md'])
    expect([...readFileSync(join(root, `_assets/${id}.png`))]).toEqual([...PNG])
    expect(JSON.parse(readFileSync(join(root, '_assets/assets.json'), 'utf8'))).toEqual({
      [`${id}.png`]: { alt: 'The stage', filename: 'stage.png' },
    })
    expect(readFileSync(join(root, 'blog/en/talk.md'), 'utf8')).toContain(`asset:${id}`)

    const other = await serve()
    const imported = await run(['import', root, '--url', other.url], {
      readStdin: () => Promise.resolve(`${TOKEN}\n`),
    })

    expect(imported.code).toBe(0)
    expect(imported.out).toContain('Images: 1 uploaded, 0 already there.')
    expect(tools(other).indexOf('upload_asset')).toBeLessThan(tools(other).indexOf('create_draft'))
    expect(calls(other, 'upload_asset')).toEqual([
      { filename: 'stage.png', alt: 'The stage', data: Buffer.from(PNG).toString('base64') },
    ])
    expect([...other.assets.keys()]).toEqual([id])
  })

  it('takes --assets and --assets-url together or not at all', async () => {
    const { code, err } = await run(
      ['export', 'out', '--url', 'https://cms.test', '--assets', 'img'],
      {
        readStdin: () => Promise.resolve(TOKEN),
      },
    )

    expect(code).toBe(1)
    expect(err[0]).toContain('--assets and --assets-url go together')
  })
})

describe('hollware export asks for what it needs', () => {
  it.each([
    [
      [],
      'hollware export: export takes one directory: hollware export <directory> --url <url>. Run "hollware export --help" for the options.',
    ],
    [
      ['out'],
      'hollware export: --url is required: the address of your Hollware, such as https://cms.example.com. Run "hollware export --help" for the options.',
    ],
  ])('rejects %j before it reads anything', async (args, message) => {
    let read = false

    const { code, out, err } = await run(['export', ...args], {
      readStdin: () => {
        read = true
        return Promise.resolve(TOKEN)
      },
    })

    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([message])
    expect(read).toBe(false)
  })
})

function tools(stub: StubServer): string[] {
  return stub.calls.map((call) => call.tool)
}
