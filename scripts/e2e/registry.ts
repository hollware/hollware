import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LocalPackage {
  readonly name: string
  readonly version: string
  readonly manifest: Record<string, unknown>
  readonly file: string
}

export interface Registry {
  readonly url: string
  readonly requests: readonly string[]
  close(): Promise<void>
}

const UPSTREAM = 'https://registry.npmjs.org'
const OLDER_THAN_ANY_MINIMUM_RELEASE_AGE = '2000-01-01T00:00:00.000Z'

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tarballName({ name, version }: LocalPackage): string {
  return `${name.split('/').at(-1) ?? name}-${version}.tgz`
}

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
    time[local.version] = OLDER_THAN_ANY_MINIMUM_RELEASE_AGE
  }
  const newest = locals.at(-1)
  if (newest !== undefined) tags['latest'] = newest.version
  return { name, 'dist-tags': tags, versions, time }
}

export function upstreamUrl(path: string): URL {
  return new URL(`${UPSTREAM}/${path.replace(/^\/+/, '')}`)
}

async function forward(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const answer = await fetch(upstreamUrl(request.url ?? '/'), {
    headers: { accept: request.headers['accept'] ?? '*/*' },
    redirect: 'follow',
  })
  response.writeHead(answer.status, {
    'content-type': answer.headers.get('content-type') ?? 'application/octet-stream',
  })
  response.end(Buffer.from(await answer.arrayBuffer()))
}

export async function startRegistry(locals: readonly LocalPackage[]): Promise<Registry> {
  const byName = new Map<string, LocalPackage[]>()
  for (const local of locals) byName.set(local.name, [...(byName.get(local.name) ?? []), local])
  const requests: string[] = []
  let url = ''

  const server = createServer((request, response) => {
    const path = decodeURIComponent(request.url ?? '/')
    requests.push(path)
    const handle = async () => {
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
          upstreamUrl(`/${encodeURIComponent(path.slice(1)).replace(/^%40/, '@')}`),
          { headers: { accept: 'application/json' } },
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
