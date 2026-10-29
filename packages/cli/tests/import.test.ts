import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vite-plus/test'

import { mcpEndpoint, redact } from '../src/commands/import.ts'
import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'
import {
  COMARK_BREAK,
  startStub,
  type RecordedCall,
  type StubOptions,
  type StubServer,
} from './support/stub-hollware.ts'

const TOKEN = `hw_pat_${'a'.repeat(52)}`
const OTHER_TOKEN = `hw_pat_${'b'.repeat(52)}`
const FIXTURES = fileURLToPath(new URL('../../../tests/fixtures/content', import.meta.url))
const BLOG_FILES = ['en', 'es'].flatMap((locale) =>
  readdirSync(join(FIXTURES, 'blog', locale))
    .filter((name) => name.endsWith('.md'))
    .map((name) => `blog/${locale}/${name}`),
)

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

function runImport(dir: string, url: string, args: string[] = [], token = TOKEN) {
  return run(['import', dir, '--url', url, ...args], {
    cwd: dir,
    readStdin: () => Promise.resolve(`${token}\n`),
  })
}

const tools = (calls: readonly RecordedCall[]): string[] => calls.map((call) => call.tool)

const WARNING = {
  contract: 'seo-title-length',
  severity: 'warning' as const,
  path: '/frontmatter/title',
  message: 'The title has 70 characters; search engines show about 60.',
  fix: 'Shorten the title.',
}
const ERROR = {
  contract: 'schema',
  severity: 'error' as const,
  path: '/frontmatter/description',
  message: 'Required',
  fix: 'Add a description.',
}

describe('hollware import --dry-run', () => {
  it('only validates: it writes and publishes nothing', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/es/b.md': post('B') })

    const { code, out, err } = await runImport(dir, stub.url, ['--dry-run', '--publish'])

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out).toEqual([
      `Found 2 entries in ${dir} (blog: 2).`,
      'ok       blog/en/a.md\nok       blog/es/b.md',
      'Dry run: 2 files validated, none would be refused. Nothing was written.',
    ])
    expect(stub.calls).toEqual([
      {
        tool: 'validate',
        args: { collection: 'blog', locale: 'en', slug: 'a', markdown: post('A') },
      },
      {
        tool: 'validate',
        args: { collection: 'blog', locale: 'es', slug: 'b', markdown: post('B') },
      },
    ])
    expect(stub.entries.size).toBe(0)
  })

  it('reports what validate found, and still exits 0 when nothing is refused', async () => {
    const stub = await serve({
      findings: (file) => (file.slug === 'a' ? { errors: [ERROR] } : { warnings: [WARNING] }),
    })
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/en/b.md': post('B') })

    const { code, out } = await runImport(dir, stub.url, ['--dry-run'])

    expect(code).toBe(0)
    expect(out[1]).toBe(
      [
        'ok       blog/en/a.md',
        '         error [schema] /frontmatter/description: Required Fix: Add a description.',
        'ok       blog/en/b.md',
        '         warning [seo-title-length] /frontmatter/title: The title has 70 characters; search engines show about 60. Fix: Shorten the title.',
      ].join('\n'),
    )
  })

  it('says that a real import would write nothing when a file would be refused', async () => {
    const stub = await serve({ maxBytes: 200 })
    const dir = temp.make({
      'blog/en/ok.md': post('Ok'),
      'blog/en/big.md': post('Big', 'x'.repeat(300)),
    })

    const { code, out, err } = await runImport(dir, stub.url, ['--dry-run'])

    expect(code).toBe(1)
    expect(out[1]).toBe(
      [
        'refused  blog/en/big.md',
        '         error [size-limit] /body: The file is larger than the collection allows. Fix: Split it into several entries.',
        'ok       blog/en/ok.md',
      ].join('\n'),
    )
    expect(err).toEqual([
      [
        'hollware import: 1 of 2 files would be refused, so a real import would write nothing:',
        '  blog/en/big.md: error [size-limit] /body: The file is larger than the collection allows. Fix: Split it into several entries.',
        'Fix them and run the import again.',
      ].join('\n'),
    ])
  })
})

