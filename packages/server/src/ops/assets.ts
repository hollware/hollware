import {
  assetIdOf,
  assetIdsIn,
  resolveAssetReferences,
  checkSvg,
  conversionOf,
  MAX_ASSET_BYTES,
  sniffImage,
  srcsetOf,
  variantConversion,
  variantWidthsOf,
  type ImageFormat,
} from '@hollware/core'
import type { AssetRow, Media } from '../ports.ts'
import { actorOf } from './actor.ts'
import type { OperationContext, OperationHandler } from './types.ts'

/*
 * The images of a site (ADR-038): `upload_asset` converts a file once, by the site's `media`
 * setting, and keeps it in R2 with its row in D1; `list_assets` and `get_asset` read them.
 */

const NO_BUCKET = {
  message: 'This Hollware keeps no images: its Worker has no R2 bucket bound as MEDIA.',
  fix: 'Add { "binding": "MEDIA", "bucket_name": "<name>" } to r2_buckets in wrangler.jsonc, and run hollware deploy, which creates the bucket.',
}

/** The keys of an asset's files in R2: the file served, and the file as it was uploaded. */
export const servedKey = (site: string, id: string) => `sites/${site}/${id}`
export const originalKey = (site: string, id: string) => `originals/${site}/${id}`
/** The key of its copy `width` pixels wide, made for `srcset`, served at `<url>/<width>`. */
export const variantKey = (site: string, id: string, width: number) =>
  `${servedKey(site, id)}/${width}`

/** An asset as the operations answer it. */
export function assetView(row: AssetRow, media: Media) {
  const url = `${media.baseUrl}${row.site}/${row.id}`
  return {
    id: row.id,
    reference: `asset:${row.id}`,
    url,
    format: row.format as ImageFormat,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
    widths: [...row.widths],
    srcset: srcsetOf(url, row),
    originalFormat: row.originalFormat as ImageFormat,
    originalBytes: row.originalBytes,
    alt: row.alt,
    filename: row.filename,
    createdAt: row.createdAt,
  }
}

function bytesOfBase64(data: string): Uint8Array | null {
  const clean = data.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) return null
  const binary = atob(clean)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Base64 of bytes, in slices, since a string of millions of arguments overflows the stack. */
export function base64Of(bytes: Uint8Array): string {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  }
  return btoa(binary)
}

