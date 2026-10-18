/**
 * The images of a site (ADR-038), as far as they need no binding: what a file is, judged by its
 * bytes; whether an SVG is plainly safe; what a file becomes under the site's `media` setting; its
 * id; and the `asset:` references that content holds. Web platform only, as all of core.
 */
import type { ResolvedMedia } from '../config/types.ts'

/** The kinds of image Hollware takes, by media type. */
export const IMAGE_FORMATS = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/svg+xml',
] as const
export type ImageFormat = (typeof IMAGE_FORMATS)[number]

/** The largest file `upload_asset` takes, in bytes: the binding takes 20 MB, this keeps room. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024

/** The extension a format is served and exported with. */
export const EXTENSIONS: Readonly<Record<ImageFormat, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

const startsWith = (bytes: Uint8Array, at: number, expected: readonly number[]) =>
  expected.every((byte, index) => bytes[at + index] === byte)
const ascii = (text: string) => Array.from({ length: text.length }, (_, at) => text.charCodeAt(at))

/**
 * The format of a file, read from its bytes and never from its name or a header: `null` for
 * anything else. An SVG is text that opens on `<svg` or on an XML declaration followed by one.
 */
export function sniffImage(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, 0, ascii('RIFF')) && startsWith(bytes, 8, ascii('WEBP'))) {
    return 'image/webp'
  }
  if (startsWith(bytes, 4, ascii('ftyp')) && /^avi[fs]$/.test(text(bytes.subarray(8, 12)))) {
    return 'image/avif'
  }
  if (startsWith(bytes, 0, ascii('GIF87a')) || startsWith(bytes, 0, ascii('GIF89a'))) {
    return 'image/gif'
  }
  const head = text(bytes.subarray(0, 512)).replace(BOM, '').trimStart()
  if (
    /^<svg[\s>/]/i.test(head) ||
    /^<\?xml[^>]*\?>\s*(<!--[\s\S]*?-->\s*)*<svg[\s>/]/i.test(head)
  ) {
    return 'image/svg+xml'
  }
  return null
}

/** A byte order mark, which an editor may put before an SVG's first tag. */
const BOM = new RegExp(`^${String.fromCodePoint(0xfeff)}`)

function text(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** Why an SVG is refused, and what to do: an SVG is taken only when nothing in it can run. */
export interface SvgProblem {
  readonly reason: string
  readonly fix: string
}

const SVG_FIX =
  'Export the SVG again without scripts, embedded HTML, event handlers or external references (any SVG optimizer does it), or upload it as PNG.'

const SVG_REFUSALS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /<!DOCTYPE|<!ENTITY/i, reason: 'it declares a DOCTYPE or an entity' },
  { pattern: /<script[\s>/]/i, reason: 'it holds a <script>' },
  { pattern: /<foreignObject[\s>/]/i, reason: 'it holds a <foreignObject>, which embeds HTML' },
  { pattern: /<(?:iframe|embed|object|audio|video)[\s>/]/i, reason: 'it embeds another document' },
  { pattern: /\son[a-z]+\s*=/i, reason: 'it has an event handler (an on… attribute)' },
  { pattern: /\bjavascript\s*:|\bdata\s*:/i, reason: 'it holds a javascript: or data: URL' },
  {
    pattern: /(?:xlink:)?href\s*=\s*["']?\s*(?!#)[^"'\s>]/i,
    reason: 'it links outside the file (an href that does not start with #)',
  },
  {
    pattern: /@import|url\(\s*["']?\s*(?!["'\s#])/i,
    reason: 'its styles load something from outside',
  },
]

/** `null` when an SVG holds nothing that can run or reach out, else the first thing that can. */
export function checkSvg(source: string): SvgProblem | null {
  for (const { pattern, reason } of SVG_REFUSALS) {
    if (pattern.test(source)) return { reason, fix: SVG_FIX }
  }
  return null
}

/** What the binding is asked for, or `null` to keep the file as it came. */
export interface Conversion {
  readonly format: 'image/webp' | 'image/avif'
  /**
   * Always given: the binding's default is lossless, not 85 (ADR-038). 100 for PNG, which holds
   * screenshots, diagrams and logos: lossless keeps their edges.
   */
  readonly quality: number
  /** Always given: without it the binding keeps one frame of an animation. */
  readonly anim: boolean
  /** The width to scale down to, when the image is wider than the site allows. */
  readonly width?: number
}

/**
 * What a file of `format`, `width` pixels wide (null for an SVG), becomes under `media`: JPEG,
 * PNG and GIF become the site's format; a WebP or an AVIF keeps its own and is only scaled down
 * when it is wider than the site allows; `original` and SVG keep every file as it came.
 */
export function conversionOf(
  format: ImageFormat,
  width: number | null,
  media: ResolvedMedia,
): Conversion | null {
  if (format === 'image/svg+xml' || media.format === 'original') return null
  const tooWide = width !== null && width > media.maxWidth
  const modern = format === 'image/webp' || format === 'image/avif'
  if (modern && !tooWide) return null
  const target = modern ? format : media.format === 'avif' ? 'image/avif' : 'image/webp'
  return {
    format: target,
    quality: format === 'image/png' ? 100 : media.quality,
    anim: true,
    ...(tooWide ? { width: media.maxWidth } : {}),
  }
}

/** The id of an asset, from the SHA-256 of its original bytes: the same file is the same asset. */
export function assetIdOf(sha256Hex: string): string {
  return `ast_${sha256Hex.slice(0, 26)}`
}

/** What content writes to name an asset: `asset:ast_…`. */
export const ASSET_SCHEME = 'asset:'
const ASSET_REFERENCE = /^asset:(ast_[0-9a-f]{26})$/

/** The id an `asset:` reference names, or `null` when the value is no such reference. */
export function assetIdIn(value: string): string | null {
  return ASSET_REFERENCE.exec(value.trim())?.[1] ?? null
}

/**
 * A copy of a value (a frontmatter, a document) with every string that is an `asset:` reference
 * replaced by the URL `urlOf` gives its id. Everything else is copied as it is.
 */
export function resolveAssetReferences<T>(value: T, urlOf: (id: string) => string): T {
  const visit = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const id = assetIdIn(node)
      return id === null ? node : urlOf(id)
    }
    if (Array.isArray(node)) return node.map(visit)
    if (typeof node === 'object' && node !== null) {
      const copy: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(node)) {
        Object.defineProperty(copy, key, {
          value: visit(child),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      return copy
    }
    return node
  }
  return visit(value) as T
}