describe('hollware import validates every file first and writes nothing when one would be refused', () => {
  it('lists each refused file with its reason, and writes nothing', async () => {
    const stub = await serve({ maxBytes: 200 })
    const dir = temp.make({
      'blog/en/a.md': post('A'),
      'blog/en/big.md': post('Big', 'x'.repeat(300)),
      'blog/en/broken.md': post('Broken', COMARK_BREAK),
      'blog/en/nofm.md': 'just text, no frontmatter',
    })

    const { code, out, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(out).toEqual([`Found 4 entries in ${dir} (blog: 4).`])
    expect(err).toEqual([
      [
        'hollware import: 3 of 4 files would be refused, so nothing was written:',
        '  blog/en/big.md: error [size-limit] /body: The file is larger than the collection allows. Fix: Split it into several entries.',
        '  blog/en/broken.md: error [comark-parse] /body: The body does not parse. Fix: Remove <<comark-break>>.',
        '  blog/en/nofm.md: error [frontmatter-syntax] /frontmatter: The frontmatter does not parse. Fix: Start the file with a YAML block between two --- lines.',
        'Fix them and run the import again.',
      ].join('\n'),
    ])
    expect(tools(stub.calls)).toEqual(['validate', 'validate', 'validate', 'validate'])
    expect(stub.entries.size).toBe(0)
  })

  it('does not write either when a validate call fails in words, and lists that file too', async () => {
    const stub = await serve({
      toolError: (call) =>
        call.tool === 'validate' && call.args.collection === 'nope'
          ? 'unknown collection "nope": choose one of blog.'
          : undefined,
    })
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'nope/en/x.md': post('X') })

    const { code, err } = await runImport(dir, stub.url, ['--publish'])

    expect(code).toBe(1)
    expect(err).toEqual([
      [
        'hollware import: 1 of 2 files would be refused, so nothing was written:',
        '  nope/en/x.md: validate failed: unknown collection "nope": choose one of blog.',
        'Fix them and run the import again.',
      ].join('\n'),
    ])
    expect(tools(stub.calls)).toEqual(['validate', 'validate'])
  })

  it('does not tell what is not refusal-level: errors that are saved with a draft go on', async () => {
    const stub = await serve({ findings: () => ({ errors: [ERROR] }) })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, out } = await runImport(dir, stub.url)

    expect(code).toBe(0)
    expect(out.at(-2)).toBe(`created    blog/en/a  ${id(1)}  v1 (1 error)`)
  })
})

describe('hollware import prints what a person typed or a folder is named', () => {
  it('prints a path with a control character in its folders without it', async () => {
    const stub = await serve()
    const dir = temp.make({ [`blog${String.fromCharCode(27)}[2J/en/a.md`]: post('A') })

    const { out } = await runImport(dir, stub.url, ['--dry-run'])

    expect(out.join('\n')).not.toContain(String.fromCharCode(27))
    expect(out[0]).toBe(`Found 1 entry in ${dir} (blog?[2J: 1).`)
    expect(out[1]).toBe('ok       blog?[2J/en/a.md')
  })
})

describe('hollware import writes the drafts in phase one, then publishes in phase two', () => {
  it('creates what is not there, then publishes, in that order', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/es/b.md': post('B') })

    const { code, out, err } = await runImport(dir, stub.url, ['--publish'])

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out).toEqual([
      `Found 2 entries in ${dir} (blog: 2).`,
      'Validated 2 files: none would be refused.',
      `created    blog/en/a  ${id(1)}  v1`,
      `created    blog/es/b  ${id(2)}  v1`,
      'Drafts: 2 created, 0 updated, 0 unchanged.',
      `published              blog/en/a  ${id(1)}`,
      `published              blog/es/b  ${id(2)}`,
      'Publishing: 2 published, 0 need acknowledgement, 0 blocked.',
    ])
    expect(tools(stub.calls)).toEqual([
      'validate',
      'validate',
      'get_entry',
      'create_draft',
      'get_entry',
      'create_draft',
      'publish',
    ])
    expect(stub.calls.at(-1)?.args).toEqual({
      id: id(1),
      version: 1,
      acknowledgeWarnings: [],
      group: [{ id: id(2), version: 1 }],
    })
    expect([...stub.entries.values()].map((entry) => [entry.slug, entry.published])).toEqual([
      ['a', 0],
      ['b', 0],
    ])
  })

  it('stops after the drafts without --publish, which leaves them drafts', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, out } = await runImport(dir, stub.url)

    expect(code).toBe(0)
    expect(out.at(-1)).toBe('Drafts: 1 created, 0 updated, 0 unchanged.')
    expect(tools(stub.calls)).toEqual(['validate', 'get_entry', 'create_draft'])
    expect(stub.entries.get('blog/en/a')?.published).toBeNull()
  })

  it('updates what changed at the version it read, and leaves what did not change alone', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/es/b.md': post('B') })
    await runImport(dir, stub.url)
    const first = stub.calls.length
    writeFileSync(join(dir, 'blog/en/a.md'), post('A', 'More words.\n'))

    const { code, out } = await runImport(dir, stub.url)

    expect(code).toBe(0)
    expect(out).toEqual([
      `Found 2 entries in ${dir} (blog: 2).`,
      'Validated 2 files: none would be refused.',
      `updated    blog/en/a  ${id(1)}  v2`,
      `unchanged  blog/es/b  ${id(2)}  v1`,
      'Drafts: 0 created, 1 updated, 1 unchanged.',
    ])
    expect(stub.calls.slice(first).filter((call) => call.tool === 'update_draft')).toEqual([
      {
        tool: 'update_draft',
        args: { id: id(1), version: 1, markdown: post('A', 'More words.\n') },
      },
      { tool: 'update_draft', args: { id: id(2), version: 1, markdown: post('B') } },
    ])
    expect(tools(stub.calls.slice(first))).not.toContain('create_draft')
    expect(stub.entries.get('blog/en/a')?.revisions).toEqual([
      post('A'),
      post('A', 'More words.\n'),
    ])
    expect(stub.entries.get('blog/en/a')?.version).toBe(2)
    expect(stub.entries.get('blog/es/b')?.version).toBe(1)
  })

  it('shows an unchanged entry with the verdict of this run, not the one kept since it was written', async () => {
    let required = true
    const stub = await serve({
      findings: () =>
        required
          ? {
              errors: [
                {
                  contract: 'schema',
                  severity: 'error',
                  path: '/frontmatter/kind',
                  message: 'Missing.',
                  fix: 'Set it.',
                },
              ],
            }
          : {},
    })
    const dir = temp.make({ 'talks/en/a.md': post('A') })
    await runImport(dir, stub.url)
    required = false

    const { out } = await runImport(dir, stub.url)

    expect(out).toContain(`unchanged  talks/en/a  ${id(1)}  v1`)
  })

  it('keeps the bytes of a file: the byte order mark, the line ends, the white space', async () => {
    const stub = await serve()
    const dir = temp.make()
    mkdirSync(join(dir, 'blog', 'en'), { recursive: true })
    const markdown = `${String.fromCharCode(0xfeff)}---\r\ntitle: Bom\r\n---\r\n\r\nbody  \r\n\r\n\r\n`
    writeFileSync(join(dir, 'blog', 'en', 'bom.md'), markdown)

    const { code } = await runImport(dir, stub.url)

    expect(code).toBe(0)
    expect(stub.entries.get('blog/en/bom')?.revisions).toEqual([markdown])
    expect(
      stub.calls.filter((call) => call.tool !== 'get_entry').map((call) => call.args.markdown),
    ).toEqual([markdown, markdown])
  })
})

