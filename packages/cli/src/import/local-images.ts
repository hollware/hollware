import { MAX_ASSET_BYTES } from '@hollware/core'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'

export interface LocalImage {
  readonly key: string
  readonly path: string
  readonly filename: string
  readonly alt: string
}

export interface LocalImages {
  readonly publicDir: string
  readonly byPath: Map<string, LocalImage>
}

type Rewritten = { ok: true; markdown: string } | { ok: false; reason: string }

const IMAGE_FILE = /\.(?:avif|gif|jpe?g|png|svg|webp)$/i
const MARKDOWN_IMAGE = /(!\[([^\]\n]*)\]\(\s*)(<[^>\n]+>|[^)\s]+)(\s+"[^"\n]*")?(\s*\))/g
const FRONTMATTER_VALUE = /^(\s*[\w-]+\s*:\s*)(["']?)([^"'\s#][^"'\n]*?)\2(\s*)$/gm

export function localImages(publicDir: string): LocalImages {
  return { publicDir, byPath: new Map() }
}

export function withLocalImages(
  markdown: string,
  fileDir: string,
  images: LocalImages,
  shown: string,
): Rewritten {
  const problems: string[] = []
  const swap = (reference: string, alt: string): string | undefined => {
    const target = pathOf(reference, fileDir, images.publicDir)
    if (target === undefined) return undefined
    const image = imageAt(target, alt, images, shown, reference)
    if (typeof image === 'string') {
      problems.push(image)
      return undefined
    }
    return `asset:${image.key}`
  }
  const open = /^---\r?\n/.exec(markdown)
  const close = open === null ? null : /^---\s*$/m.exec(markdown.slice(open[0].length))
  const split = open === null || close === null ? 0 : open[0].length + close.index
  const body = markdown
    .slice(split)
    .replace(
      MARKDOWN_IMAGE,
      (whole, start: string, alt: string, link: string, title = '', end: string) => {
        const reference = link.startsWith('<') ? link.slice(1, -1) : link
        const swapped = swap(reference, alt)
        return swapped === undefined ? whole : `${start}${swapped}${title}${end}`
      },
    )
  const frontmatter = markdown
    .slice(0, split)
    .replace(FRONTMATTER_VALUE, (whole, key: string, quote: string, value: string, end: string) => {
      const swapped = swap(value, '')
      return swapped === undefined ? whole : `${key}${quote}${swapped}${quote}${end}`
    })
  if (problems.length > 0) return { ok: false, reason: problems.join('; ') }
  return { ok: true, markdown: `${frontmatter}${body}` }
}

function pathOf(reference: string, fileDir: string, publicDir: string): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(reference)) return undefined
  const clean = decodeURIComponent(reference.replace(/[?#].*$/, ''))
  if (!IMAGE_FILE.test(clean)) return undefined
  return clean.startsWith('/') ? join(publicDir, clean) : resolve(fileDir, clean)
}

function imageAt(
  target: string,
  alt: string,
  images: LocalImages,
  shown: string,
  reference: string,
): LocalImage | string {
  const known = images.byPath.get(target)
  if (known !== undefined) return known
  let size: number
  try {
    size = statSync(target).size
  } catch {
    return `the image ${reference} is not in ${reference.startsWith('/') ? shown : 'its folder'}`
  }
  if (size > MAX_ASSET_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1)
    return `the image ${reference} is ${mb} MB, over the 10 MB an image may have: recompress it; a GIF with ffmpeg at fewer fps or a smaller width`
  }
  const bytes = readFileSync(target)
  const image: LocalImage = {
    key: `ast_${createHash('sha256').update(bytes).digest('hex').slice(0, 26)}`,
    path: target,
    filename: basename(target),
    alt: alt.trim() !== '' ? alt.trim() : basename(target, extname(target)),
  }
  images.byPath.set(target, image)
  return image
}
