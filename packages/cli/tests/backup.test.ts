// Fails when:
// - "lists the backups …": `backup list` stops calling list_backups, or prints other than the date
//   and the size in KB, or says nothing when there are none.
// - "writes the backup of a date as files …": `backup get` downloads another path, sends no token,
//   writes a trashed entry, a path other than <collection>/<locale>/<slug>.md, changes the bytes
//   of the Markdown, or leaves out site.json.
// - "--published writes what was published …": --published writes drafts, or the latest
//   revision of a published entry instead of the published one.
// - "says when there is no backup of a date": a 404 is not told, or something is written.
// - "refuses an entry that cannot be a file below the directory": the path check is dropped.
// - "asks for a date as YYYY-MM-DD": a malformed date reaches the server.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vite-plus/test'
import { run } from './support/io.ts'
import { tempDirs } from './support/project.ts'
import { startStub, type StubOptions, type StubServer } from './support/stub-hollware.ts'

const TOKEN = `hw_pat_${'a'.repeat(52)}`
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

function runBackup(cwd: string, args: string[]) {
  return run(['backup', ...args], { cwd, readStdin: () => Promise.resolve(`${TOKEN}\n`) })
}

/** The files below a directory, as `a/b/c.md`, sorted. */
function filesOf(root: string): string[] {
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((path) => path.split('\\').join('/'))
    .filter((path) => statSync(join(root, path)).isFile())
    .sort()
}

const DEFINITION = { collections: [{ name: 'blog', locales: ['en', 'es'] }] }

const row = (fields: Record<string, unknown>) => ({
  id: 'ent_00000000000000000000000001',
  collection: 'blog',
  locale: 'en',
  status: 'draft',
  translationGroup: null,
  deletedAt: null,
  published: null,
  ...fields,
})

const BACKUP = {
  hollware: 'backup/1',
  site: 'blog',
  at: '2026-10-18T03:05:00.000Z',
  definition: DEFINITION,
  entries: [
    row({
      slug: 'hello',
      status: 'published',
      markdown: '---\ntitle: Hello again\n---\n\nEdited.\r\n',
      published: '---\ntitle: Hello\n---\n\nFirst.\n',
    }),
    row({ locale: 'es', slug: 'borrador', markdown: '---\ntitle: Borrador\n---\n' }),
    row({ slug: 'gone', markdown: '# Gone\n', deletedAt: '2026-10-17T10:00:00.000Z' }),
  ],
}

/** A Hollware that serves `body` at /v1/backups/2026-10-18 to the token, and 404 for any other date. */
function servingBackup(body: unknown, seen: string[] = []) {
  return serve({
    respond: (request) => {
      const path = new URL(request.url).pathname
      if (!path.startsWith('/v1/backups/')) return undefined
      seen.push(`${path} ${request.headers.get('authorization')}`)
      return path === '/v1/backups/2026-10-18'
        ? Response.json(body)
        : Response.json({ code: 'not_found' }, { status: 404 })
    },
  })
}

describe('hollware backup', () => {
  it('lists the backups, with their size, and says when there are none', async () => {
    const some = await serve({
      backups: [
        { date: '2026-10-18', bytes: 2049 },
        { date: '2026-10-17', bytes: 100 },
      ],
    })
    const none = await serve({ backups: [] })
    const cwd = temp.make()

    const listed = await runBackup(cwd, ['list', '--url', some.url])
    const empty = await runBackup(cwd, ['list', '--url', none.url])

    expect([listed.code, empty.code]).toEqual([0, 0])
    expect(listed.out).toEqual(['2026-10-18  3 KB\n2026-10-17  1 KB'])
    expect(empty.out).toEqual(['No backups yet: the first is made after 03:00 UTC.'])
  })

  it('writes the backup of a date as files, without the trash, with site.json', async () => {
    const seen: string[] = []
    const stub = await servingBackup(BACKUP, seen)
    const cwd = temp.make()

    const { code, out } = await runBackup(cwd, ['get', '2026-10-18', 'out', '--url', stub.url])

    expect(code).toBe(0)
    expect(seen).toEqual([`/v1/backups/2026-10-18 Bearer ${TOKEN}`])
    const root = join(cwd, 'out')
    expect(filesOf(root)).toEqual(['blog/en/hello.md', 'blog/es/borrador.md', 'site.json'])
    expect(readFileSync(join(root, 'blog/en/hello.md'), 'utf8')).toBe(
      '---\ntitle: Hello again\n---\n\nEdited.\r\n',
    )
    expect(JSON.parse(readFileSync(join(root, 'site.json'), 'utf8'))).toEqual(DEFINITION)
    expect(out).toEqual([
      'Wrote 2 entries of the backup of 2026-10-18 to out, with site.json. "hollware import out" takes them back.',
    ])
  })

  it('--published writes what was published, as it was published', async () => {
    const stub = await servingBackup(BACKUP)
    const cwd = temp.make()

    const { code } = await runBackup(cwd, [
      'get',
      '2026-10-18',
      'out',
      '--url',
      stub.url,
      '--published',
    ])

    expect(code).toBe(0)
    const root = join(cwd, 'out')
    expect(filesOf(root)).toEqual(['blog/en/hello.md', 'site.json'])
    expect(readFileSync(join(root, 'blog/en/hello.md'), 'utf8')).toBe(
      '---\ntitle: Hello\n---\n\nFirst.\n',
    )
  })

  it('says when there is no backup of a date, and writes nothing', async () => {
    const stub = await servingBackup(BACKUP)
    const cwd = temp.make()

    const { code, err } = await runBackup(cwd, ['get', '2026-10-01', 'out', '--url', stub.url])

    expect(code).toBe(1)
    expect(err[0]).toBe(
      'hollware backup: there is no backup of 2026-10-01: "hollware backup list" says which there are.',
    )
    expect(existsSync(join(cwd, 'out'))).toBe(false)
  })

  it('refuses an entry that cannot be a file below the directory', async () => {
    const stub = await servingBackup({
      ...BACKUP,
      entries: [row({ locale: '..', slug: 'escape', markdown: '# Out\n' })],
    })
    const cwd = temp.make()

    const { code, err } = await runBackup(cwd, ['get', '2026-10-18', 'out', '--url', stub.url])

    expect(code).toBe(1)
    expect(err[0]).toBe(
      'hollware backup: the backup names blog/../escape, which is not a path an entry has. Nothing more was written.',
    )
    expect(filesOf(cwd)).toEqual([])
  })

  it('asks for a date as YYYY-MM-DD before it connects', async () => {
    const stub = await servingBackup(BACKUP)
    const cwd = temp.make()

    const { code, err } = await runBackup(cwd, ['get', '18-10-2026', 'out', '--url', stub.url])

    expect(code).toBe(1)
    expect(err[0]).toContain('18-10-2026 is not a date: give it as YYYY-MM-DD')
    expect(stub.authorizations).toEqual([])
  })
})