describe('a second run of the fixture corpus', () => {
  it(
    'answers unchanged for every entry, and no version moves (AC-0.1-9)',
    { timeout: 60_000 },
    async () => {
      const stub = await serve()

      const first = await runImport(FIXTURES, stub.url)

      expect(first.err).toEqual([])
      expect(first.code).toBe(0)
      expect(first.out[0]).toBe(`Found 10 entries in ${FIXTURES} (blog: 10).`)
      expect(first.out).toContain('Drafts: 10 created, 0 updated, 0 unchanged.')
      expect(stub.entries.size).toBe(10)
      const ids = [...stub.entries.values()].map((entry) => entry.id)
      const created = stub.calls.filter((call) => call.tool === 'create_draft').length
      expect(created).toBe(10)

      const second = await runImport(FIXTURES, stub.url)

      expect(second.err).toEqual([])
      expect(second.code).toBe(0)
      expect(second.out.filter((line) => line.startsWith('unchanged  '))).toHaveLength(10)
      expect(second.out.filter((line) => /^(created|updated) /.test(line))).toEqual([])
      expect(second.out.at(-1)).toBe('Drafts: 0 created, 0 updated, 10 unchanged.')
      expect(stub.calls.filter((call) => call.tool === 'create_draft')).toHaveLength(10)
      expect([...stub.entries.values()].map((entry) => entry.id)).toEqual(ids)
      for (const entry of stub.entries.values()) {
        expect(entry.version).toBe(1)
        expect(entry.revisions).toHaveLength(1)
      }
      expect(BLOG_FILES).toHaveLength(10)
      for (const path of BLOG_FILES) {
        const entry = stub.entries.get(path.replace(/\.md$/, ''))
        expect(entry?.revisions).toEqual([readFileSync(join(FIXTURES, path), 'utf8')])
      }
    },
  )

  it('reports the Markdown of the fixtures that is not an entry, instead of sending it', async () => {
    const stub = await serve()

    const { out } = await runImport(FIXTURES, stub.url, ['--dry-run'])

    expect(out[1]).toMatch(
      /^Skipped \d+ Markdown files that are not at <collection>\/<locale>\/<slug>\.md: bench\/long-post\.md, hostile\//,
    )
    expect(stub.calls.every((call) => call.args.collection === 'blog')).toBe(true)
  })
})