async function sha256Of(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The error code of the Images binding, such as 9412 (not an image) or 9422 (no allowance left). */
function imagesCode(error: unknown): number | null {
  const code: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : null
  if (typeof code === 'number') return code
  const match = /\b(9\d{3})\b/.exec(error instanceof Error ? error.message : String(error))
  return match === null ? null : Number(match[1])
}

const refused = (message: string, fix: string) =>
  ({ outcome: 'refused', problem: { message, fix } }) as const

const NOT_READABLE = refused(
  'Cloudflare Images could not read this file as an image: it may be damaged or cut short.',
  'Open it in an image editor, save it again, and upload that.',
)

const NO_ALLOWANCE = {
  outcome: 'unavailable',
  problem: {
    message:
      "This month's allowance of image conversions is used up (5,000 on Cloudflare's Free plan): nothing was kept.",
    fix: 'Upload it next month, set the media format of the site to "original" to keep files as they come, or move the account to the Paid plan of Images.',
  },
} as const

export const uploadAsset: OperationHandler<'upload_asset'> = async (input, context) => {
  const media = context.media ?? null
  if (media === null) return { outcome: 'unavailable', problem: NO_BUCKET }
  const original = bytesOfBase64(input.data)
  if (original === null || original.length === 0) {
    return refused('data is not base64.', 'Send the file encoded in base64, with its padding.')
  }
  if (original.length > MAX_ASSET_BYTES) {
    return refused(
      `The file is ${original.length} bytes, more than the ${MAX_ASSET_BYTES} an image may be.`,
      'Make it smaller (fewer pixels, or a format such as WebP) and upload it again.',
    )
  }
  const originalFormat = sniffImage(original)
  if (originalFormat === null) {
    return refused(
      'This file is not an image Hollware takes: JPEG, PNG, WebP, AVIF, GIF or SVG, judged by its bytes.',
      'Export it as one of those formats and upload it again.',
    )
  }
  const sha256 = await sha256Of(original)
  const site = context.site.key
  // By the bytes, whatever id they got: an asset of rc.2 and before has the id of its bytes alone.
  const existing = await media.catalog.bySha256(site, sha256)
  if (existing !== null) return { outcome: 'exists', asset: assetView(existing, media) }
  const id = await assetIdOf(site, sha256)

  let served = original
  let format: string = originalFormat
  let width: number | null = null
  let height: number | null = null
  if (originalFormat === 'image/svg+xml') {
    const problem = checkSvg(new TextDecoder().decode(original))
    if (problem !== null) return refused(`This SVG is refused: ${problem.reason}.`, problem.fix)
  } else if (media.images !== null) {
    try {
      const info = await media.images.info(original)
      if ('width' in info) {
        width = info.width
        height = info.height
      }
      const conversion = conversionOf(originalFormat, width, context.site.media)
      if (conversion !== null) {
        const converted = await media.images.convert(original, conversion)
        served = converted.bytes
        format = converted.format
        if (conversion.width !== undefined && width !== null && height !== null) {
          height = Math.max(1, Math.round((height * conversion.width) / width))
          width = conversion.width
        }
      }
    } catch (error) {
      const code = imagesCode(error)
      if (code === 9422) return NO_ALLOWANCE
      // 9412: not an image; 9516: it could not be decoded (seen on a PNG cut short, 2026-10-18).
      if (code === 9412 || code === 9516) return NOT_READABLE
      throw error
    }
  }

  const variants = await variantsOf(media, original, originalFormat, format, width, context)
  await media.files.put(servedKey(site, id), served, format)
  // The file as it came, for a later change of format, unless the site keeps only what it serves.
  if (context.site.media.keepOriginals) {
    await media.files.put(originalKey(site, id), original, originalFormat)
  }
  for (const variant of variants) {
    await media.files.put(variantKey(site, id, variant.width), variant.bytes, variant.format)
  }
  const { row, created } = await media.catalog.insert({
    id,
    site,
    sha256,
    format,
    width,
    height,
    bytes: served.length,
    widths: variants.map((variant) => variant.width),
    originalFormat,
    originalBytes: original.length,
    alt: input.alt,
    filename: input.filename,
    createdBy: actorOf(context).userId,
    createdAt: context.clock.now().toISOString(),
  })
  return { outcome: created ? 'created' : 'exists', asset: assetView(row, media) }
}

/**
 * The narrower copies of an image for `srcset`, made from the file as it was uploaded, in the
 * format it is served in: none without the binding. When the month's allowance runs out halfway,
 * the image keeps the copies already made, since the image itself was converted.
 */
async function variantsOf(
  media: Media,
  original: Uint8Array,
  originalFormat: ImageFormat,
  format: string,
  width: number | null,
  context: OperationContext,
) {
  const made: { width: number; bytes: Uint8Array; format: string }[] = []
  if (media.images === null || (format !== 'image/webp' && format !== 'image/avif')) return made
  for (const copy of variantWidthsOf(format, width, context.site.media)) {
    try {
      const converted = await media.images.convert(
        original,
        variantConversion(format, originalFormat, copy, context.site.media),
      )
      made.push({ width: copy, ...converted })
    } catch (error) {
      if (imagesCode(error) === 9422) break
      throw error
    }
  }
  return made
}

/** The cursor of a page: the `createdAt` and id of its last row, in base64url. */
/** The cursor after a row of a listing newest first: its `createdAt` and id, in base64url. */
export const cursorOf = (row: { readonly createdAt: string; readonly id: string }) =>
  btoa(`${row.createdAt}|${row.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The position a cursor of `cursorOf` names, or `null` for none, or one that is not one. */
export function parseCursor(cursor: string | undefined) {
  if (cursor === undefined) return null
  try {
    const padded = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const [createdAt, id] = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4)).split('|')
    return createdAt !== undefined && id !== undefined ? { createdAt, id } : null
  } catch {
    return null
  }
}

export const listAssets: OperationHandler<'list_assets'> = async (input, context) => {
  const media = context.media ?? null
  if (media === null) return { outcome: 'ok', assets: [], nextCursor: null }
  const rows = await media.catalog.list(
    context.site.key,
    input.limit + 1,
    parseCursor(input.cursor),
  )
  const page = rows.slice(0, input.limit)
  const last = page.at(-1)
  return {
    outcome: 'ok',
    assets: page.map((row) => assetView(row, media)),
    nextCursor: rows.length > input.limit && last !== undefined ? cursorOf(last) : null,
  }
}

export const getAsset: OperationHandler<'get_asset'> = async (input, context) => {
  const media = context.media ?? null
  if (media === null) return { outcome: 'not_found' }
  const row = await media.catalog.byId(context.site.key, input.id)
  return row === null ? { outcome: 'not_found' } : { outcome: 'ok', asset: assetView(row, media) }
}

/** Changes the alt of an image of the site; the same alt again answers unchanged. */
export const updateAsset: OperationHandler<'update_asset'> = async (input, context) => {
  const media = context.media ?? null
  const row = media === null ? null : await media.catalog.byId(context.site.key, input.id)
  if (media === null || row === null) return { outcome: 'not_found' }
  const alt = input.alt.trim()
  if (row.alt === alt) return { outcome: 'unchanged', asset: assetView(row, media) }
  const updated = await media.catalog.updateAlt(context.site.key, input.id, alt)
  return updated === null
    ? { outcome: 'not_found' }
    : { outcome: 'updated', asset: assetView(updated, media) }
}

/**
 * The URL an `asset:` reference of the site resolves to: where the Worker serves the image, or
 * the reference as it is when the Worker serves no media.
 */
export function assetUrlOf(
  context: Pick<OperationContext, 'media' | 'site'>,
): (id: string) => string {
  const base = context.media?.baseUrl
  return (id) => (base === undefined ? `asset:${id}` : `${base}${context.site.key}/${id}`)
}

/**
 * A value as a site reads it (RPC and the read API, the published view or a preview): every
 * `asset:` reference in it as the image's URL. Over MCP, an agent reads what it wrote.
 */
export function forReaders<T>(
  context: Pick<OperationContext, 'media' | 'site' | 'view' | 'reader'>,
  value: T,
): T {
  return readsUrls(context) ? resolveAssetReferences(value, assetUrlOf(context)) : value
}

/** Whether the call reads `asset:` references as URLs: a site, or the published view. */
export const readsUrls = (context: Pick<OperationContext, 'view' | 'reader'>) =>
  context.reader === true || context.view === 'published'

/** The assets of the site that values (a frontmatter, a document) name, by id. */
export async function imagesNamed(
  context: Pick<OperationContext, 'media' | 'site'>,
  values: readonly unknown[],
): Promise<ReadonlyMap<string, AssetRow>> {
  const media = context.media ?? null
  const ids = assetIdsIn(values)
  if (media === null || ids.length === 0) return new Map()
  const rows = await media.catalog.byIds(context.site.key, ids)
  return new Map(rows.map((row) => [row.id, row]))
}

/**
 * The `images` of a summary: by URL, the size and `srcset` of each image its frontmatter names,
 * where references are read as URLs. Nothing when it names none the site has.
 */
export function summaryImages(
  context: Pick<OperationContext, 'media' | 'site' | 'view' | 'reader'>,
  frontmatter: unknown,
  images: ReadonlyMap<string, AssetRow>,
) {
  if (!readsUrls(context)) return {}
  const urlOf = assetUrlOf(context)
  const named = assetIdsIn(frontmatter).flatMap((id) => {
    const row = images.get(id)
    if (row === undefined) return []
    const url = urlOf(id)
    return [[url, { width: row.width, height: row.height, srcset: srcsetOf(url, row) }] as const]
  })
  return named.length === 0 ? {} : { images: Object.fromEntries(named) }
}
