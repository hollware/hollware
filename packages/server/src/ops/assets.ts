import {
  assetIdOf,
  resolveAssetReferences,
  checkSvg,
  conversionOf,
  MAX_ASSET_BYTES,
  sniffImage,
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

/** An asset as the operations answer it. */
export function assetView(row: AssetRow, media: Media) {
  return {
    id: row.id,
    reference: `asset:${row.id}`,
    url: `${media.baseUrl}${row.site}/${row.id}`,
    format: row.format as ImageFormat,
    width: row.width,
    height: row.height,
    bytes: row.bytes,
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
  const id = assetIdOf(sha256)
  const site = context.site.key
  const existing = await media.catalog.byId(site, id)
  if (existing !== null) return { outcome: 'exists', asset: assetView(existing, media) }

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
      if (code === 9412) return NOT_READABLE
      throw error
    }
  }

  await media.files.put(servedKey(site, id), served, format)
  await media.files.put(originalKey(site, id), original, originalFormat)
  const { row, created } = await media.catalog.insert({
    id,
    site,
    sha256,
    format,
    width,
    height,
    bytes: served.length,
    originalFormat,
    originalBytes: original.length,
    alt: input.alt,
    filename: input.filename,
    createdBy: actorOf(context).userId,
    createdAt: context.clock.now().toISOString(),
  })
  return { outcome: created ? 'created' : 'exists', asset: assetView(row, media) }
}

/** The cursor of a page: the `createdAt` and id of its last row, in base64url. */
const cursorOf = (row: AssetRow) =>
  btoa(`${row.createdAt}|${row.id}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function parseCursor(cursor: string | undefined) {
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
 * A value as a read of the published site sees it (RPC, the read API): every `asset:` reference
 * in it as the image's URL. Over MCP, an agent reads what it wrote.
 */
export function forReaders<T>(
  context: Pick<OperationContext, 'media' | 'site' | 'view'>,
  value: T,
): T {
  return context.view === 'published' ? resolveAssetReferences(value, assetUrlOf(context)) : value
}
