import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { MAX_ASSET_BYTES, makePreviewToken, type Conversion } from '@hollware/core'
import { d1Catalog, r2Files } from '../../src/media/cloudflare.ts'
import { getAsset, listAssets, updateAsset, uploadAsset } from '../../src/ops/assets.ts'
import { handlers } from '../../src/ops/index.ts'
import { createRpc } from '../../src/rpc/index.ts'
import type { ImageConverter, ImageInfo, Media } from '../../src/ports.ts'
import type { OperationContext } from '../../src/ops/types.ts'
import { agent, blogPost, warmUpComark } from './support.ts'
import { createPost, newWorld, publishPost, type World } from './world.ts'

// Fails when (src/ops/assets.ts, src/media/cloudflare.ts, ADR-038):
// - "converts once …": the converter is asked for anything but the site's setting with quality and
//   anim given, the file served or the original is not in R2 under its key, or the row is not
//   written with the size the converter made, or its copy 640 pixels wide is not made from the
//   original, kept at <served>/640 and answered in widths and srcset.
// - "makes the copies of the widths of the site …": the copies are not the site's widths, the
//   allowance running out at a copy refuses the image instead of keeping those made, or
//   `widths: []` still makes one.
// - "keeps no original …": the original is written under media.keepOriginals false, or the file
//   served or its copies are not.
// - "is the same asset …": the same bytes convert or write again, or a second row appears.
// - "scales down …": a wide image keeps its width, or its height is not scaled with it.
// - "keeps a plain SVG … refuses one that can run": an SVG reaches the converter, or a refused one
//   leaves a file or a row behind.
// - "refuses what is not an image": the name or the claimed type is trusted over the bytes.
// - "says when it cannot": no bucket, or the converter's 9412, 9516 and 9422, are not refused or
//   unavailable with a fix, or leave something behind; without the binding the file is not kept.
// - "changes the alt …": update_asset keeps the old alt, changes another site's image, or the alt
//   of an image of the site does not reach a reader where the Markdown gives none, or replaces one
//   it gives; or images-have-alt refuses an image of the site written without an alt.
// - "lists and gets …": a page is not newest first, the cursor does not continue it, or a site
//   reads another's asset.
// - "a read of the published site sees URLs …": get_entry, list_entries or get_translations of
//   a site (the published view, or a reader's preview of the head) keep `asset:` in the
//   frontmatter or the document, or MCP stops seeing what the agent wrote.
// - "a read of the published site …": the published view or HTML keeps `asset:`, or the head view
//   (an agent over MCP) does not; the HTML or a reader's document loses the srcset, sizes and size
//   of an image; or `images` of the summary (get_entry, list_entries) is missing for a site or
//   given to an agent.

vi.setConfig({ testTimeout: 60_000 })
beforeAll(warmUpComark, 120_000)

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 8, 9])
// Another PNG, uploaded only as an asset of rc.2 would have been.
const PNG_SMALL = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 2])
const WEBP_OUT = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 converted')
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><rect width="4" height="4"/></svg>'

/** Base64 of bytes or text, a chunk at a time: a spread of 10 MB would overflow the stack. */
const base64 = (bytes: Uint8Array | string) => {
  const all = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  let binary = ''
  for (let at = 0; at < all.length; at += 0x8000) {
    binary += String.fromCharCode(...all.subarray(at, at + 0x8000))
  }
  return btoa(binary)
}

/** What the fake converter makes: a narrower copy names its width, so a test tells them apart. */
const copyOut = (conversion: Conversion) =>
  conversion.width === undefined || conversion.width === 2400
    ? WEBP_OUT
    : new TextEncoder().encode(`RIFF\0\0\0\0WEBPVP8 ${conversion.width}`)

/** A converter that answers what it is told, and records what it was asked. */
function fakeImages(info: ImageInfo, failure?: { code: number }, infoFailure?: Error) {
  const asked: Conversion[] = []
  const images: ImageConverter = {
    info: async () => {
      if (infoFailure !== undefined) throw infoFailure
      return info
    },
    convert: async (_bytes, conversion) => {
      asked.push(conversion)
      if (failure !== undefined) throw Object.assign(new Error('IMAGES_TRANSFORM_ERROR'), failure)
      return { bytes: copyOut(conversion), format: conversion.format }
    },
  }
  return { images, asked }
}

