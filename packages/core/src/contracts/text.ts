/**
 * Helpers for the texts of violations. A message can repeat something the entry holds, such as a
 * URL or a tag name. A verdict is stored with every revision and sent to the agent within an
 * output cap, so whatever a text repeats from the entry is clipped and escaped.
 */

/** The most characters of the entry's own text that a message repeats. */
const MAX_ECHO_LENGTH = 80

/** A plain JSON object: not `null`, not an array. */
export type JsonObject = { readonly [key: string]: unknown }

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Orders two texts by UTF-16 code units: the same in every runtime, unlike `localeCompare`. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

/** `text` cut to `max` characters, never inside a surrogate pair, with an ellipsis. */
export function clip(text: string, max: number = MAX_ECHO_LENGTH): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const last = head.charCodeAt(max - 1)
  const endsInsideAPair = last >= 0xd800 && last <= 0xdbff
  return `${endsInsideAPair ? head.slice(0, -1) : head}…`
}

/** Text from the entry as a message shows it: clipped, in JSON quotes, control characters escaped. */
export function quote(text: string): string {
  return JSON.stringify(clip(text))
}

/** A JSON Pointer (RFC 6901) from its segments: `['tags', '0']` is `/tags/0`, none is the root. */
export function pointer(segments: readonly string[]): string {
  return segments
    .map((segment) => `/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('')
}

/** `1 character`, `2 characters`. */
export function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`
}