describe('hollware import --publish', () => {
  it('publishes 101 entries as an entry with a group of 99, which is the most publish takes, then one more', async () => {
    const stub = await serve()
    const name = (n: number) => `blog/en/p${String(n).padStart(3, '0')}.md`
    const dir = temp.make(
      Object.fromEntries(Array.from({ length: 101 }, (_, n) => [name(n + 1), post(`P${n + 1}`)])),
    )

    const { code, out, err } = await runImport(dir, stub.url, ['--publish'])

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out.at(-1)).toBe('Publishing: 101 published, 0 need acknowledgement, 0 blocked.')
    const publishes = stub.calls.filter((call) => call.tool === 'publish')
    expect(
      publishes.map(({ args }) => [args.id, Array.isArray(args.group) ? args.group.length : null]),
    ).toEqual([
      [id(1), 99],
      [id(101), 0],
    ])
  })

  it('acknowledges no warning, and reports what blocks and what needs an acknowledgement', async () => {
    const stub = await serve({
      findings: (file) => {
        if (file.slug === 'err') return { errors: [ERROR] }
        if (file.slug === 'warn') return { warnings: [WARNING] }
        return {}
      },
    })
    const dir = temp.make({
      'blog/en/err.md': post('Err'),
      'blog/en/ok.md': post('Ok'),
      'blog/en/warn.md': post('Warn'),
    })

    const { code, out, err } = await runImport(dir, stub.url, ['--publish'])

    expect(code).toBe(1)
    expect(out).toEqual([
      `Found 3 entries in ${dir} (blog: 3).`,
      'Validated 3 files: none would be refused.',
      `created    blog/en/err  ${id(1)}  v1 (1 error)`,
      `created    blog/en/ok  ${id(2)}  v1`,
      `created    blog/en/warn  ${id(3)}  v1 (1 warning)`,
      'Drafts: 3 created, 0 updated, 0 unchanged.',
      `blocked                blog/en/err  ${id(1)}\n    error [schema] /frontmatter/description: Required Fix: Add a description.`,
      `needs_acknowledgement  blog/en/warn  ${id(3)}\n    warning [seo-title-length] /frontmatter/title: The title has 70 characters; search engines show about 60. Fix: Shorten the title.`,
      `published              blog/en/ok  ${id(2)}`,
      'Publishing: 1 published, 1 need acknowledgement, 1 blocked.',
    ])
    expect(err).toEqual([
      'hollware import: 2 entries not published: warnings are never acknowledged here, and errors block publishing. Fix the content and run the import again with --publish: what is already published is skipped.',
    ])
    const publishes = stub.calls.filter((call) => call.tool === 'publish')
    expect(publishes.map((call) => call.args.acknowledgeWarnings)).toEqual([[], [], []])
    expect([...stub.entries.values()].map((entry) => [entry.slug, entry.published])).toEqual([
      ['err', null],
      ['ok', 0],
      ['warn', null],
    ])
  })

  it('publishes only what has unpublished changes', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/en/b.md': post('B') })
    await runImport(dir, stub.url, ['--publish'])
    const first = stub.calls.length

    const { code, out } = await runImport(dir, stub.url, ['--publish'])

    expect(code).toBe(0)
    expect(out.slice(-3)).toEqual([
      `unchanged  blog/en/b  ${id(2)}  v2`,
      'Drafts: 0 created, 0 updated, 2 unchanged.',
      'Publishing: 0 published, 0 need acknowledgement, 0 blocked.',
    ])
    expect(tools(stub.calls.slice(first))).not.toContain('publish')
  })

  it('publishes an entry that was published and then changed', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A') })
    await runImport(dir, stub.url, ['--publish'])
    writeFileSync(join(dir, 'blog/en/a.md'), post('A', 'Edited.\n'))

    const { code, out } = await runImport(dir, stub.url, ['--publish'])

    expect(code).toBe(0)
    expect(out.slice(-4)).toEqual([
      `updated    blog/en/a  ${id(1)}  v3`,
      'Drafts: 0 created, 1 updated, 0 unchanged.',
      `published              blog/en/a  ${id(1)}`,
      'Publishing: 1 published, 0 need acknowledgement, 0 blocked.',
    ])
    expect(stub.calls.at(-1)?.args).toEqual({
      id: id(1),
      version: 3,
      acknowledgeWarnings: [],
      group: [],
    })
  })

  it('publishes nothing when a draft failed, and still imports the others', async () => {
    const stub = await serve({
      toolError: (call) =>
        call.tool === 'create_draft' && call.args.slug === 'bad'
          ? 'the store is unavailable'
          : undefined,
    })
    const dir = temp.make({ 'blog/en/bad.md': post('Bad'), 'blog/en/good.md': post('Good') })

    const { code, out, err } = await runImport(dir, stub.url, ['--publish'])

    expect(code).toBe(1)
    expect(out).toEqual([
      `Found 2 entries in ${dir} (blog: 2).`,
      'Validated 2 files: none would be refused.',
      'failed     blog/en/bad  create_draft failed: the store is unavailable',
      `created    blog/en/good  ${id(1)}  v1`,
      'Drafts: 1 created, 0 updated, 0 unchanged, 1 failed.',
    ])
    expect(err).toEqual([
      'hollware import: 1 file could not be imported (see above). Nothing was published. Fix it and run the import again: what is already there stays unchanged.',
    ])
    expect(tools(stub.calls)).not.toContain('publish')
  })

  it('reports a draft that is refused when it is written, and goes on', async () => {
    const stub = await serve({
      before: (call, entries) => {
        if (call.tool === 'create_draft' && call.args.slug === 'a') {
          entries.set('blog/en/a', {
            id: id(99),
            collection: 'blog',
            locale: 'en',
            slug: 'a',
            version: 1,
            revisions: ['taken'],
            published: null,
          })
        }
      },
    })
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/en/b.md': post('B') })

    const { code, out, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(out.slice(2)).toEqual([
      'failed     blog/en/a  create_draft refused: error [slug-taken] /slug: The slug is taken. Fix: Choose another slug.',
      `created    blog/en/b  ${id(1)}  v1`,
      'Drafts: 1 created, 0 updated, 0 unchanged, 1 failed.',
    ])
    expect(err).toEqual([
      'hollware import: 1 file could not be imported (see above). Fix it and run the import again: what is already there stays unchanged.',
    ])
  })

  it('reports an update that finds the entry changed, and goes on', async () => {
    let sabotage = false
    const stub = await serve({
      before: (call, entries) => {
        if (sabotage && call.tool === 'update_draft' && call.args.id === id(1)) {
          const entry = entries.get('blog/en/a')
          if (entry !== undefined) entry.version += 1
        }
      },
    })
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/en/b.md': post('B') })
    await runImport(dir, stub.url)
    sabotage = true
    writeFileSync(join(dir, 'blog/en/a.md'), post('A', 'Edited.\n'))

    const { code, out, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(out.slice(2)).toEqual([
      'failed     blog/en/a  update_draft conflict: someone changed the entry while it was imported (it is at version 2 now)',
      `unchanged  blog/en/b  ${id(2)}  v1`,
      'Drafts: 0 created, 0 updated, 1 unchanged, 1 failed.',
    ])
    expect(err).toHaveLength(1)
  })

  it('reports a publish that finds the entry changed', async () => {
    const stub = await serve({
      before: (call, entries) => {
        if (call.tool === 'publish') {
          const entry = entries.get('blog/en/a')
          if (entry !== undefined) entry.version += 1
        }
      },
    })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, out, err } = await runImport(dir, stub.url, ['--publish'])

    expect(code).toBe(1)
    expect(out.slice(-3)).toEqual([
      'Drafts: 1 created, 0 updated, 0 unchanged.',
      `conflict               blog/en/a  ${id(1)}\n    someone changed the entry after it was imported`,
      'Publishing: 0 published, 0 need acknowledgement, 0 blocked, 1 failed.',
    ])
    expect(err).toEqual([
      'hollware import: 1 entry not published: warnings are never acknowledged here, and errors block publishing. Fix the content and run the import again with --publish: what is already published is skipped.',
    ])
  })
})

