import { MEDIA_MAX_WIDTH, MEDIA_MAX_WIDTHS, MEDIA_MIN_WIDTH } from '@hollware/core'

/**
 * The images section of Site (ADR-038), apart from the page so a test can hold it: the widths of
 * the narrower copies an owner types, such as `640, 1280`.
 */

export type Widths =
  | { readonly ok: true; readonly widths: number[] }
  | { readonly ok: false; readonly min: number; readonly max: number; readonly most: number }

/**
 * The widths in the text, smallest first and each once: whole numbers of pixels from 320 to 8192
 * apart by commas or spaces, at most four. Empty is none.
 */
export function parseWidths(text: string): Widths {
  const refused = {
    ok: false,
    min: MEDIA_MIN_WIDTH,
    max: MEDIA_MAX_WIDTH,
    most: MEDIA_MAX_WIDTHS,
  } as const
  const parts = text.split(/[\s,]+/).filter((part) => part !== '')
  const widths = [...new Set(parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN)))]
  if (widths.length > MEDIA_MAX_WIDTHS) return refused
  if (widths.some((width) => !(width >= MEDIA_MIN_WIDTH && width <= MEDIA_MAX_WIDTH))) {
    return refused
  }
  return { ok: true, widths: widths.sort((a, b) => a - b) }
}
