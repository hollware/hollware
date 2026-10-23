import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'

import { d1Catalog, imagesConverter } from '../../src/media/cloudflare.ts'
import { seedToken } from '../auth/support.ts'
import { boot, restoreLogs, SITE_KEY } from './support.ts'

const LATER = '2026-11-11T12:00:00.000Z'
const ID = 'ast_00112233445566778899aabbcc'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])

afterEach(() => {
  restoreLogs()
})

async function seedAsset(
  site: string,
  userId: string,
  id: string,
  format: string,
  body: Uint8Array,
) {
  await env.MEDIA.put(`sites/${site}/${id}`, body, { httpMetadata: { contentType: format } })
  await env.MEDIA.put(`originals/${site}/${id}`, PNG, {
    httpMetadata: { contentType: 'image/png' },
  })
  await d1Catalog(env.DB).insert({
    id,
    site,
    sha256: id.slice(4).padEnd(64, '0'),
    format,
    width: null,
    height: null,
    bytes: body.length,
    widths: [],
    originalFormat: 'image/png',
    originalBytes: PNG.length,
    alt: 'A test image',
    filename: 'test.png',
    createdBy: userId,
    createdAt: '2026-10-13T10:00:00.000Z',
  })
}

describe('GET /assets/<site>/<id>', () => {
  it('serves an image to anyone, cached for a year, and an SVG in a sandbox', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const webp = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 x')
    const svgId = 'ast_ffeeddccbbaa99887766554433'
    await seedAsset(SITE_KEY, seeded.userId, ID, 'image/webp', webp)
    await seedAsset(
      SITE_KEY,
      seeded.userId,
      svgId,
      'image/svg+xml',
      new TextEncoder().encode('<svg/>'),
    )
    const worker = boot({ bindings: { MEDIA: env.MEDIA } })

    const image = await worker.send(`/assets/${SITE_KEY}/${ID}`)
    const svg = await worker.send(`/assets/${SITE_KEY}/${svgId}`)

    expect(image.status).toBe(200)
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(webp)
    expect({
      type: image.headers.get('content-type'),
      cache: image.headers.get('cache-control'),
      corp: image.headers.get('cross-origin-resource-policy'),
      csp: image.headers.get('content-security-policy'),
    }).toEqual({
      type: 'image/webp',
      cache: 'public, max-age=31536000, immutable',
      corp: 'cross-origin',
      csp: null,
    })
    expect(svg.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    )
  })

  it('is the JSON 404 for an image that is not there, and asks R2 nothing for an id that is no id', async () => {
    const asked: string[] = []
    const bucket = new Proxy(env.MEDIA, {
      get(target, property, receiver) {
        if (property !== 'get') return Reflect.get(target, property, receiver)
        return (key: string) => {
          asked.push(key)
          return target.get(key)
        }
      },
    })
    const worker = boot({ bindings: { MEDIA: bucket } })

    const missing = await worker.send(`/assets/${SITE_KEY}/ast_0000000000000000000000dead`)
    const malformed = await worker.send(`/assets/${SITE_KEY}/..%2Foriginals%2Fx`)
    const noBucket = await boot().send(`/assets/${SITE_KEY}/${ID}`)

    const badSite = await worker.send(`/assets/Not%20A%20Site/${ID}`)

    expect([missing.status, malformed.status, badSite.status, noBucket.status]).toEqual([
      404, 404, 404, 404,
    ])
    expect(asked).toEqual([`sites/${SITE_KEY}/ast_0000000000000000000000dead`])
    expect(await missing.json()).toMatchObject({ code: 'not_found' })
  })
})

describe('GET /assets/<site>/<id>/<width>', () => {
  it('serves the copies of an image as the image, and asks R2 nothing for a width that is none', async () => {
    const seeded = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const id = 'ast_0a0b0c0d0e0f00112233445566'
    const copy = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 640')
    await seedAsset(SITE_KEY, seeded.userId, id, 'image/webp', new Uint8Array([1]))
    await env.MEDIA.put(`sites/${SITE_KEY}/${id}/640`, copy, {
      httpMetadata: { contentType: 'image/webp' },
    })
    const asked: string[] = []
    const bucket = new Proxy(env.MEDIA, {
      get(target, property, receiver) {
        if (property !== 'get') return Reflect.get(target, property, receiver)
        return (key: string) => {
          asked.push(key)
          return target.get(key)
        }
      },
    })
    const worker = boot({ bindings: { MEDIA: bucket } })

    const served = await worker.send(`/assets/${SITE_KEY}/${id}/640`)
    const absent = await worker.send(`/assets/${SITE_KEY}/${id}/1280`)
    const odd = await worker.send(`/assets/${SITE_KEY}/${id}/0640`)
    const tiny = await worker.send(`/assets/${SITE_KEY}/${id}/64`)

    expect([served.status, absent.status, odd.status, tiny.status]).toEqual([200, 404, 404, 404])
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(copy)
    expect([served.headers.get('content-type'), served.headers.get('cache-control')]).toEqual([
      'image/webp',
      'public, max-age=31536000, immutable',
    ])
    expect(asked).toEqual([`sites/${SITE_KEY}/${id}/640`, `sites/${SITE_KEY}/${id}/1280`])
  })
})