describe('hollware import stops with what to do', () => {
  it('on a token the server rejects (401), without writing', async () => {
    const stub = await serve({ token: OTHER_TOKEN })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const result = await runImport(dir, stub.url)

    expect(result.code).toBe(1)
    expect(result.out).toEqual([`Found 1 entry in ${dir} (blog: 1).`])
    expect(result.err).toEqual([
      'hollware import: the server rejected the token (401). It may be wrong, expired or revoked: "hollware token create" makes a new one.',
    ])
    expect(stub.calls).toEqual([])
    expect(new Set(stub.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]))
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('on a token that lacks the scope of write (403 naming it), after the validation', async () => {
    const stub = await serve({ scopes: ['content:read'] })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, out, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(out).toEqual([
      `Found 1 entry in ${dir} (blog: 1).`,
      'Validated 1 file: none would be refused.',
    ])
    expect(err).toEqual([
      'hollware import: the token lacks a scope this call needs (403 insufficient_scope: content:write). "hollware token create --scopes <list>" makes one that has it.',
    ])
    expect(tools(stub.calls)).toEqual(['validate', 'get_entry'])
  })

  it('on a token that lacks the scope of publish: a lone entry is asked for review', async () => {
    const stub = await serve({ scopes: ['content:read', 'content:write'] })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, out, err } = await runImport(dir, stub.url, ['--publish'])

    expect([code, err]).toEqual([0, []])
    expect(out.at(-2)).toBe('pending_review         blog/en/a  ent_00000000000000000000000001')
    expect(out.at(-1)).toBe(
      'Publishing: 0 published, 0 need acknowledgement, 0 blocked, 1 asked for review.',
    )
    expect(stub.entries.get('blog/en/a')?.published).toBeNull()
  })

  it('on a token that lacks the scope of publish: the group is refused, so each entry asks alone', async () => {
    const stub = await serve({ scopes: ['content:read', 'content:write'] })
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'blog/en/b.md': post('B') })

    const { code, out, err } = await runImport(dir, stub.url, ['--publish'])

    expect([code, err]).toEqual([0, []])
    expect(out.slice(-3)).toEqual([
      'pending_review         blog/en/a  ent_00000000000000000000000001',
      'pending_review         blog/en/b  ent_00000000000000000000000002',
      'Publishing: 0 published, 0 need acknowledgement, 0 blocked, 2 asked for review.',
    ])
    expect(
      stub.calls
        .filter((call) => call.tool === 'publish')
        .map((call) => (Array.isArray(call.args['group']) ? call.args['group'].length : 0)),
    ).toEqual([1, 0, 0])
  })

  it('when nothing answers at the address', async () => {
    const closed = await startStub({ token: TOKEN })
    const url = closed.url
    await closed.close()
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, err } = await runImport(dir, url)

    expect(code).toBe(1)
    expect(err).toEqual([
      `hollware import: could not reach ${url} (ECONNREFUSED). Check --url and that Hollware is running.`,
    ])
  })

  it('when there is no MCP endpoint (404)', async () => {
    const stub = await serve({ respond: () => new Response('not here', { status: 404 }) })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { err } = await runImport(dir, stub.url)

    expect(err).toEqual([
      `hollware import: there is no MCP endpoint at ${stub.url}/mcp (404). Check --url.`,
    ])
  })

  it('when the server is not an MCP server', async () => {
    const stub = await serve({
      respond: () =>
        new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { err } = await runImport(dir, stub.url)

    expect(err).toEqual([
      `hollware import: the server at ${stub.url}/mcp does not answer like an MCP server. Check --url.`,
    ])
  })

  it('when the server answers with another status, with what it said', async () => {
    const stub = await serve({ respond: () => new Response('maintenance', { status: 503 }) })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { err } = await runImport(dir, stub.url)

    expect(err).toEqual([
      'hollware import: the server answered 503 Service Unavailable: maintenance',
    ])
  })

  it('when the server refuses with a plain 403, which may be its Host guard', async () => {
    const stub = await serve({ respond: () => new Response('forbidden host', { status: 403 }) })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware import: the server refused the request (403). The token may lack a scope, or the host in --url is not the one the server is set up for (its HOLLWARE_PUBLIC_URL).',
    ])
  })

  it('when the server does not have a tool it needs, with what it said', async () => {
    const stub = await serve({ without: ['validate'] })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(err).toEqual([
      expect.stringMatching(/^hollware import: the server refused the request: .*validate/),
    ])
  })

  it('and never sends the token to another origin when the server redirects there', async () => {
    const other = await serve()
    const stub = await serve({
      respond: () => new Response(null, { status: 307, headers: { location: `${other.url}/mcp` } }),
    })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(err).toEqual([
      `hollware import: the server redirected the request, and hollware does not follow a redirect with the token: Redirect to ${other.url}/mcp not followed; use that URL as the endpoint if it is the intended server.`,
    ])
    expect(other.authorizations).toEqual([])
  })

  it('turns an error it does not know into one message', async () => {
    const stub = await serve({
      respond: () =>
        new Response(JSON.stringify('not a JSON-RPC message'), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(err).toHaveLength(1)
    expect(err[0]).toMatch(
      /^hollware import: unexpected error: \[ \{ "code": "invalid_union", .*\. This is a bug in hollware: please report it at https:\/\/github\.com\/hollware\/hollware\/issues\.$/,
    )
    expect(err[0]).not.toContain('\n')
    expect(err[0]?.length).toBeLessThan(450)
  })
})

describe('hollware import keeps the token out of every message', () => {
  it('even when the server repeats the Authorization header in its answer', async () => {
    const stub = await serve({
      respond: (request) =>
        new Response(`bad gateway for ${request.headers.get('authorization')}`, { status: 502 }),
    })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const result = await runImport(dir, stub.url)

    expect(result.err).toEqual([
      'hollware import: the server answered 502 Bad Gateway: bad gateway for Bearer hw_pat_[redacted]',
    ])
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('even when a tool says it in words, whatever else it says', async () => {
    const stub = await serve({
      toolError: (call) =>
        call.tool === 'validate' ? `denied for ${TOKEN} and for ${OTHER_TOKEN}` : undefined,
    })
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const result = await runImport(dir, stub.url)

    expect(result.err).toEqual([
      [
        'hollware import: 1 of 1 file would be refused, so nothing was written:',
        '  blog/en/a.md: validate failed: denied for hw_pat_[redacted] and for hw_pat_[redacted]',
        'Fix them and run the import again.',
      ].join('\n'),
    ])
    expect(JSON.stringify(result)).not.toContain(TOKEN)
    expect(JSON.stringify(result)).not.toContain(OTHER_TOKEN)
  })

  it('and puts a token of the wrong shape in no message', async () => {
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'token.txt': 'hw_pat_tooshort\n' })

    const result = await run(
      ['import', dir, '--url', 'https://cms.example.com', '--token-file', 'token.txt'],
      { cwd: dir },
    )

    expect(result).toEqual({
      code: 1,
      out: [],
      err: [
        'hollware import: the token in token.txt is not a Hollware personal token: it is hw_pat_ followed by 52 characters. "hollware token create" makes one.',
      ],
    })
  })
})

describe('hollware import reads the token', () => {
  it('from --token-file, relative to the working directory, without the line end', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'secrets/token.txt': `${TOKEN}\r\n` })

    const { code } = await run(
      ['import', dir, '--url', stub.url, '--token-file', 'secrets/token.txt'],
      { cwd: dir },
    )

    expect(code).toBe(0)
    expect(new Set(stub.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]))
  })

  it('from --token-file and not from stdin when both are there', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A'), 'token.txt': TOKEN })
    let read = false

    const { code } = await run(
      ['import', dir, '--url', stub.url, '--token-file', join(dir, 'token.txt')],
      {
        readStdin: () => {
          read = true
          return Promise.resolve(OTHER_TOKEN)
        },
      },
    )

    expect(code).toBe(0)
    expect(read).toBe(false)
    expect(new Set(stub.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]))
  })

  it('from stdin when there is no file', async () => {
    const stub = await serve()
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code } = await runImport(dir, stub.url)

    expect(code).toBe(0)
    expect(new Set(stub.authorizations)).toEqual(new Set([`Bearer ${TOKEN}`]))
  })

  it.each([
    [
      'there is no file and nothing is piped',
      [],
      /^hollware import: give the token with --token-file <file>, or pipe it into stdin\. Run "hollware import --help" for the options\.$/,
    ],
    [
      'the file is missing',
      ['--token-file', 'missing.txt'],
      /^hollware import: could not read the token file missing\.txt: ENOENT/,
    ],
  ])('and fails when %s', async (_when, args, message) => {
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, out, err } = await run(
      ['import', dir, '--url', 'https://cms.example.com', ...args],
      { cwd: dir, readStdin: () => Promise.resolve(undefined) },
    )

    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([expect.stringMatching(message)])
  })

  it('and fails when what is piped is not a token', async () => {
    const dir = temp.make({ 'blog/en/a.md': post('A') })

    const { code, err } = await run(['import', dir, '--url', 'https://cms.example.com'], {
      cwd: dir,
      readStdin: () => Promise.resolve('hello\n'),
    })

    expect(code).toBe(1)
    expect(err).toEqual([
      'hollware import: the token on stdin is not a Hollware personal token: it is hw_pat_ followed by 52 characters. "hollware token create" makes one.',
    ])
  })
})

