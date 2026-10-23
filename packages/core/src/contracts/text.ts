const MAX_ECHO_LENGTH = 80

export type JsonObject = { readonly [key: string]: unknown }

export function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function clip(text: string, max: number = MAX_ECHO_LENGTH): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const last = head.charCodeAt(max - 1)
  const endsInsideAPair = last >= 0xd800 && last <= 0xdbff
  return `${endsInsideAPair ? head.slice(0, -1) : head}…`
}

export function quote(text: string): string {
  return JSON.stringify(clip(text))
}

export function pointer(segments: readonly string[]): string {
  return segments
    .map((segment) => `/${segment.replaceAll('~', '~0').replaceAll('/', '~1')}`)
    .join('')
}

export function count(amount: number, noun: string): string {
  return `${amount} ${noun}${amount === 1 ? '' : 's'}`
}
