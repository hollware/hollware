/**
 * An npm registry for the install end-to-end test, and nothing more: it serves Hollware's own
 * packages from local tarballs, next to the versions npm already has of them, and sends every other
 * request to registry.npmjs.org as it is. A project installed through it gets this checkout's
 * Hollware and the real everything else.
 *
 * The versions it serves locally say they were published long ago, so that a package manager that
 * waits for a release to age (pnpm's minimumReleaseAge) installs them at once, as it will install
 * a real release a day after it.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LocalPackage {
  readonly name: string
  readonly version: string
  /** The package.json inside the tarball. */
  readonly manifest: Record<string, unknown>
  /** The path of the `.tgz`. */
  readonly file: string
}

export interface Registry {
  readonly url: string
  /** Every path asked for, in order: what the install reached. */
  readonly requests: readonly string[]
  close(): Promise<void>
}

const UPSTREAM = 'https://registry.npmjs.org'
/** The publication date of every local version: older than any minimum release age. */
const LONG_AGO = '2000-01-01T00:00:00.000Z'

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The tarball's name in a URL: `@hollware/core` → `core-1.2.3.tgz`, as npm names it. */
function tarballName({ name, version }: LocalPackage): string {
  return `${name.split('/').at(-1) ?? name}-${version}.tgz`
}

/**
 * The packument of a package: npm's own, if it has one, with the local versions added on top and
 * `latest` pointing at the newest local one.
 */
export function packument(
  upstream: Json | null,
  locals: readonly LocalPackage[],
  url: string,
): Json {
  const name = locals[0]?.name ?? ''
  const versions: Json = isRecord(upstream?.['versions']) ? { ...upstream['versions'] } : {}
  const time: Json = isRecord(upstream?.['time']) ? { ...upstream['time'] } : {}
  const tags: Json = isRecord(upstream?.['dist-tags']) ? { ...upstream['dist-tags'] } : {}
  for (const local of locals) {
    const bytes = readFileSync(local.file)
    versions[local.version] = {
      ...local.manifest,
      dist: {
        tarball: `${url}/${name}/-/${tarballName(local)}`,
        shasum: createHash('sha1').update(bytes).digest('hex'),
        integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      },
    }
    time[local.version] = LONG_AGO
  }
  const newest = locals.at(-1)
  if (newest !== undefined) tags['latest'] = newest.version
  return { name, 'dist-tags': tags, versions, time }
}

async function forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const answer = await fetch(`${UPSTREAM}${request.url ?? '/'}`, {
    headers: { accept: request.headers['accept'] ?? '*/*' },
    redirect: 'follow',
  })
  response.writeHead(answer.status, {
    'content-type': answer.headers.get('content-type') ?? 'application/octet-stream',
  })
  response.end(Buffer.from(await answer.arrayBuffer()))
}

/** Starts the registry on a free port of this machine. */
export async function startRegistry(locals: readonly LocalPackage[]): Promise<Registry> {
  const byName = new Map<string, LocalPackage[]>()
  for (const local of locals) byName.set(local.name, [...(byName.get(local.name) ?? []), local])
  const requests: string[] = []
  let url = ''

  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? '/')
    requests.push(path)
    const handle = async () => {
      // A local tarball: /<name>/-/<file>.tgz
      for (const [name, packages] of byName) {
        for (const local of packages) {
          if (path === `/${name}/-/${tarballName(local)}`) {
            response.writeHead(200, { 'content-type': 'application/octet-stream' })
            response.end(readFileSync(local.file))
            return
          }
        }
      }
      const packages = byName.get(path.slice(1))
      if (packages !== undefined) {
        const upstream = await fetch(
          `${UPSTREAM}/${encodeURIComponent(path.slice(1)).replace('%40', '@')}`,
          {
            headers: { accept: 'application/json' },
          },
        )
        const known: unknown = upstream.ok ? await upstream.json() : null
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(packument(isRecord(known) ? known : null, packages, url)))
        return
      }
      await forward(request, response)
    }
    handle().catch((error: unknown) => {
      response.writeHead(502, { 'content-type': 'text/plain' })
      response.end(String(error))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