describe('GET /v1/assets/<id>/original, for a site that keeps no originals', () => {
  it('gives the file it serves', async () => {
    const owner = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const id = 'ast_0f0e0d0c0b0a09080706050403'
    const served = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 served')
    await seedAsset(SITE_KEY, owner.userId, id, 'image/webp', served)
    await env.MEDIA.delete(`originals/${SITE_KEY}/${id}`)
    const worker = boot({ bindings: { MEDIA: env.MEDIA } })

    const answer = await worker.send(`/v1/assets/${id}/original`, { token: owner.token })

    expect([answer.status, answer.headers.get('content-type')]).toEqual([200, 'image/webp'])
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(served)
  })
})

describe('GET /v1/assets/<id>/original', () => {
  it('gives the original to a person of the site, and to no one else', async () => {
    const owner = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const reader = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER, read: true })
    const stranger = await seedToken(env.DB, 'elsewhere', { expiresAt: LATER })
    const writer = await seedToken(env.DB, SITE_KEY, {
      expiresAt: LATER,
      scopes: ['content:write'],
    })
    const id = 'ast_0102030405060708090a0b0c0d'
    await seedAsset(SITE_KEY, owner.userId, id, 'image/webp', new Uint8Array([1, 2, 3]))
    const worker = boot({ bindings: { MEDIA: env.MEDIA } })
    const path = `/v1/assets/${id}/original`

    const mine = await worker.send(path, { token: owner.token })
    const none = await worker.send(path)
    const read = await worker.send(path, { token: reader.token })
    const theirs = await worker.send(path, { token: stranger.token })
    const unscoped = await worker.send(path, { token: writer.token })

    expect(mine.status).toBe(200)
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG)
    expect(mine.headers.get('cache-control')).toBe('private, no-store')
    expect([none.status, read.status, theirs.status, unscoped.status]).toEqual([401, 403, 401, 403])
    expect(unscoped.headers.get('www-authenticate')).toContain('scope="content:read"')
  })
})

describe('the assets table', () => {
  it('keeps an asset as it is: no delete, and no change but its alt', async () => {
    const owner = await seedToken(env.DB, SITE_KEY, { expiresAt: LATER })
    const id = 'ast_a1a2a3a4a5a6a7a8a9b0b1b2b3'
    await seedAsset(SITE_KEY, owner.userId, id, 'image/webp', new Uint8Array([9]))

    await expect(env.DB.prepare('DELETE FROM assets WHERE id = ?').bind(id).run()).rejects.toThrow(
      'an asset is never deleted',
    )
    await expect(
      env.DB.prepare("UPDATE assets SET format = 'image/png' WHERE id = ?").bind(id).run(),
    ).rejects.toThrow('only the alt of an asset changes')
    await env.DB.prepare("UPDATE assets SET alt = 'A better alt' WHERE id = ?").bind(id).run()

    const row = await d1Catalog(env.DB).byId(SITE_KEY, id)
    expect([row?.alt, row?.format]).toEqual(['A better alt', 'image/webp'])
  })
})

describe('imagesConverter', () => {
  it('asks the binding with quality and anim, and scales only when asked', async () => {
    const asked: unknown[] = []
    const transformer = {
      transform(transform: { width: number; fit: 'scale-down' }) {
        asked.push(['transform', transform])
        return transformer
      },
      async output(options: {
        format: 'image/webp' | 'image/avif'
        quality: number
        anim: boolean
      }) {
        asked.push(['output', options])
        return {
          image: () => new Blob([new Uint8Array([7, 7])]).stream(),
          contentType: () => options.format,
        }
      },
    }
    const converter = imagesConverter({
      info: async () => ({ format: 'image/png', width: 10, height: 5, fileSize: 9 }),
      input: () => transformer,
    })

    const kept = await converter.convert(PNG, { format: 'image/webp', quality: 100, anim: true })
    const scaled = await converter.convert(PNG, {
      format: 'image/avif',
      quality: 85,
      anim: true,
      width: 2400,
    })

    expect(asked).toEqual([
      ['output', { format: 'image/webp', quality: 100, anim: true }],
      ['transform', { width: 2400, fit: 'scale-down' }],
      ['output', { format: 'image/avif', quality: 85, anim: true }],
    ])
    expect([kept.format, scaled.format, [...kept.bytes]]).toEqual([
      'image/webp',
      'image/avif',
      [7, 7],
    ])
    expect(await converter.info(PNG)).toEqual({ format: 'image/png', width: 10, height: 5 })
  })
})