describe('hollware import reads the directory', () => {
  it('reports the files it skips, and stops before it connects when a file cannot be imported', async () => {
    const stub = await serve()
    const dir = temp.make({
      'README.md': 'readme',
      'blog/notes.md': 'notes',
      'blog/en/ok.md': post('Ok'),
      'blog/en/Bad Slug.md': post('Bad'),
    })

    const { code, out, err } = await runImport(dir, stub.url)

    expect(code).toBe(1)
    expect(out).toEqual([
      `Found 1 entry in ${dir} (blog: 1).`,
      'Skipped 2 Markdown files that are not at <collection>/<locale>/<slug>.md: README.md, blog/notes.md.',
    ])
    expect(err).toEqual([
      [
        'hollware import: 1 file cannot be imported, so nothing was sent:',
        '  blog/en/Bad Slug.md: "Bad Slug" is not a slug: use lowercase letters and digits joined by hyphens, up to 200 characters.',
        'Fix or remove them and run the import again.',
      ].join('\n'),
    ])
    expect(stub.authorizations).toEqual([])
    expect(stub.calls).toEqual([])
  })

  it('names at most five skipped files, and says "is" for one', async () => {
    const stub = await serve()
    const many = Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => [`${name}.md`, 'x']),
    )
    const dir = temp.make({ ...many, 'blog/en/ok.md': post('Ok') })

    const { out } = await runImport(dir, stub.url, ['--dry-run'])

    expect(out[1]).toBe(
      'Skipped 7 Markdown files that are not at <collection>/<locale>/<slug>.md: a.md, b.md, c.md, d.md, e.md and 2 more.',
    )

    const one = temp.make({ 'only.md': 'x', 'blog/en/ok.md': post('Ok') })
    expect((await runImport(one, stub.url, ['--dry-run'])).out[1]).toBe(
      'Skipped 1 Markdown file that is not at <collection>/<locale>/<slug>.md: only.md.',
    )
  })

  it('says what it expects when the directory holds no entry', async () => {
    const dir = temp.make({ 'notes.txt': 'nothing here' })

    const { code, err } = await run(['import', dir, '--url', 'https://cms.example.com'], {
      cwd: dir,
      readStdin: () => Promise.resolve(TOKEN),
    })

    expect(code).toBe(1)
    expect(err).toEqual([
      `hollware import: no entries in ${dir}: expected Markdown files at <collection>/<locale>/<slug>.md, such as blog/en/hello.md.`,
    ])
  })

  it('says when the directory is not one', async () => {
    const dir = temp.make({ 'file.md': 'x' })

    const { code, err } = await run(['import', 'file.md', '--url', 'https://cms.example.com'], {
      cwd: dir,
      readStdin: () => Promise.resolve(TOKEN),
    })

    expect(code).toBe(1)
    expect(err).toEqual(['hollware import: file.md is not a directory.'])
  })
})

