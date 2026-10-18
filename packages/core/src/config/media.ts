import type { Problems } from './config-error.ts'
import type { ResolvedMedia } from './types.ts'
import { isRecord, keyPath, wrongType } from './values.ts'

/** The formats a site may convert its images to, or keep them as they came (ADR-038). */
export const MEDIA_FORMATS = ['webp', 'avif', 'original'] as const

/** The narrowest an image may be scaled down to: smaller would blur on every screen. */
export const MEDIA_MIN_WIDTH = 320
/** The widest: past it the binding's area limit comes first, and no page shows more. */
export const MEDIA_MAX_WIDTH = 8192

/** What a site that says nothing gets: WebP at 85, and nothing wider than 2400 pixels. */
export const DEFAULT_MEDIA: ResolvedMedia = { format: 'webp', quality: 85, maxWidth: 2400 }

const FIX = 'Declare it as { format: "webp", quality: 85, maxWidth: 2400 }, or remove it.'

/** How a site converts the images it receives (ADR-038). */
export function readMedia(path: string, raw: unknown, problems: Problems): ResolvedMedia {
  if (raw === undefined || raw === null) return DEFAULT_MEDIA
  if (!isRecord(raw)) {
    problems.add(path, wrongType(raw, 'an object'), FIX)
    return DEFAULT_MEDIA
  }
  let { format, quality, maxWidth } = DEFAULT_MEDIA
  const rawFormat = raw['format']
  if (rawFormat !== undefined) {
    if (MEDIA_FORMATS.some((candidate) => candidate === rawFormat)) {
      format = rawFormat as ResolvedMedia['format']
    } else {
      problems.add(
        keyPath(path, 'format'),
        wrongType(rawFormat, '"webp", "avif" or "original"'),
        'Use "webp" or "avif" to convert the images a site receives, or "original" to keep them as they came.',
      )
    }
  }
  const rawQuality = raw['quality']
  if (rawQuality !== undefined) {
    if (isWhole(rawQuality) && rawQuality >= 1 && rawQuality <= 100) quality = rawQuality
    else {
      problems.add(
        keyPath(path, 'quality'),
        `${show(rawQuality)} is not a whole number from 1 to 100`,
        'Give the quality of photographs, 85 by default; PNG images are always kept lossless.',
      )
    }
  }
  const rawWidth = raw['maxWidth']
  if (rawWidth !== undefined) {
    if (isWhole(rawWidth) && rawWidth >= MEDIA_MIN_WIDTH && rawWidth <= MEDIA_MAX_WIDTH) {
      maxWidth = rawWidth
    } else {
      problems.add(
        keyPath(path, 'maxWidth'),
        `${show(rawWidth)} is not a whole number of pixels from ${MEDIA_MIN_WIDTH} to ${MEDIA_MAX_WIDTH}`,
        'Give the widest an image may be; a wider one is scaled down, never up.',
      )
    }
  }
  return { format, quality, maxWidth }
}

function isWhole(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
}

function show(value: unknown): string {
  return typeof value === 'number' ? String(value) : wrongType(value, 'a number')
}