function mediaWith(images: ImageConverter | null): Media {
  return {
    files: r2Files(env.MEDIA),
    images,
    catalog: d1Catalog(env.DB),
    baseUrl: 'https://cms.example.com/assets/',
  }
}

const withMedia = (context: OperationContext, media: Media | null): OperationContext => ({
  ...context,
  media,
})

async function stored(key: string): Promise<Uint8Array | null> {
  const object = await env.MEDIA.get(key)
  return object === null ? null : new Uint8Array(await object.arrayBuffer())
}

async function rows(site: string): Promise<number> {
  const row = await env.DB.prepare('SELECT count(*) AS n FROM assets WHERE site_id = ?')
    .bind(site)
    .first<{ n: number }>()
  return row?.n ?? 0
}

describe('upload_asset', () => {
  let world: World
  beforeAll(async () => {
    world = await newWorld(env.DB, 'media')
  })

  it("converts once by the site's setting, and keeps the file and the original in R2", async () => {
    const { images, asked } = fakeImages({ format: 'image/jpeg', width: 1200, height: 800 })
    const context = withMedia(world.context(), mediaWith(images))

    const answer = await uploadAsset(
      { filename: 'talk.jpg', alt: 'The stage', data: base64(JPEG) },
      context,
    )

    // The file served, then its copy 640 pixels wide: 1280 is not narrower than the image.
    expect(asked).toEqual([
      { format: 'image/webp', quality: 85, anim: true },
      { format: 'image/webp', quality: 85, anim: true, width: 640 },
    ])
    expect(answer.outcome).toBe('created')
    const id = answer.asset?.id ?? ''
    const url = `https://cms.example.com/assets/${world.tenant.key}/${id}`
    expect(answer.asset).toEqual({
      id,
      reference: `asset:${id}`,
      url,
      format: 'image/webp',
      width: 1200,
      height: 800,
      bytes: WEBP_OUT.length,
      widths: [640],
      srcset: `${url}/640 640w, ${url} 1200w`,
      originalFormat: 'image/jpeg',
      originalBytes: JPEG.length,
      alt: 'The stage',
      filename: 'talk.jpg',
      createdAt: '2026-10-13T10:00:00.000Z',
    })
    expect(id).toMatch(/^ast_[0-9a-f]{26}$/)
    expect(await stored(`sites/${world.tenant.key}/${id}`)).toEqual(WEBP_OUT)
    expect(await stored(`originals/${world.tenant.key}/${id}`)).toEqual(JPEG)
    expect(await stored(`sites/${world.tenant.key}/${id}/640`)).toEqual(
      new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 640'),
    )
  })

  it('makes the copies of the widths of the site, keeps those made when the allowance ends, and none when it says none', async () => {
    const asked: Conversion[] = []
    // The allowance of the month runs out at the second copy.
    const images: ImageConverter = {
      info: async () => ({ format: 'image/jpeg', width: 2000, height: 1000 }),
      convert: async (_bytes, conversion) => {
        asked.push(conversion)
        if (asked.length === 3)
          throw Object.assign(new Error('IMAGES_TRANSFORM_ERROR'), { code: 9422 })
        return { bytes: copyOut(conversion), format: conversion.format }
      },
    }
    const context = withMedia(world.context(), mediaWith(images))
    const site = { ...context.site, media: { ...context.site.media, widths: [] } }
    const jpeg = (n: number) => base64(new Uint8Array([...JPEG, n]))

    const halfway = await uploadAsset({ filename: 'a.jpg', alt: 'A', data: jpeg(1) }, context)
    const none = await uploadAsset(
      { filename: 'b.jpg', alt: 'B', data: jpeg(2) },
      { ...context, site },
    )

    expect(asked.map((conversion) => conversion.width)).toEqual([undefined, 640, 1280, undefined])
    expect([halfway.outcome, halfway.asset?.widths]).toEqual(['created', [640]])
    expect([none.outcome, none.asset?.widths, none.asset?.srcset]).toEqual(['created', [], null])
    const keys = await env.MEDIA.list({ prefix: `sites/${world.tenant.key}/${halfway.asset?.id}` })
    expect(keys.objects.map((object) => object.key.split('/').slice(2).join('/'))).toEqual([
      `${halfway.asset?.id}`,
      `${halfway.asset?.id}/640`,
    ])
  })

  it('keeps no original when the site says so: only the file served and its copies', async () => {
    const { images } = fakeImages({ format: 'image/jpeg', width: 1200, height: 800 })
    const context = withMedia(world.context(), mediaWith(images))
    const site = { ...context.site, media: { ...context.site.media, keepOriginals: false } }

    const answer = await uploadAsset(
      { filename: 'lean.jpg', alt: 'Lean', data: base64(new Uint8Array([...JPEG, 99])) },
      { ...context, site },
    )

    const id = answer.asset?.id ?? ''
    expect(answer.outcome).toBe('created')
    expect(await stored(`originals/${world.tenant.key}/${id}`)).toBe(null)
    expect(await stored(`sites/${world.tenant.key}/${id}`)).toEqual(WEBP_OUT)
    expect(await stored(`sites/${world.tenant.key}/${id}/640`)).not.toBe(null)
  })

  it('is the same asset for the same bytes: nothing converts or writes again', async () => {
    const { images, asked } = fakeImages({ format: 'image/jpeg', width: 1200, height: 800 })
    const context = withMedia(world.context(), mediaWith(images))
    const before = await rows(world.tenant.key)

    const again = await uploadAsset(
      { filename: 'other-name.jpg', alt: 'Another alt', data: base64(JPEG) },
      context,
    )

    expect(again.outcome).toBe('exists')
    expect([again.asset?.filename, again.asset?.alt]).toEqual(['talk.jpg', 'The stage'])
    expect(asked).toEqual([])
    expect(await rows(world.tenant.key)).toBe(before)
  })

  it('is another asset, with its own id, for the same bytes in another site', async () => {
    const neighbour = await newWorld(env.DB, 'media-neighbour')
    const { images } = fakeImages({ format: 'image/jpeg', width: 1200, height: 800 })

    const mine = await uploadAsset(
      { filename: 'talk.jpg', alt: 'The stage', data: base64(JPEG) },
      withMedia(world.context(), mediaWith(images)),
    )
    const theirs = await uploadAsset(
      { filename: 'talk.jpg', alt: 'Their stage', data: base64(JPEG) },
      withMedia(neighbour.context(), mediaWith(images)),
    )

    expect([mine.outcome, theirs.outcome]).toEqual(['exists', 'created'])
    expect(theirs.asset?.id).not.toBe(mine.asset?.id)
    expect(await rows(neighbour.tenant.key)).toBe(1)
  })

  it('finds an asset of rc.2 and before, named by its bytes alone, by those bytes', async () => {
    const legacy = await newWorld(env.DB, 'media-legacy')
    const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', PNG_SMALL))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
    await env.DB.prepare(
      `INSERT INTO assets (id, site_id, sha256, format, width, height, bytes, original_format,
         original_bytes, alt, filename, created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'image/png', 1, 1, 8, 'image/png', ?4, 'Old', 'old.png', ?5, ?6, ?6)`,
    )
      .bind(
        `ast_${sha.slice(0, 26)}`,
        legacy.tenant.key,
        sha,
        PNG_SMALL.length,
        legacy.tenant.userId,
        '2026-10-01T00:00:00.000Z',
      )
      .run()

    const again = await uploadAsset(
      { filename: 'old.png', alt: 'Old', data: base64(PNG_SMALL) },
      withMedia(legacy.context(), mediaWith(null)),
    )

    expect([again.outcome, again.asset?.id]).toEqual(['exists', `ast_${sha.slice(0, 26)}`])
    // Found before anything is written: no file under another id in R2.
    expect((await env.MEDIA.list({ prefix: `sites/${legacy.tenant.key}/` })).objects).toEqual([])
  })

  it('scales down a wide PNG, lossless, and its height with it', async () => {
    const { images, asked } = fakeImages({ format: 'image/png', width: 3000, height: 1500 })
    const context = withMedia(world.context(), mediaWith(images))

    const answer = await uploadAsset(
      { filename: 'diagram.png', alt: 'A diagram', data: base64(PNG) },
      context,
    )

    expect(asked).toEqual([
      { format: 'image/webp', quality: 100, anim: true, width: 2400 },
      { format: 'image/webp', quality: 100, anim: true, width: 640 },
      { format: 'image/webp', quality: 100, anim: true, width: 1280 },
    ])
    expect([answer.asset?.width, answer.asset?.height]).toEqual([2400, 1200])
  })

  it('keeps a plain SVG as it is, and refuses one that can run, leaving nothing', async () => {
    const { images, asked } = fakeImages({ format: 'image/svg+xml' })
    const context = withMedia(world.context(), mediaWith(images))

    const plain = await uploadAsset(
      { filename: 'logo.svg', alt: 'The logo', data: base64(SVG) },
      context,
    )
    const before = await rows(world.tenant.key)
    const evil = await uploadAsset(
      {
        filename: 'evil.svg',
        alt: 'x',
        data: base64('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      },
      context,
    )

    expect(asked).toEqual([])
    expect([plain.outcome, plain.asset?.format, plain.asset?.width]).toEqual([
      'created',
      'image/svg+xml',
      null,
    ])
    expect(await stored(`sites/${world.tenant.key}/${plain.asset?.id}`)).toEqual(
      new TextEncoder().encode(SVG),
    )
    expect(evil).toEqual({
      outcome: 'refused',
      problem: {
        message: 'This SVG is refused: it holds a <script>.',
        fix: expect.stringContaining('SVG'),
      },
    })
    expect(await rows(world.tenant.key)).toBe(before)
  })

  it('refuses what is not an image by its bytes, whatever its name says, and what is not base64', async () => {
    const context = withMedia(
      world.context(),
      mediaWith(fakeImages({ format: 'image/png', width: 1, height: 1 }).images),
    )

    const zip = await uploadAsset(
      { filename: 'photo.png', alt: 'x', data: base64(new Uint8Array([0x50, 0x4b, 0x03, 0x04])) },
      context,
    )
    const garbled = await uploadAsset({ filename: 'a.png', alt: 'x', data: 'not base64!' }, context)

    expect([zip.outcome, garbled.outcome]).toEqual(['refused', 'refused'])
    expect(zip.problem?.message).toContain('judged by its bytes')
  })

  it('says when it cannot, and keeps nothing', async () => {
    const before = await rows(world.tenant.key)
    const png = (n: number) => base64(new Uint8Array([...PNG, n]))

    const noBucket = await uploadAsset(
      { filename: 'a.png', alt: 'x', data: png(1) },
      withMedia(world.context(), null),
    )
    const quota = await uploadAsset(
      { filename: 'a.png', alt: 'x', data: png(2) },
      withMedia(
        world.context(),
        mediaWith(
          fakeImages({ format: 'image/png', width: 10, height: 10 }, { code: 9422 }).images,
        ),
      ),
    )
    const unreadable = await uploadAsset(
      { filename: 'a.png', alt: 'x', data: png(3) },
      withMedia(
        world.context(),
        mediaWith(
          fakeImages({ format: 'image/png', width: 10, height: 10 }, { code: 9412 }).images,
        ),
      ),
    )

    // What the binding threw on a damaged PNG in staging: its code is only in the message.
    const damaged = await uploadAsset(
      { filename: 'a.png', alt: 'x', data: png(5) },
      withMedia(
        world.context(),
        mediaWith(
          fakeImages(
            { format: 'image/png', width: 10, height: 10 },
            undefined,
            new Error(
              'IMAGES_INFO_ERROR 9516: Could not resize the image: error during decoding: Error while decoding the PNG image. The file may be incomplete or damaged',
            ),
          ).images,
        ),
      ),
    )

    expect([noBucket.outcome, quota.outcome, unreadable.outcome, damaged.outcome]).toEqual([
      'unavailable',
      'unavailable',
      'refused',
      'refused',
    ])
    expect(damaged.problem?.message).toContain('damaged')
    expect(noBucket.problem?.fix).toContain('MEDIA')
    expect(quota.problem?.message).toContain('allowance')
    expect(await rows(world.tenant.key)).toBe(before)

    const kept = await uploadAsset(
      { filename: 'b.png', alt: 'x', data: png(4) },
      withMedia(world.context(), mediaWith(null)),
    )
    expect([kept.outcome, kept.asset?.format, kept.asset?.width]).toEqual([
      'created',
      'image/png',
      null,
    ])
  })
})

describe('upload_asset at its limits', () => {
  it('refuses a file past 10 MB before it writes anything, and says how big it was', async () => {
    const world = await newWorld(env.DB, 'media-big')
    const big = new Uint8Array(MAX_ASSET_BYTES + 1)
    big.set(PNG)

    const answer = await uploadAsset(
      { filename: 'big.png', alt: 'Too big', data: base64(big) },
      withMedia(world.context(), mediaWith(null)),
    )

    expect([answer.outcome, answer.problem?.message]).toEqual([
      'refused',
      'The file is 10485761 bytes, more than the 10485760 an image may be.',
    ])
    expect((await env.MEDIA.list({ prefix: `originals/${world.tenant.key}/` })).objects).toEqual([])
  })

  it('fails on an error of the Images binding it does not know, instead of blaming the file', async () => {
    const world = await newWorld(env.DB, 'media-unknown')
    const { images } = fakeImages({ format: 'image/png', width: 10, height: 10 }, { code: 9999 })

    await expect(
      uploadAsset(
        { filename: 'a.png', alt: 'x', data: base64(new Uint8Array([...PNG, 9])) },
        withMedia(world.context(), mediaWith(images)),
      ),
    ).rejects.toThrow('IMAGES_TRANSFORM_ERROR')
    expect(await rows(world.tenant.key)).toBe(0)
  })
})

describe('list_assets and get_asset', () => {
  it('lists newest first with a cursor, and a site reads only its own', async () => {
    const world = await newWorld(env.DB, 'library')
    const other = await newWorld(env.DB, 'neighbour')
    const media = mediaWith(null)
    const ids: string[] = []
    for (const [n, at] of [
      [1, '2026-10-13T10:00:00.000Z'],
      [2, '2026-10-13T11:00:00.000Z'],
      [3, '2026-10-13T12:00:00.000Z'],
    ] as const) {
      world.time.set(at)
      const answer = await uploadAsset(
        {
          filename: `${n}.png`,
          alt: `Image ${n}`,
          data: base64(new Uint8Array([...PNG, 100 + n])),
        },
        withMedia(world.context(), media),
      )
      ids.push(answer.asset?.id ?? '')
    }

    const first = await listAssets({ limit: 2 }, withMedia(world.context(), media))
    const second = await listAssets(
      { limit: 2, cursor: first.nextCursor ?? '' },
      withMedia(world.context(), media),
    )
    const theirs = await listAssets({ limit: 20 }, withMedia(other.context(), media))

    expect(first.assets.map((asset) => asset.filename)).toEqual(['3.png', '2.png'])
    expect(second.assets.map((asset) => asset.filename)).toEqual(['1.png'])
    expect(second.nextCursor).toBe(null)
    expect(theirs.assets).toEqual([])
    expect((await getAsset({ id: ids[0] ?? '' }, withMedia(world.context(), media))).outcome).toBe(
      'ok',
    )
    expect((await getAsset({ id: ids[0] ?? '' }, withMedia(other.context(), media))).outcome).toBe(
      'not_found',
    )
  })
})

describe('update_asset', () => {
  it('changes the alt of an image of the site, which a reader gets where the Markdown gives none', async () => {
    const world = await newWorld(env.DB, 'alt-edit')
    const other = await newWorld(env.DB, 'alt-other')
    const media = mediaWith(null)
    const uploaded = await uploadAsset(
      { filename: 'a.png', alt: 'A first alt', data: base64(new Uint8Array([...PNG, 61])) },
      withMedia(world.context(), media),
    )
    const id = uploaded.asset?.id ?? ''
    const created = await world.agent.createDraft({
      collection: 'blog',
      locale: 'en',
      slug: 'no-alt',
      markdown: blogPost(
        { title: 'No alt', date: '2026-10-01', tags: '[a]', translationGroup: 'no-alt' },
        `\n# No alt\n\n![](asset:${id})\n\n![Its own](asset:${id})\n`,
      ),
    })

    const updated = await updateAsset(
      { id, alt: ' The new alt ' },
      withMedia(world.context(), media),
    )
    const unchanged = await updateAsset(
      { id, alt: 'The new alt' },
      withMedia(world.context(), media),
    )
    const theirs = await updateAsset({ id, alt: 'Stolen' }, withMedia(other.context(), media))
    const read = await agent({ ...withMedia(world.context(), media), reader: true }).getEntry({
      collection: 'blog',
      locale: 'en',
      slug: 'no-alt',
      formats: ['html'],
    })

    expect(created.verdict?.errors.filter((error) => error.contract === 'images-have-alt')).toEqual(
      [],
    )
    expect([updated.outcome, updated.asset?.alt]).toEqual(['updated', 'The new alt'])
    expect([unchanged.outcome, theirs.outcome]).toEqual(['unchanged', 'not_found'])
    // The catalog itself changes the asset of the site it is given, never another's.
    expect(await d1Catalog(env.DB).updateAlt(other.tenant.key, id, 'Stolen')).toBe(null)
    expect((await d1Catalog(env.DB).byId(world.tenant.key, id))?.alt).toBe('The new alt')
    expect(read.entry?.html).toContain('alt="The new alt"')
    expect(read.entry?.html).toContain('alt="Its own"')
  })
})

describe('asset references in reads', () => {
  it('a read of the published site sees URLs; an agent over MCP sees what it wrote', async () => {
    const world = await newWorld(env.DB, 'pictures')
    const media = mediaWith(fakeImages({ format: 'image/png', width: 1600, height: 900 }).images)
    const uploaded = await uploadAsset(
      { filename: 'c.png', alt: 'Cover', data: base64(new Uint8Array([...PNG, 42])) },
      withMedia(world.context(), media),
    )
    const id = uploaded.asset?.id ?? ''
    const url = `https://cms.example.com/assets/${world.tenant.key}/${id}`
    const created = await world.agent.createDraft({
      collection: 'blog',
      locale: 'en',
      slug: 'with-an-image',
      markdown: blogPost(
        {
          title: 'With an image',
          date: '2026-10-01',
          tags: '[cloudflare]',
          translationGroup: 'with-an-image',
          cover: `asset:${id}`,
        },
        `\n# With an image\n\n![The cover](asset:${id})\n`,
      ),
    })
    if (created.entry === undefined) throw new Error(JSON.stringify(created))
    await createPost(world, { slug: 'con-una-imagen', locale: 'es', group: 'with-an-image' })
    await publishPost(world, created.entry)

    const key = { collection: 'blog', locale: 'en', slug: 'with-an-image' }
    const head = await agent(withMedia(world.context(), media)).getEntry({
      ...key,
      formats: ['document', 'html'],
    })
    const reader = await agent(withMedia(world.context({ view: 'published' }), media)).getEntry({
      ...key,
      formats: ['document', 'html'],
    })

    const srcset = `${url}/640 640w, ${url}/1280 1280w, ${url} 1600w`
    expect(JSON.stringify(head.entry?.document)).toContain(`asset:${id}`)
    expect(head.entry?.html).toContain(`src="${url}"`)
    expect(JSON.stringify(reader.entry?.document)).not.toContain('asset:')
    expect(JSON.stringify(reader.entry?.document)).toContain(url)
    expect(reader.entry?.html).toContain(`src="${url}"`)
    // Whoever reads the HTML gets the copies and the size of each image, MCP as a site.
    for (const html of [head.entry?.html, reader.entry?.html]) {
      expect(html).toContain(`srcset="${srcset}"`)
      expect(html).toContain('sizes="(min-width: 1600px) 1600px, 100vw"')
      expect(html).toContain('width="1600" height="900"')
    }
    expect(JSON.stringify(reader.entry?.document)).toContain(`"srcset":"${srcset}"`)
    // The cover of the frontmatter, by its URL, for a site; nothing for an agent.
    expect(reader.entry?.images).toEqual({ [url]: { width: 1600, height: 900, srcset } })
    expect(head.entry?.images).toBe(undefined)

    expect([head.entry?.frontmatter['cover'], reader.entry?.frontmatter['cover']]).toEqual([
      `asset:${id}`,
      url,
    ])

    // A site's preview of a draft reads the head revision, as a reader: URLs too.
    const preview = await agent({ ...withMedia(world.context(), media), reader: true }).getEntry({
      ...key,
      formats: ['document'],
    })
    expect(preview.entry?.frontmatter['cover']).toBe(url)
    expect(JSON.stringify(preview.entry?.document)).not.toContain('asset:')

    // Lists and translations of the published site, against what an agent lists.
    const site = agent(withMedia(world.context({ view: 'published' }), media))
    const listed = await site.listEntries({ collection: 'blog', locale: 'en' })
    const mine = await agent(withMedia(world.context(), media)).listEntries({
      collection: 'blog',
      locale: 'en',
    })
    const group = await site.getTranslations({
      collection: 'blog',
      translationGroup: 'with-an-image',
    })
    expect([
      listed.entries?.[0]?.frontmatter['cover'],
      mine.entries?.[0]?.frontmatter['cover'],
      group.entries?.find((entry) => entry.locale === 'en')?.frontmatter['cover'],
    ]).toEqual([url, `asset:${id}`, url])
    expect([listed.entries?.[0]?.images?.[url]?.srcset, mine.entries?.[0]?.images]).toEqual([
      srcset,
      undefined,
    ])
  })

  it('reaches a site over RPC as URLs, published or in a preview of the draft', async () => {
    const world = await newWorld(env.DB, 'rpc-pictures')
    const uploaded = await uploadAsset(
      { filename: 'r.png', alt: 'Cover', data: base64(new Uint8Array([...PNG, 77])) },
      withMedia(world.context(), mediaWith(null)),
    )
    const id = uploaded.asset?.id ?? ''
    const created = await world.agent.createDraft({
      collection: 'blog',
      locale: 'en',
      slug: 'over-rpc',
      markdown: blogPost(
        {
          title: 'Over RPC',
          date: '2026-10-01',
          tags: '[cloudflare]',
          translationGroup: 'over-rpc',
          cover: `asset:${id}`,
        },
        '\n# Over RPC\n',
      ),
    })
    if (created.entry === undefined) throw new Error(JSON.stringify(created))
    await createPost(world, { slug: 'por-rpc', locale: 'es', group: 'over-rpc' })
    await publishPost(world, created.entry)
    const secret = 's'.repeat(32)
    const rpc = createRpc(
      {
        sites: new Map([[world.tenant.key, world.tenant.site]]),
        handlers,
        clock: world.time.clock,
        log: () => {},
      },
      {
        DB: env.DB,
        MEDIA: env.MEDIA,
        HOLLWARE_SECRET: secret,
        HOLLWARE_PUBLIC_URL: 'https://cms.example.com',
      },
    )
    const { token } = await makePreviewToken({
      secret,
      site: world.tenant.key,
      entryId: created.entry.id,
      now: world.time.clock.now(),
    })

    const published = await rpc.getEntry(world.tenant.key, 'blog', 'over-rpc', 'en')
    const previewed = await rpc.getEntry(world.tenant.key, 'blog', 'over-rpc', 'en', {
      preview: token,
    })

    const url = `https://cms.example.com/assets/${world.tenant.key}/${id}`
    expect([published.entry?.frontmatter['cover'], previewed.entry?.frontmatter['cover']]).toEqual([
      url,
      url,
    ])
  })
})