describe('hollware import asks for what it needs', () => {
  it.each([
    [
      [],
      /^hollware import: import takes one directory: hollware import <directory> --url <url>\. Run "hollware import --help"/,
    ],
    [['a', 'b', '--url', 'https://x.test'], /^hollware import: import takes one directory/],
    [
      ['dir'],
      /^hollware import: --url is required: the address of your Hollware, such as https:\/\/cms\.example\.com\./,
    ],
    [
      ['dir', '--url', 'cms'],
      /^hollware import: invalid --url "cms": use the address of your Hollware/,
    ],
    [
      ['dir', '--url', 'http://cms.example.com'],
      /^hollware import: --url must start with https:\/\/, or the token would travel unencrypted\. Plain http is accepted only for localhost\./,
    ],
    [
      ['dir', '--url', 'ftp://cms.example.com'],
      /^hollware import: --url must start with https:\/\//,
    ],
    [
      ['dir', '--url', 'https://user:secret@cms.example.com'],
      /^hollware import: --url must not hold a user name or a password/,
    ],
    [
      ['dir', '--url', 'https://cms.example.com/?a=1'],
      /^hollware import: --url takes the address of Hollware only, without a query or a fragment\./,
    ],
    [
      ['dir', '--url', 'https://cms.example.com/#x'],
      /^hollware import: --url takes the address of Hollware only/,
    ],
  ])('rejects %j before it reads anything', async (args, message) => {
    let read = false

    const { code, out, err } = await run(['import', ...args], {
      readStdin: () => {
        read = true
        return Promise.resolve(TOKEN)
      },
    })

    expect(code).toBe(1)
    expect(out).toEqual([])
    expect(err).toEqual([expect.stringMatching(message)])
    expect(read).toBe(false)
  })
})

