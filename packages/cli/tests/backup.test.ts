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

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const KEPT = `ast_${'a'.repeat(26)}`
const LOST = `ast_${'b'.repeat(26)}`

const asset = (id: string, alt: string) => ({
  id,
  sha256: 'c'.repeat(64),
  format: 'image/webp',
  width: 1,
  height: 1,
  bytes: 10,
  widths: [],
  originalFormat: 'image/png',
  originalBytes: PNG.length,
  alt,
  filename: `${alt}.png`,
  createdAt: '2026-10-02T00:00:00.000Z',
})

const BACKUP = {
  hollware: 'backup/2',
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
  redirects: [
    {
      collection: 'blog',
      locale: 'en',
      from: 'hi',
      to: 'hello',
      fromPath: '/en/blog/hi/',
      toPath: '/en/blog/hello/',
      entryId: 'ent_00000000000000000000000001',
    },
    {
      collection: 'gone',
      locale: 'en',
      from: 'a',
      to: 'b',
      fromPath: null,
      toPath: null,
      entryId: 'ent_00000000000000000000000002',
    },
  ],
  assets: [asset(KEPT, 'kept'), asset(LOST, 'lost')],
}

function servingBackup(body: unknown, seen: string[] = []) {
  return serve({
    respond: (request) => {
      const path = new URL(request.url).pathname
      if (path === `/v1/assets/${KEPT}/original`) return new Response(PNG)
      if (path.startsWith('/v1/assets/')) return new Response(null, { status: 404 })
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
    expect(filesOf(root)).toEqual([
      '_assets/assets.json',
      `_assets/${KEPT}.png`,
      'blog/en/hello.md',
      'blog/es/borrador.md',
      'redirects.json',
      'site.json',
    ])
    expect(readFileSync(join(root, 'blog/en/hello.md'), 'utf8')).toBe(
      '---\ntitle: Hello again\n---\n\nEdited.\r\n',
    )
    expect(JSON.parse(readFileSync(join(root, 'site.json'), 'utf8'))).toEqual(DEFINITION)
    expect(JSON.parse(readFileSync(join(root, 'redirects.json'), 'utf8'))).toEqual([
      { from: '/en/blog/hi/', to: '/en/blog/hello/', status: 301 },
    ])
    expect(readFileSync(join(root, `_assets/${KEPT}.png`))).toEqual(PNG)
    expect(JSON.parse(readFileSync(join(root, '_assets/assets.json'), 'utf8'))).toEqual({
      [`${KEPT}.png`]: { alt: 'kept', filename: 'kept.png' },
    })
    expect(out).toEqual([
      'Wrote 2 entries of the backup of 2026-10-18 to out, with site.json, 1 redirect, 1 image. "hollware import out" takes them back.',
      `The deployment kept no original of ${LOST}: it is left out.`,
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
    expect(filesOf(root)).toEqual([
      '_assets/assets.json',
      `_assets/${KEPT}.png`,
      'blog/en/hello.md',
      'redirects.json',
      'site.json',
    ])
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