describe('mcpEndpoint', () => {
  it.each([
    ['https://cms.example.com', 'https://cms.example.com/mcp'],
    ['https://cms.example.com/', 'https://cms.example.com/mcp'],
    ['https://cms.example.com/mcp', 'https://cms.example.com/mcp'],
    ['https://cms.example.com/mcp/', 'https://cms.example.com/mcp'],
    ['https://example.com/cms', 'https://example.com/cms/mcp'],
    ['https://example.com:8443/cms/', 'https://example.com:8443/cms/mcp'],
    ['http://localhost:5173', 'http://localhost:5173/mcp'],
    ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787/mcp'],
    ['http://[::1]:8787', 'http://[::1]:8787/mcp'],
    ['http://app.localhost:3000', 'http://app.localhost:3000/mcp'],
  ])('turns %s into %s', (address, endpoint) => {
    expect(mcpEndpoint(address).href).toBe(endpoint)
  })

  it.each([
    'http://example.com',
    'http://localhost.example.com',
    'http://127.0.0.1.example.com',
    'http://10.0.0.5:8787',
  ])('refuses plain http for %s', (address) => {
    expect(() => mcpEndpoint(address)).toThrow(/^--url must start with https:\/\//)
  })
})

describe('redact', () => {
  it('replaces a secret that does not look like a token, wherever it is', () => {
    expect(redact('say SECRET-VALUE, twice: SECRET-VALUE', 'SECRET-VALUE')).toBe(
      'say hw_pat_[redacted], twice: hw_pat_[redacted]',
    )
  })

  it('replaces the token, wherever it is, and anything that has the shape of one', () => {
    expect(
      redact(`a ${TOKEN} b ${TOKEN} c ${OTHER_TOKEN} d hw_pat_${'a'.repeat(51)} e`, TOKEN),
    ).toBe(
      `a hw_pat_[redacted] b hw_pat_[redacted] c hw_pat_[redacted] d hw_pat_${'a'.repeat(51)} e`,
    )
  })
})

describe('hollware import --from', () => {
  it('--from nuxt-content sends the pages of a content directory, routed, byte for byte', async () => {
    const stub = await serve()
    const page = '---\ntitle: Install\n---\n\n::callout{type="tip"}\nRun it.\n::\n'
    const dir = temp.make({
      '1.guide/2.install.md': page,
      'index.md': '# Home\n',
      '_draft.md': 'x',
    })

    const { code, out, err } = await runImport(dir, stub.url, [
      '--from',
      'nuxt-content',
      '--collection',
      'docs',
    ])

    expect(err).toEqual([])
    expect(code).toBe(0)
    expect(out[0]).toBe(`Found 2 entries in ${dir} (docs: 2).`)
    expect([...stub.entries.keys()]).toEqual(['docs/en/guide-install', 'docs/en/index'])
    expect(stub.entries.get('docs/en/guide-install')?.revisions).toEqual([page])
  })

  it('asks for what a source needs, and refuses one it does not know', async () => {
    const stub = await serve()
    const dir = temp.make({ 'index.md': '# Home\n' })

    const noCollection = await runImport(dir, stub.url, ['--from', 'nuxt-content'])
    const unknown = await runImport(dir, stub.url, ['--from', 'wordpress'])

    expect(noCollection.err.join('\n')).toContain('--from nuxt-content needs --collection')
    expect(unknown.err.join('\n')).toContain(
      '--from takes markdown, nuxt-content or notion, not "wordpress".',
    )
    expect(stub.calls).toEqual([])
  })
})
